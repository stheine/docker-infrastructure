#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const fsExtra  = require('fs-extra');
const graphviz = require('graphviz');
const mqtt     = require('async-mqtt');
const moment   = require('moment');

const rrdtool  = require('./rrdtool');

// ###########################################################################
// Globals

let mqttClient;

// ###########################################################################
// Logging

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

// ###########################################################################
// Process handling

const stopProcess = async function() {
  await mqttClient.end();
  mqttClient = undefined;

  logger.info(`Shutdown -------------------------------------------------`);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Main (async)

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Handle shutdown
  process.on('SIGTERM', async() => {
    await stopProcess();
  });

  // #########################################################################
  // Init MQTT connection
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch(err) {
        // ignore
      }

      switch(topic) {
        case 'FritzBox/tele/SENSOR':
          await rrdtool.update('/var/fritz/fritz.rrd', {
            upTime:            message.upTime,
            downstreamMax:     message.downstreamMaxBitRate,
            upstreamMax:       message.upstreamMaxBitRate,
            downstreamCurrent: message.downstreamCurrent,
            upstreamCurrent:   message.upstreamCurrent,
          });
          break;

        case 'PowSolar/tele/SENSOR':
          await rrdtool.update('/var/strom/solar.rrd', {
            power:             message.ENERGY.Power,
            total:             message.ENERGY.Total,
          });
          break;

        case 'Stromzaehler/tele/SENSOR':
          await rrdtool.update('/var/strom/strom.rrd', {
            gesamtLeistung:    message.gesamtLeistung,
            momentanLeistung:  message.momentanLeistung,
            zaehlerLeistung:   message.zaehlerLeistung,
            gesamtEinspeisung: message.gesamtEinspeisung,
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

          await fsExtra.writeFile('/var/vito/_brennerVerbrauch.dat', message.brennerVerbrauch);
          break;

        case 'Zigbee/bridge/networkmap/graphviz':
          // Trigger by mosquitto_pub -h 192.168.6.7 -t Zigbee/bridge/networkmap -m graphviz
          await new Promise(resolve => {
            graphviz.parse(messageRaw, graph => {
              graph.render('png', async render => {
                await fsExtra.writeFile('/var/www/zigbee/map.png', render);

                logger.info('Updated map at https://heine7.de/zigbee/map.png');

                resolve();
              });
            });
          });
          break;

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  await mqttClient.subscribe('FritzBox/tele/SENSOR');
  await mqttClient.subscribe('PowSolar/tele/SENSOR');
  await mqttClient.subscribe('Stromzaehler/tele/SENSOR');
  await mqttClient.subscribe('Vito/tele/SENSOR');
  await mqttClient.subscribe('Zigbee/bridge/networkmap/graphviz');
})();
