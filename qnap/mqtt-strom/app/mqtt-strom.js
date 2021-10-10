#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const fsExtra     = require('fs-extra');
const millisecond = require('millisecond');
const moment      = require('moment');
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
  let lastTimestamp       = null;
  let solarDachLeistung   = null;
  let solarGarageLeistung = null;
  let zaehlerLeistung     = null;
  let spuelmaschineInterval;
  let waschmaschineInterval;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/strom/strom.json');

  let {gesamtEinspeisung, verbrauchBeiSonne, verbrauchImDunkeln} = status;

  gesamtEinspeisung  = gesamtEinspeisung  || 0;
  verbrauchBeiSonne  = verbrauchBeiSonne  || 0;
  verbrauchImDunkeln = verbrauchImDunkeln || 0;

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

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch {
        // ignore
      }

      switch(topic) {
        case 'tasmota/espstrom/tele/SENSOR': {
          if(solarDachLeistung === null || solarGarageLeistung === null) {
            return;
          }

          if(message.SML.Verbrauch < 20000 || message.SML.Verbrauch > 50000) {
            logger.warn(`Ungültiger Zählerverbrauch ${message.SML.Verbrauch}`);
            zaehlerLeistung = null;

            return;
          }

          if(message.SML.Leistung < -10000 || message.SML.Leistung > 10000) {
            logger.warn(`Ungültige Zählerleistung ${message.SML.Leistung}`);
            zaehlerLeistung = null;

            return;
          }

          // {SML: { Verbrauch: 0, Leistung: 0 }}
          zaehlerLeistung = message.SML.Leistung;

          const momentanLeistung = zaehlerLeistung + solarDachLeistung + solarGarageLeistung;
          const nowTimestamp = moment();
          const payload = {
            momentanLeistung,
          };

          if(lastTimestamp !== null) {
            if(zaehlerLeistung < 0) {
              // Einspeisung
              //                   Leistung (W)    * differenzSeitLetzterMessung (ms)     (s)    (h)    (k)    positive
              gesamtEinspeisung += zaehlerLeistung * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000 * -1; // kWh
            }
  
            if(solarGarageLeistung > 200) {
              // Verbrauch bei Sonne (> 200W)
              //                   Leistung (W)                  * differenzSeitLetzterMessung (ms)     (s)    (h)    (k)
              verbrauchBeiSonne += Math.max(momentanLeistung, 0) * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000; // kWh
            } else {
              // Verbrauch im Dunkeln
              //                    Leistung (W)                  * differenzSeitLetzterMessung (ms)     (s)    (h)    (k)
              verbrauchImDunkeln += Math.max(momentanLeistung, 0) * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000; // kWh
            }

            payload.gesamtEinspeisung  = gesamtEinspeisung;
            payload.verbrauchBeiSonne  = verbrauchBeiSonne;
            payload.verbrauchImDunkeln = verbrauchImDunkeln;
          }

          lastTimestamp = nowTimestamp;

          await fsExtra.writeJson('/var/strom/strom.json', {gesamtEinspeisung, verbrauchBeiSonne, verbrauchImDunkeln});

          await mqttClient.publish(`strom/tele/SENSOR`, JSON.stringify(payload));
          break;
        }

        case 'Fronius/solar/tele/SENSOR':
          if(message.powerOutgoing < 0 || message.powerOutgoing > 10000) {
            logger.warn(`Ungültige Solarleistung Dach ${message.powerOutgoing}`);
            solarDachLeistung = null
          } else {
            solarDachLeistung = message.powerOutgoing;
          }
          break;

        case 'tasmota/solar/tele/SENSOR':
          if(message.ENERGY.Power < 0 || message.ENERGY.Power > 800) {
            logger.warn(`Ungültige Solarleistung Garage ${message.ENERGY.Power}`);
            solarGarageLeistung = null
          } else {
            solarGarageLeistung = message.ENERGY.Power;
          }
          break;

        case 'tasmota/spuelmaschine/stat/POWER':
          switch(messageRaw) {
            case 'OFF':
              if(!spuelmaschineInterval) {
                logger.info('Spülmaschine OFF. Start waiting for Einspeisung.');

                await mqttClient.publish(`tasmota/spuelmaschine/cmnd/LedPower2`, '1');

                spuelmaschineInterval = setInterval(async() => {
                  if(zaehlerLeistung === null) {
                    return;
                  }

                  // logger.info('spuelmaschineInterval');

                  let triggerOn = false;

                  if(zaehlerLeistung < -100) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Spülmaschine.`);
                    triggerOn = true;
                  } else if(moment().isAfter(moment('13:00:00', 'HH:mm:ss'))) {
                    logger.info(`13:00. Trigger Spülmaschine.`);
                    triggerOn = true;
                  }

                  if(triggerOn) {
                    await mqttClient.publish(`tasmota/spuelmaschine/cmnd/POWER`, 'ON');
                  }
                }, millisecond('5 minutes'));
              }
              break;

            case 'ON':
              if(spuelmaschineInterval) {
                logger.info('Spülmaschine ON. Finish waiting.');

                await mqttClient.publish(`tasmota/spuelmaschine/cmnd/LedPower2`, '0');

                clearInterval(spuelmaschineInterval);

                spuelmaschineInterval = null;
              }
              break;

            default:
              logger.error(`Unhandled message '${topic}'`, messageRaw);
              break;
          }
          break;

        case 'tasmota/waschmaschine/stat/POWER':
          switch(messageRaw) {
            case 'OFF':
              if(!waschmaschineInterval) {
                logger.info('Waschmaschine OFF. Start waiting for Einspeisung.');

                await mqttClient.publish(`tasmota/waschmaschine/cmnd/LedPower2`, '1');

                waschmaschineInterval = setInterval(async() => {
                  if(zaehlerLeistung === null) {
                    return;
                  }

                  // logger.info('waschmaschineInterval');

                  let triggerOn = false;

                  if(zaehlerLeistung < -100) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Waschmaschine.`);
                    triggerOn = true;
                  } else if(moment().isAfter(moment('13:00:00', 'HH:mm:ss'))) {
                    logger.info(`13:00. Trigger Waschmaschine.`);
                    triggerOn = true;
                  }

                  if(triggerOn) {
                    await mqttClient.publish(`tasmota/waschmaschine/cmnd/POWER`, 'ON');
                  }
                }, millisecond('5 minutes'));
              }
              break;

            case 'ON':
              if(waschmaschineInterval) {
                logger.info('Waschmaschine ON. Finish waiting.');

                await mqttClient.publish(`tasmota/waschmaschine/cmnd/LedPower2`, '0');

                clearInterval(waschmaschineInterval);

                waschmaschineInterval = null;
              }
              break;

            default:
              logger.error(`Unhandled message '${topic}'`, messageRaw);
              break;
          }
          break;

        default:
          logger.error(`Unhandled topic '${topic}'`, messageRaw);
          break;
      }
    } catch(err) {
      logger.error(`Failed to parse mqtt message for '${topic}': ${messageBuffer.toString()}`, err.message);
    }
  });

  await mqttClient.publish('tasmota/espstrom/cmnd/TelePeriod', '10'); // MQTT Status every 10 seconds

  await mqttClient.publish('tasmota/spuelmaschine/cmnd/LedState', '0');
  await mqttClient.publish('tasmota/spuelmaschine/cmnd/LedMask', '0');
  await mqttClient.publish('tasmota/spuelmaschine/cmnd/SetOption31', '1');
  await mqttClient.publish('tasmota/spuelmaschine/cmnd/LedPower1', '0'); // Blue/Link off

  await mqttClient.publish('tasmota/waschmaschine/cmnd/LedState', '0');
  await mqttClient.publish('tasmota/waschmaschine/cmnd/LedMask', '0');
  await mqttClient.publish('tasmota/waschmaschine/cmnd/SetOption31', '1');
  await mqttClient.publish('tasmota/waschmaschine/cmnd/LedPower1', '0'); // Green/Link off

  await mqttClient.subscribe('Fronius/solar/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espstrom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/solar/tele/SENSOR');
  await mqttClient.subscribe('tasmota/spuelmaschine/stat/POWER');
  await mqttClient.subscribe('tasmota/waschmaschine/stat/POWER');
})();
