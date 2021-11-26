#!/usr/bin/env node

/* eslint-disable unicorn/no-lonely-if */

import _           from 'lodash';
import dayjs       from 'dayjs';
import fsExtra     from 'fs-extra';
import millisecond from 'millisecond';
import mqtt        from 'async-mqtt';
import utc         from 'dayjs/plugin/utc.js';

import logger      from './logger.js';

dayjs.extend(utc);

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
  let batteryLeistung     = null;
  let inverterLeistung    = null;
  let momentanLeistung    = null;
  let solarDachLeistung   = null;
  let solarGarageLeistung = null;
  let zaehlerLeistung     = null;
  let spuelmaschineInterval;
  let waschmaschineInterval;

  // #########################################################################
  // Signal handling for debug
  process.on('SIGHUP', () => {
    logger.debug('Dump', {
      solarDachLeistung,
      solarGarageLeistung,
      inverterLeistung,
      batteryLeistung,
      zaehlerLeistung,
      momentanLeistung,
    });
  });

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  let status;

  try {
    status = await fsExtra.readJson('/var/strom/strom.json');
  } catch {
    logger.error('Failed to read JSON in /var/strom/strom.json');

    process.exit(1);
  }

  let {gesamtEinspeisung, verbrauchHaus, verbrauchBeiSonne, verbrauchImDunkeln} = status;

  gesamtEinspeisung  = gesamtEinspeisung  || 0;
  verbrauchHaus      = verbrauchHaus      || 0;
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
    const now        = dayjs.utc();
    const maxPvTime  = now.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun


    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch {
        // ignore
      }

      switch(topic) {
        case 'tasmota/espstrom/tele/SENSOR': {
          if(batteryLeistung === null ||
            inverterLeistung === null ||
            solarDachLeistung === null ||
            solarGarageLeistung === null
          ) {
            return;
          }

          if(!message.SML) {
            logger.warn(`Ungültiges Nachrichtenformat vom Zähler`, message);
          }

          if(message.SML.Einspeisung < 0 || message.SML.Einspeisung > 50000) {
            logger.warn(`Ungültige Zählereinspeisung ${message.SML.Einspeisung}`);
            zaehlerLeistung = null;

            return;
          }

          if(message.SML.Verbrauch < 0 || message.SML.Verbrauch > 50000) {
            logger.warn(`Ungültiger Zählerverbrauch ${message.SML.Verbrauch}`);
            zaehlerLeistung = null;

            return;
          }

          if(message.SML.Leistung < -10000 || message.SML.Leistung > 14000) {
            logger.warn(`Ungültige Zählerleistung ${message.SML.Leistung}`);
            zaehlerLeistung = null;

            return;
          }

          await mqttClient.publish(`tasmota/espstrom/cmnd/LedPower1`, '1');
          setTimeout(async() => {
            await mqttClient.publish(`tasmota/espstrom/cmnd/LedPower1`, '0');
          }, millisecond('0.1 seconds'));

          // {SML: {Einspeisung, Verbrauch, Leistung}}
          zaehlerLeistung = message.SML.Leistung;

          momentanLeistung = zaehlerLeistung + inverterLeistung + solarGarageLeistung;
          const nowTimestamp = dayjs();
          const payload = {
            momentanLeistung,
          };

          // logger.debug({zaehlerLeistung, inverterLeistung, solarGarageLeistung, batteryLeistung, momentanLeistung});

          if(lastTimestamp !== null) {
            // Verbrauch in Haus
            // Leistung (W)                 * differenzSeitLetzterMessung (ms)  (s)    (h)    (k)
            verbrauchHaus +=
              Math.max(momentanLeistung, 0) * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000; // kWh

            if(zaehlerLeistung < 0) {
              // Einspeisung
              //                   Leistung (W)    * differenzSeitLetzterMessung (ms)     (s)    (h)    (k)    positive
              gesamtEinspeisung += zaehlerLeistung * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000 * -1; // kWh
            }

            if(solarGarageLeistung > 200) {
              // Verbrauch bei Sonne (> 200W)
              // Leistung (W)                 * differenzSeitLetzterMessung (ms)  (s)    (h)    (k)
              verbrauchBeiSonne +=
                Math.max(momentanLeistung, 0) * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000; // kWh
            } else {
              // Verbrauch im Dunkeln
              // Leistung (W)                 * differenzSeitLetzterMessung (ms)  (s)    (h)    (k)
              verbrauchImDunkeln +=
                Math.max(momentanLeistung, 0) * (nowTimestamp - lastTimestamp) / 1000 / 3600 / 1000; // kWh
            }

            payload.gesamtEinspeisung  = gesamtEinspeisung;
            payload.verbrauchHaus      = verbrauchHaus;
            payload.verbrauchBeiSonne  = verbrauchBeiSonne;
            payload.verbrauchImDunkeln = verbrauchImDunkeln;
          }

          lastTimestamp = nowTimestamp;

          await fsExtra.copyFile('/var/strom/strom.json', '/var/strom/strom.json.bak');
          await fsExtra.writeJson('/var/strom/strom.json', {
            gesamtEinspeisung,
            verbrauchHaus,
            verbrauchBeiSonne,
            verbrauchImDunkeln,
          }, {spaces: 2});

          await mqttClient.publish(`strom/tele/SENSOR`, JSON.stringify(payload));
          break;
        }

        case 'Fronius/solar/tele/SENSOR': {
          const battery  = _.find(message, {observedBy: 'battery/1'});
          const inverter = _.find(message, {observedBy: 'inverter/1'});
          const meter    = _.find(message, {observedBy: 'meter/grid'});
          const solar    = _.find(message, {observedBy: 'solar/1'});

          if(battery) {
            if(battery.powerIncoming && battery.powerOutgoing) {
              logger.warn('battery.powerIncoming && powerOutgoing', battery);
              batteryLeistung = null;
            } else {
              batteryLeistung = battery.powerIncoming;
            }
            if(battery.stateOfCharge < 0 || battery.stateOfCharge > 1) {
              logger.warn('battery.stateOfCharge', battery);
            }
          }
          if(inverter) {
            // logger.debug({inverter});
            if(inverter.powerOutgoing < 0 || inverter.powerOutgoing > 10000) {
              logger.warn(`Ungültige Inverterleistung ${inverter.powerOutgoing}`, message);
              inverterLeistung = null;
            } else {
              inverterLeistung = inverter.powerOutgoing || -inverter.powerIncoming;
            }
          }
          if(meter) {
            // logger.debug({meter});
            if(meter.powerIncoming && meter.powerOutgoing) {
              logger.warn('meter.powerIncoming && powerOutgoing', meter);
            }
          }
          if(solar) {
            if(solar.powerIncoming) {
              logger.warn('solar.powerIncoming', solar);
              solarDachLeistung = null;
            } else if(solar.powerOutgoing < 0 || solar.powerOutgoing > 10000) {
              logger.warn(`UngültigeSolarDachLeistung ${solar.powerOutgoing}`, message);
              solarDachLeistung = null;
            } else {
              solarDachLeistung = solar.powerOutgoing;
            }
          }
          break;
        }

        case 'tasmota/solar/tele/SENSOR':
          if(message.ENERGY.Power < 0 || message.ENERGY.Power > 800) {
            logger.warn(`Ungültige Solarleistung Garage ${message.ENERGY.Power}`);
            solarGarageLeistung = null;
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
                  if(zaehlerLeistung === null || batteryLeistung === null) {
                    return;
                  }

                  // logger.info('spuelmaschineInterval');

                  let triggerOn = false;

                  if(zaehlerLeistung < -1000) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Spülmaschine.`);
                    triggerOn = true;
                  } else if(batteryLeistung > 1000) {
                    logger.info(`Battery (${batteryLeistung}W). Trigger Spülmaschine.`);
                    triggerOn = true;
                  } else if(now > maxPvTime) {
                    logger.info(`Max sun. Trigger Spülmaschine.`);
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
                  if(zaehlerLeistung === null || batteryLeistung === null) {
                    return;
                  }

                  // logger.info('waschmaschineInterval');

                  let triggerOn = false;

                  if(zaehlerLeistung < -1000) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Waschmaschine.`);
                    triggerOn = true;
                  } else if(batteryLeistung > 1000) {
                    logger.info(`Battery (${batteryLeistung}W). Trigger Waschmaschine.`);
                    triggerOn = true;
                  } else if(now > maxPvTime) {
                    logger.info(`Max sun. Trigger Waschmaschine.`);
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
