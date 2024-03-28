#!/usr/bin/env node

import os   from 'node:os';

import _    from 'lodash';
import mqtt from 'async-mqtt';
import ms   from 'ms';
import {
  logger,
  // eslint-disable-next-line no-unused-vars
  sendMail,
} from '@stheine/helpers';

// ###########################################################################
// Globals

let   healthInterval;
const hostname        = os.hostname();
const notified        = {};
const timeouts        = {};
let   mqttClient;
let   tempAussen;

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

const triggerNotify = async function(raum) {
  logger.debug('notify', {raum});
  await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
    message: `${raum} Fenster schliessen`,
    sound:   'none',
    title:   'Fenster',
  }));

//  await sendMail({
//    to:      'technik@heine7.de',
//    subject: `${raum} Fenster schliessen`,
//    html:
//      `<html>${raum} Fenster schliessen</html>`,
//  });
};

(async() => {
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
    await mqttClient.publish(`mqtt-fenster/health/STATE`, 'OK');
  }, ms('1min'));

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch{
        // ignore
        // logger.debug('JSON.parse', {messageRaw, errMessage: err.message});
      }

      switch(topic) {
        case 'vito/tele/SENSOR':
          tempAussen = message.tempAussen;
          break;

        case 'Zigbee/FensterSensor Toilette':
        case 'Zigbee/FensterSensor Kinderbad':
        case 'Zigbee/FensterSensor Badezimmer':
        case 'Zigbee/FensterSensor Sonoff 1': {
          if(tempAussen === undefined) {
            return;
          }

          const {contact} = message;
          const raum      = topic.replace('Zigbee/FensterSensor ', '');

          // logger.trace('Fenster', {raum, tempAussen, contact});

          if(contact) {
            if(notified[raum]) {
              Reflect.deleteProperty(notified, raum);
            }

            if(timeouts[raum]) {
              logger.debug('clearTimeout', {raum});
              clearTimeout(timeouts[raum]);
              Reflect.deleteProperty(timeouts, raum);
            }
          } else if(!notified[raum] && !timeouts[raum]) {
            logger.debug('setTimeout', {raum});
            timeouts[raum] = setTimeout(async() => {
              Reflect.deleteProperty(timeouts, raum);

              await triggerNotify(raum);

              notified[raum] = true;
            }, ms('10m'));
          }
          break;
        }

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  mqttClient.subscribe('vito/tele/SENSOR');
  mqttClient.subscribe('Zigbee/FensterSensor Toilette');
  mqttClient.subscribe('Zigbee/FensterSensor Kinderbad');
  mqttClient.subscribe('Zigbee/FensterSensor Badezimmer');
  mqttClient.subscribe('Zigbee/FensterSensor Sonoff 1');
})();
