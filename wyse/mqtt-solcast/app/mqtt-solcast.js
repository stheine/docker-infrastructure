#!/usr/bin/env node

import os         from 'node:os';

import _          from 'lodash';
import {Cron}     from 'croner';
import {logger}   from '@stheine/helpers';
import mqtt       from 'mqtt';
import ms         from 'ms';

import configFile from './configFile.js';
import {
  analyzeForecasts,
  getSolcastForecasts,
} from './solcast.js';

// ###########################################################################
// Globals

let   config;
let   healthInterval;
const hostname        = os.hostname();
let   mqttClient;
let   status          = 'OK';

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.endAsync();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const handleSolcast = async function() {
  try {
    const forecasts = await getSolcastForecasts(config);

    await mqttClient.publishAsync('solcast/forecasts', JSON.stringify(forecasts), {retain: true});

    const analysis = analyzeForecasts(forecasts);

    await mqttClient.publishAsync('solcast/analysis', JSON.stringify(analysis), {retain: true});

    status = 'OK';
  } catch(err) {
    logger.error(err.message);

    status = `FAIL: ${err.message}`;
  }
};

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

// #########################################################################
// Schedule tasks

setInterval(handleSolcast, ms('1 hour'));

//                    s m h d m wd
const job = new Cron('0 0 0 * * *', {timezone: 'UTC'}, async() => {
  await handleSolcast();
});

_.noop('Cron job started', job);

await handleSolcast();

// #########################################################################
// Health
healthInterval = setInterval(async() => {
  await mqttClient.publishAsync(`mqtt-solcast/health/STATE`, status);
}, ms('1 minute'));
await mqttClient.publishAsync(`mqtt-solcast/health/STATE`, status);
