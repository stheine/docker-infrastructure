#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const mqtt    = require('async-mqtt');
const moment  = require('moment');

const rrdtool = require('./rrdtool');

const logger = {
  info(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg);
    }
  },
  warn(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg);
    }
  },
  error(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg);
    }
  },
};

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Handle shutdown
  process.on('SIGTERM', async() => {
    await mqttClient.end();

    logger.info(`Shutdown -------------------------------------------------`);
  });

  // #########################################################################
  // Init MQTT connection
  const mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  mqttClient.on('message', async(topic, messageBuffer) => {
    try {
      const message = JSON.parse(messageBuffer.toString());

      switch(topic) {
        case 'PowSolar/tele/SENSOR':
          await rrdtool.update('/var/strom/solar.rrd', {
            power: message.ENERGY.Power,
            total: message.ENERGY.Total,
          });
          break;

        case 'Stromzaehler/tele/SENSOR':
          await rrdtool.update('/var/strom/strom.rrd', {
            gesamtLeistung:   message.gesamtLeistung,
            momentanLeistung: message.momentanLeistung,
            zaehlerLeistung:  message.zaehlerLeistung,
          });
          break;

        case 'Vito/tele/SENSOR':
          await rrdtool.update('/var/vito/vito.rrd', {
            tempAussen:        message.tempAussen,
            tempKessel:        message.tempKessel,
            tempPufferOben:    message.tempPufferOben,
            tempPufferUnten:   message.tempPufferUnten,
            tempWarmwasser:    message.tempWarmwasser,
            tempFlamme:        message.tempFlamme,
            brennerStarts:     message.brennerStarts,
            brennerStunden:    message.brennerStunden,
            brennerVerbrauch:  message.brennerVerbrauch,
            kesselLeistung:    message.kesselLeistung,
            lambda:            message.lambda,
            statusZirkulation: message.statusZirkulation,
          });
          break;

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed to parse mqtt message for '${topic}': ${messageBuffer.toString()}`, err);
    }
  });

  await mqttClient.subscribe('PowSolar/tele/SENSOR');
  await mqttClient.subscribe('Stromzaehler/tele/SENSOR');
  await mqttClient.subscribe('Vito/tele/SENSOR');
})();
