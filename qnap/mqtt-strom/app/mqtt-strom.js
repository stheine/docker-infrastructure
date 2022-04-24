#!/usr/bin/env node

/* eslint-disable unicorn/no-lonely-if */

import fsPromises  from 'fs/promises';

import _           from 'lodash';
import dayjs       from 'dayjs';
import fsExtra     from 'fs-extra';
import mqtt        from 'async-mqtt';
import ms          from 'ms';
import utc         from 'dayjs/plugin/utc.js';

import logger      from './logger.js';
import {sendMail}  from './mail.js';

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
  let now                           = dayjs();
  let lastTimestamp                 = null;
  let wallboxLaedt                  = false;
  let wallboxStrom                  = null;
  let lastWallboxErrorMailTimestamp = null;
  let lastWallboxStateMailTimestamp = null;
  let batteryLeistung               = null;
  let inverterLeistung              = null;
  let momentanLeistung              = null;
  let solarDachLeistung             = null;
  let zaehlerLeistung               = null;
  let spuelmaschineInterval;
  let waschmaschineInterval;

  // #########################################################################
  // Signal handling for debug
  process.on('SIGHUP', () => {
    logger.debug('Dump', {
      solarDachLeistung,
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

  let {gesamtEinspeisung, verbrauchHaus} = status;

  gesamtEinspeisung  = gesamtEinspeisung || 0;
  verbrauchHaus      = verbrauchHaus     || 0;

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
    const messageRaw   = messageBuffer.toString();

    now    = dayjs();

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
            solarDachLeistung === null
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
          }, ms('0.1 seconds'));

          // {SML: {Einspeisung, Verbrauch, Leistung}}
          zaehlerLeistung = message.SML.Leistung;

          momentanLeistung = zaehlerLeistung + inverterLeistung;
          const payload = {
            momentanLeistung,
          };

          // logger.debug({zaehlerLeistung, inverterLeistung, batteryLeistung, momentanLeistung});

          if(lastTimestamp !== null) {
            // Verbrauch in Haus
            // Leistung (W)                 * differenzSeitLetzterMessung (ms)  (s)    (h)    (k)
            verbrauchHaus +=
              Math.max(momentanLeistung, 0) * (now - lastTimestamp) / 1000 / 3600 / 1000; // kWh

            if(zaehlerLeistung < 0) {
              // Einspeisung
              //                   Leistung (W)    * differenzSeitLetzterMessung (ms)     (s)    (h)    (k)    positive
              gesamtEinspeisung += zaehlerLeistung * (now - lastTimestamp) / 1000 / 3600 / 1000 * -1; // kWh
            }

            if(wallboxLaedt) {
              wallboxStrom = Math.max(wallboxStrom - zaehlerLeistung / 410 * 1000, 0); // Einspeisung(W) / Ladespannung(V) * 1000 => mA;
              await mqttClient.publish(`Wallbox/evse/current_limit`, JSON.stringify({current: wallboxStrom}));
            }

            payload.gesamtEinspeisung  = gesamtEinspeisung;
            payload.verbrauchHaus      = verbrauchHaus;
          }

          lastTimestamp = now;

          await fsPromises.copyFile('/var/strom/strom.json', '/var/strom/strom.json.bak');
          await fsExtra.writeJson('/var/strom/strom.json', {
            gesamtEinspeisung,
            verbrauchHaus,
          }, {spaces: 2});

          await mqttClient.publish(`strom/tele/SENSOR`, JSON.stringify(payload));
          break;
        }

        case 'Fronius/solar/tele/SENSOR': {
          const {battery, inverter, meter, solar} = message;

          if(battery) {
            if(battery.powerIncoming && battery.powerOutgoing) {
              logger.warn('battery.powerIncoming && powerOutgoing', battery);
              batteryLeistung = null;
            } else {
              batteryLeistung = battery.powerIncoming;
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
          if(solar) {
            if(solar.powerOutgoing < 0 || solar.powerOutgoing > 10000) {
              logger.warn(`UngültigeSolarDachLeistung ${solar.powerOutgoing}`, message);
              solarDachLeistung = null;
            } else {
              solarDachLeistung = solar.powerOutgoing;
            }
          }
          break;
        }

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

                  const nowUtc       = dayjs.utc();
                  const maxPvTimeUtc = nowUtc.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun
                  let   triggerOn    = false;

                  if(zaehlerLeistung < -1000) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Spülmaschine.`);
                    triggerOn = true;
                  } else if(batteryLeistung > 1000) {
                    logger.info(`Battery (${batteryLeistung}W). Trigger Spülmaschine.`);
                    triggerOn = true;
                  } else if(nowUtc > maxPvTimeUtc) {
                    logger.info(`Max sun. Trigger Spülmaschine.`);
                    triggerOn = true;
                  }

                  if(triggerOn) {
                    await mqttClient.publish(`tasmota/spuelmaschine/cmnd/POWER`, 'ON');
                  }
                }, ms('5 minutes'));
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

                  const nowUtc       = dayjs.utc();
                  const maxPvTimeUtc = nowUtc.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun
                  let   triggerOn = false;

                  if(zaehlerLeistung < -1000) {
                    logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Waschmaschine.`);
                    triggerOn = true;
                  } else if(batteryLeistung > 1000) {
                    logger.info(`Battery (${batteryLeistung}W). Trigger Waschmaschine.`);
                    triggerOn = true;
                  } else if(nowUtc > maxPvTimeUtc) {
                    logger.info(`Max sun. Trigger Waschmaschine.`);
                    triggerOn = true;
                  }

                  if(triggerOn) {
                    await mqttClient.publish(`tasmota/waschmaschine/cmnd/POWER`, 'ON');
                  }
                }, ms('5 minutes'));
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

        case 'Wallbox/evse/state': {
          // iec61851_state: 0,
          // vehicle_state: 0, // 1 Verbunden, 2 Lädt
          // charge_release: 1, // 0 Automatisch, 1 Manuell, 2 Deaktiviert
          // allowed_charging_current: 16000,
          // error_state: 0,
          const {allowed_charging_current, charge_release, error_state, iec61851_state, vehicle_state} = message;

          if(error_state) {
            logger.error('Wallbox error_state', message);
            if((now - lastWallboxErrorMailTimestamp) / 1000 / 3600 > 1) {
              await sendMail({
                to:      'stefan@heine7.de',
                subject: `Wallbox Fehler`,
                html:    `<b>Wallbox Fehler</b><br><pre>${JSON.stringify(message, null, 2)}</pre>`,
              });
              lastWallboxErrorMailTimestamp = now;
            }
          }
          switch(vehicle_state) {
            case 0:
              // Nicht verbunden
              break;

            case 1:
              // Verbunden
              if((now - lastWallboxStateMailTimestamp) / 1000 / 3600 > 1) {
                await sendMail({
                  to:      'stefan@heine7.de',
                  subject: `Wallbox Verbunden`,
                  html:    `<b>Wallbox Verbunden</b><br><pre>${JSON.stringify(message, null, 2)}</pre>`,
                });
                lastWallboxStateMailTimestamp = now;
              }
              break;

            case 2:
              // Lädt
              if((now - lastWallboxStateMailTimestamp) / 1000 / 3600 > 1) {
                await sendMail({
                  to:      'stefan@heine7.de',
                  subject: `Wallbox Lädt`,
                  html:    `<b>Wallbox Lädt</b><br><pre>${JSON.stringify(message, null, 2)}</pre>`,
                });
                lastWallboxStateMailTimestamp = now;
              }
              break;

            case 3:
              // Fehler
              logger.error('Wallbox vehicle_state Fehler', message);
              break;

            default:
              logger.error(`Unhandled vehicle_state '${vehicle_state}'`, message);
              break;
          }
          if(vehicle_state === 2) {
            wallboxLaedt = true;

            if(_.isNull(wallboxStrom)) {
              wallboxStrom = 0;
            }
          } else {
            wallboxLaedt = false;
            wallboxStrom = null;
          }
          break;
        }

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
  await mqttClient.subscribe('tasmota/spuelmaschine/stat/POWER');
  await mqttClient.subscribe('tasmota/waschmaschine/stat/POWER');
  await mqttClient.subscribe('Wallbox/evse/state');
})();
