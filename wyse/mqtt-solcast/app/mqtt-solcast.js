#!/usr/bin/env node

import os       from 'node:os';

import _        from 'lodash';
import {logger} from '@stheine/helpers';
import mqtt     from 'async-mqtt';
import ms       from 'ms';

import configFile            from './configFile.js';
import {getSolcastForecasts} from './solcast.js';

// ###########################################################################
// Globals

let   config;
let   healthInterval;
const hostname   = os.hostname();
let   mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const handleSolcast = async function() {
  const forecasts = await getSolcastForecasts(config);

  await mqttClient.publish('solcast/forecasts', JSON.stringify(forecasts), {retain: true});
};

(async() => {
  // #########################################################################
  // Config
  config = await configFile.read();

  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

  healthInterval = setInterval(async() => {
    await mqttClient.publish(`mqtt-solcast/health/STATE`, 'OK');
  }, ms('1min'));

  setInterval(handleSolcast, ms('30 minutes'));
  await handleSolcast(); // on startup
})();
