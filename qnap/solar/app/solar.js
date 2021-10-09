#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const {setTimeout} = require('timers/promises');

const _           = require('lodash');
const fronius     = require('fronius');
const fsExtra     = require('fs-extra');
const millisecond = require('millisecond');
const mqtt        = require('async-mqtt');

const logger      = require('./logger');

// ###########################################################################
// Globals

let mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

(async() => {
  // Globals

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => logger.info('mqtt.close'));
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => logger.info('mqtt.end'));

  // Handle Fronius data
  const client = new fronius.Client('http://192.168.6.11');

  while(true) {
    const powerFlow = await client.powerFlow({format: 'json'});
    const solarSensor = _.find(powerFlow, {observedBy: 'solar/1'});

    if(solarSensor) {
      console.log(solarSensor.powerOutgoing);

      await mqttClient.publish('Fronius/solar/tele/SENSOR', JSON.stringify(solarSensor));
    }

    await setTimeout(millisecond('5 seconds'));
  }
})();
