#!/usr/bin/env node

import os         from 'node:os';

import _          from 'lodash';
import {logger}   from '@stheine/helpers';
import mqtt       from 'async-mqtt';
import ms         from 'ms';

import configFile from './configFile.js';
import notify     from './notify.js';

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

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

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
    await mqttClient.publish(`mqtt-notify/health/STATE`, 'OK');
  }, ms('1min'));

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch {
        // ignore
        // logger.debug('JSON.parse', {messageRaw, errMessage: err.message});
      }

      switch(topic) {
        case 'mqtt-notify/notify':
          await notify({config, data: message});
          break;

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  mqttClient.subscribe('mqtt-notify/notify')
})();
