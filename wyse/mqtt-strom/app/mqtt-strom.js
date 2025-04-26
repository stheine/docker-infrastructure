#!/usr/bin/env node

/* eslint-disable camelcase */
/* eslint-disable object-curly-newline */
/* eslint-disable object-property-newline */

import {setTimeout as delay} from 'node:timers/promises';
import os                    from 'node:os';

import _             from 'lodash';
import check         from 'check-types-2';
import {Cron}        from 'croner';
import dayjs         from 'dayjs';
import {logger}      from '@stheine/helpers';
import mqtt          from 'mqtt';
import ms            from 'ms';
import {TibberQuery} from 'tibber-api';
import utc           from 'dayjs/plugin/utc.js';
// import {
//  sendMail,
// } from '@stheine/helpers';

import configFile from './configFile.js';
import statusFile from './statusFile.js';

dayjs.extend(utc);

const dcLimit = 5750;

// vitoBetriebsart
// 0 Warmwasser
// 1 ? Reduziert?
// 2 ? Normal?
// 3 Heizung+Warmwasser
// 4 ? H+WW FS?
// 5 Abschaltbetrieb

// ###########################################################################
// Globals

let   healthInterval;
const hostname        = os.hostname();
let   mqttClient;
let   health          = 'OK';

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

// Globals
let now                           = dayjs();
let maxSun                        = 0;
let lastTimestamp                 = null;
let vwBatterySocPct               = null;
let vwTargetSocPct                = null;
let wallboxState                  = null;
let aktuellerUeberschuss          = null;
let batteryLeistung               = null;
let batteryLevel                  = null;
let heizstabLeistung              = null;
let inverterLeistung              = null;
let momentanLeistung              = null;
let solarDachLeistung             = null;
let zaehlerLeistung               = null;
let vitoBetriebsart               = null;
let spuelmaschineInterval;
let heizstabInterval;
let waschmaschineInterval;
let solcastHighPvHours            = 0;
let solcastLimitPvHours           = 0;

// #########################################################################
// Signal handling for debug
process.on('SIGHUP', () => {
  const nowUtc = dayjs.utc();

  logger.debug('Dump', {
    aktuellerUeberschuss,
    solarDachLeistung,
    inverterLeistung,
    batteryLeistung,
    batteryLevel,
    heizstabLeistung,
    zaehlerLeistung,
    momentanLeistung,
    solcastHighPvHours,
    solcastLimitPvHours,
    maxSun:              maxSun.format('YYYY-MM-DD HH:mm:ss UTC'),
    nowUtc:              nowUtc.format('YYYY-MM-DD HH:mm:ss UTC'),
    afterMaxSun:         nowUtc > maxSun,
    wallboxState,
    vwBatterySocPct,
    vwTargetSocPct,
  });
});

// #########################################################################
// Startup

logger.info(`Startup --------------------------------------------------`);

// #########################################################################
// Read static data

const config = await configFile.read();
const status = await statusFile.read();

let {gesamtEinspeisung, verbrauchHaus} = status;

gesamtEinspeisung  = gesamtEinspeisung || 0;
verbrauchHaus      = verbrauchHaus     || 0;

// #########################################################################
// Init Tibber Query

const tibberQueryUrl = 'https://api.tibber.com/v1-beta/gql';
const tibberConfig = {
  apiEndpoint: {
    apiKey:   config.tibberAccessToken,
    queryUrl: tibberQueryUrl,
  },
  homeId:    config.homeId, // {viewer{homes{id}}}
};
const tibberQuery = new TibberQuery(tibberConfig);

// #########################################################################
const getStrompreise = async function() {
  try {
    const queryPrice = '{viewer{homes{currentSubscription{priceInfo{' +
      'today{total energy startsAt currency level} ' +
      'tomorrow{total energy startsAt currency level}}}}}}';

    const result = await tibberQuery.query(queryPrice);
    const strompreiseRaw = [
      ...result.viewer.homes[0].currentSubscription.priceInfo.today,
      ...result.viewer.homes[0].currentSubscription.priceInfo.tomorrow,
    ];
    const strompreise = _.map(strompreiseRaw, data => ({
      startTime: new Date(data.startsAt),
      cent:      _.round(data.energy * 100, 2), // Eur/kWh + 100ct/Eur
      level:     data.level,
    }));

    const nowUtc = dayjs.utc();
    const lastPreisStartDate = dayjs.utc(strompreise.at(-1).startTime);
    const diff = lastPreisStartDate.diff(nowUtc, 'day', true);

    if(nowUtc.hour() > 18) {
      check.assert.greater(diff, 1, `Letzter Preis fuer ${strompreise.at(-1).startTime}`);
    }

    // logger.debug(strompreise);
    await mqttClient.publishAsync('strom/tele/preise', JSON.stringify(strompreise), {retain: true});

    health = 'OK';
  } catch(err) {
    logger.error(err.message);

    health = `FAIL: ${err.message}`;
  }
};

// eslint-disable-next-line no-unused-vars
const getStrompreiseAwattar = async function() {
  try {
    const response = await fetch('https://api.awattar.de/v1/marketdata');

    check.assert.equal(response.status, 200);
    check.assert.equal(response.statusText, 'OK');

    const responseData   = await response.json();
    const strompreiseRaw = responseData?.data;

    const strompreise = _.map(strompreiseRaw, data => ({
      startTime: new Date(data.start_timestamp),
      cent:      _.round(data.marketprice / 10, 2), // Eur/MWh / 100ct/Eur * 1000 MWh/kWh
    }));

    // logger.debug(strompreise);
    await mqttClient.publishAsync('strom/tele/preise', JSON.stringify(strompreise), {retain: true});

    health = 'OK';
  } catch(err) {
    logger.error(err.message);

    health = `FAIL: ${err.message}`;
  }
};

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

mqttClient.on('message', async(topic, messageBuffer) => {
  const messageRaw   = messageBuffer.toString();

  now    = dayjs();

  try {
    let message;

    try {
      message = JSON.parse(messageRaw);
    } catch{
      // ignore
    }

    switch(topic) {
      case 'auto/tele/STATUS':
        ({wallboxState} = message);

        if(wallboxState === 'Lädt' &&
          heizstabLeistung &&
          heizstabInterval
        ) {
          logger.info('Auto Ladestart. Beende Speicherheizung mit Heizstab.', {
            zaehlerLeistung, batteryLeistung, batteryLevel, heizstabLeistung,
            aktuellerUeberschuss, solcastHighPvHours, wallboxState, vwBatterySocPct, vwTargetSocPct});

          await mqttClient.publishAsync(`tasmota/heizstab/cmnd/POWER`, 'OFF');
        }
        break;

      case 'maxSun/INFO':
        maxSun = dayjs.utc(message);
        break;

      case 'tasmota/espstrom/tele/SENSOR': {
        if(batteryLeistung === null ||
          batteryLevel === null ||
          heizstabLeistung === null ||
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

        await mqttClient.publishAsync(`tasmota/espstrom/cmnd/LedPower1`, '1');
        setTimeout(async() => {
          await mqttClient.publishAsync(`tasmota/espstrom/cmnd/LedPower1`, '0');
        }, ms('0.1 seconds'));

        // {SML: {Einspeisung, Verbrauch, Leistung}}
        zaehlerLeistung = _.round(message.SML.Leistung);

        aktuellerUeberschuss = -zaehlerLeistung + batteryLeistung + heizstabLeistung;
        momentanLeistung = zaehlerLeistung + inverterLeistung;
        const payload = {
          momentanLeistung,
        };

        // logger.debug({zaehlerLeistung, inverterLeistung, batteryLeistung, heizstabLeistung, momentanLeistung});

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

// TODO          if(wallboxLaedt) {
// TODO            // Einspeisung(W) / Ladespannung(V) * 1000 => mA;
// TODO            wallboxStrom = Math.max(wallboxStrom - zaehlerLeistung / 410 * 1000, 0);
// TODO            await mqttClient.publishAsync(`Wallbox/evse/current_limit`, JSON.stringify({current: wallboxStrom}));
// TODO          }

          payload.gesamtEinspeisung  = gesamtEinspeisung;
          payload.verbrauchHaus      = verbrauchHaus;
        }

        lastTimestamp = now;

        await statusFile.write({
          gesamtEinspeisung,
          verbrauchHaus,
        });

        await mqttClient.publishAsync(`strom/tele/SENSOR`, JSON.stringify(payload));
        break;
      }

      case 'Fronius/solar/tele/SENSOR': {
        const {battery, inverter, solar} = message;

        if(battery) {
          if(battery.powerIncoming && battery.powerOutgoing) {
            logger.warn('battery.powerIncoming && powerOutgoing', battery);
            batteryLeistung = null;
          } else {
            batteryLeistung = _.round(battery.powerIncoming);
            aktuellerUeberschuss = -zaehlerLeistung + batteryLeistung + heizstabLeistung;
          }
          batteryLevel = _.round(battery.stateOfCharge * 100, 1);
        }
        if(inverter) {
          // logger.debug({inverter});
          if(inverter.powerOutgoing < 0 || inverter.powerOutgoing > 10000) {
            logger.warn(`Ungültige Inverterleistung ${inverter.powerOutgoing}`, message);
            inverterLeistung = null;
          } else {
            inverterLeistung = _.round(inverter.powerOutgoing || -inverter.powerIncoming);
          }
        }
        if(solar) {
          if(solar.powerOutgoing < 0 || solar.powerOutgoing > 10000) {
            logger.warn(`UngültigeSolarDachLeistung ${solar.powerOutgoing}`, message);
            solarDachLeistung = null;
          } else {
            solarDachLeistung = _.round(solar.powerOutgoing);
          }
        }
        break;
      }

      case 'solcast/forecasts': {
        const solcastForecasts = message;

        const nowUtc       = dayjs.utc();
        const midnightTime = nowUtc.clone().hour(24).minute(0).second(0);
        let   highPvHours  = 0;
        let   limitPvHours = 0;

        for(const forecast of solcastForecasts) {
          const {period_end} = forecast;
          const period_end_date = dayjs(period_end);

          if(period_end_date < nowUtc) {
            // Already passed
            continue;
          }
          if(period_end_date > midnightTime) {
            // Tomorrow
            continue;
          }

          let {pv_estimate: estimate} = forecast;

          estimate *= 1000; // kW to watt

          if(estimate > 3000) {
            // Estimate is for 30 minute period
            highPvHours += 1 / 2;
          }
          if(estimate > dcLimit) {
            // Estimate is for 30 minute period
            limitPvHours += 1 / 2;
          }
        }

        solcastHighPvHours  = highPvHours;
        solcastLimitPvHours = limitPvHours;
        break;
      }

      case 'tasmota/spuelmaschine/stat/POWER1': {
        switch(messageRaw) {
          case 'OFF':
            if(!spuelmaschineInterval) {
              logger.info('Spülmaschine OFF. Start waiting for Einspeisung.');

              await mqttClient.publishAsync(`tasmota/spuelmaschine/cmnd/Power2`, 'ON');

              spuelmaschineInterval = setInterval(async() => {
                if(zaehlerLeistung === null || batteryLeistung === null || batteryLevel === null) {
                  return;
                }

                // logger.info('spuelmaschineInterval');

                const nowUtc    = dayjs.utc();
                let   triggerOn = false;

                if(solcastLimitPvHours <= 3 && zaehlerLeistung < -1000) {
                  logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Spülmaschine.`);
                  triggerOn = true;
                } else if((batteryLeistung > 800 && batteryLevel > 40) || batteryLevel > 70) {
                  logger.info(`Battery (${batteryLeistung}W/${batteryLevel}%). Trigger Spülmaschine.`);
                  triggerOn = true;
                } else if(nowUtc > maxSun) {
                  logger.info(`Max sun. Trigger Spülmaschine.`);
                  triggerOn = true;
                }

                if(triggerOn) {
                  await mqttClient.publishAsync(`tasmota/spuelmaschine/cmnd/Power1`, 'ON');
                }
              }, ms('5 minutes'));
            }
            break;

          case 'ON':
            if(spuelmaschineInterval) {
              logger.info('Spülmaschine ON. Finish waiting.');

              await mqttClient.publishAsync(`tasmota/spuelmaschine/cmnd/Power2`, 'OFF');

              clearInterval(spuelmaschineInterval);

              spuelmaschineInterval = null;
            }
            break;

          default:
            logger.error(`Unhandled message '${topic}'`, messageRaw);
            break;
        }
        break;
      }

      case 'tasmota/heizstab/stat/POWER': {
        switch(messageRaw) {
          case 'OFF':
            heizstabLeistung     = 0;
            aktuellerUeberschuss = -zaehlerLeistung + batteryLeistung + heizstabLeistung;

            if(heizstabInterval) {
//                logger.info('Heizstab OFF. Warte auf Einspeisung.',
//                  {zaehlerLeistung, batteryLeistung, batteryLevel, solcastHighPvHours});

              clearInterval(heizstabInterval);
            }

            heizstabInterval = setInterval(async() => {
              if(zaehlerLeistung === null) {
                return;
              }

//              if([1, 12].includes(now.format('M'))) { // Not in January & December
//                return;
//              }

              if(!(['Lädt', 'Ladebereit', 'Warte auf Ladefreigabe'].includes(wallboxState) &&
                vwBatterySocPct < vwTargetSocPct
              ) && (
                (
                  aktuellerUeberschuss > 5500 &&
                  (batteryLevel > 50 || solcastHighPvHours >= 2) &&
                  (batteryLevel > 70 || solcastHighPvHours >= 1)
                ) || (
                  zaehlerLeistung < -5500
                )
              )) {
                logger.debug('Ausreichend Einspeisung. Erlaube Speicherheizung mit Heizstab.', {
                  zaehlerLeistung, batteryLeistung, batteryLevel, heizstabLeistung, aktuellerUeberschuss,
                  solcastHighPvHours, vitoBetriebsart});

                await mqttClient.publishAsync(`tasmota/heizstab/cmnd/POWER`, 'ON');
              }
            }, ms('15s'));
            break;

          case 'ON':
            if(!heizstabLeistung) {
              heizstabLeistung     = 2000;
              aktuellerUeberschuss = -zaehlerLeistung + batteryLeistung + heizstabLeistung;
            }

//              logger.info('Heizstab ON. Warte auf Ende der Einspeisung.', {
//                zaehlerLeistung, batteryLeistung, batteryLevel, aktuellerUeberschuss,
//                solcastHighPvHours, vitoBetriebsart});

            if(heizstabInterval) {
              clearInterval(heizstabInterval);
            }

            heizstabInterval = setInterval(async() => {
              if(zaehlerLeistung === null) {
                return;
              }

              if(aktuellerUeberschuss < 4500 ||
                (batteryLevel < 50 && solcastHighPvHours < 2) ||
                (batteryLevel < 70 && solcastHighPvHours < 1) ||
                (['Lädt', 'Ladebereit', 'Warte auf Ladefreigabe'].includes(wallboxState) &&
                  vwBatterySocPct < vwTargetSocPct
                )
              ) {
                logger.info('Geringe Einspeisung. Beende Speicherheizung mit Heizstab.', {
                  zaehlerLeistung, batteryLeistung, batteryLevel, heizstabLeistung,
                  aktuellerUeberschuss, solcastHighPvHours, wallboxState, vwBatterySocPct, vwTargetSocPct});

                await mqttClient.publishAsync(`tasmota/heizstab/cmnd/POWER`, 'OFF');
              }
            }, ms('5 minutes'));
            break;

          default:
            logger.error(`Unhandled message '${topic}'`, messageRaw);
            break;
        }
        break;
      }

      case 'tasmota/heizstab/tele/SENSOR': {
        heizstabLeistung     = message.ENERGY.Power;
        aktuellerUeberschuss = -zaehlerLeistung + batteryLeistung + heizstabLeistung;
        break;
      }

      case 'tasmota/waschmaschine/stat/POWER': {
        switch(messageRaw) {
          case 'OFF':
            if(!waschmaschineInterval) {
              logger.info('Waschmaschine OFF. Start waiting for Einspeisung.');

              await mqttClient.publishAsync(`tasmota/waschmaschine/cmnd/LedPower2`, '1');

              waschmaschineInterval = setInterval(async() => {
                if(zaehlerLeistung === null || batteryLeistung === null || batteryLevel === null) {
                  return;
                }

                // logger.info('waschmaschineInterval');

                const nowUtc    = dayjs.utc();
                let   triggerOn = false;

                if(solcastLimitPvHours <= 3 && zaehlerLeistung < -1000) {
                  logger.info(`Einspeisung (${-zaehlerLeistung}W). Trigger Waschmaschine.`);
                  triggerOn = true;
                } else if((batteryLeistung > 800 && batteryLevel > 40) || batteryLevel > 70) {
                  logger.info(`Battery (${batteryLeistung}W/${batteryLevel}%). Trigger Waschmaschine.`);
                  triggerOn = true;
                } else if(nowUtc > maxSun) {
                  logger.info(`Max sun. Trigger Waschmaschine.`);
                  triggerOn = true;
                }

                if(triggerOn) {
                  await mqttClient.publishAsync(`tasmota/waschmaschine/cmnd/POWER`, 'ON');
                }
              }, ms('5 minutes'));
            }
            break;

          case 'ON':
            if(waschmaschineInterval) {
              logger.info('Waschmaschine ON. Finish waiting.');

              await mqttClient.publishAsync(`tasmota/waschmaschine/cmnd/LedPower2`, '0');

              clearInterval(waschmaschineInterval);

              waschmaschineInterval = null;
            }
            break;

          default:
            logger.error(`Unhandled message '${topic}'`, messageRaw);
            break;
        }
        break;
      }

      case 'vito/tele/SENSOR': {
        vitoBetriebsart = Number(message.hk1Betriebsart);
        break;
      }

      case `vwsfriend/vehicles/${config.VWId}/domains/charging/batteryStatus/currentSOC_pct`: {
        vwBatterySocPct = messageRaw;
        break;
      }

      case `vwsfriend/vehicles/${config.VWId}/domains/charging/chargingSettings/targetSOC_pct`: {
        vwTargetSocPct = messageRaw;
        break;
      }

      default: {
        logger.error(`Unhandled topic '${topic}'`, messageRaw);
        break;
      }
    }
  } catch(err) {
    logger.error(`Failed to parse mqtt message for '${topic}': ${messageBuffer.toString()}`, err.message);
  }
});

await mqttClient.publishAsync('tasmota/espstrom/cmnd/TelePeriod', '10'); // MQTT Status every 10 seconds

await mqttClient.publishAsync('tasmota/spuelmaschine/cmnd/LedState', '7');
await mqttClient.publishAsync('tasmota/spuelmaschine/cmnd/LedMask', '1');
await mqttClient.publishAsync('tasmota/spuelmaschine/cmnd/PowerOnState', '1');
await mqttClient.publishAsync('tasmota/spuelmaschine/cmnd/SetOption31', '0');
// await mqttClient.publishAsync('tasmota/spuelmaschine/cmnd/LedPower1', '1'); // Blue/Link off // TODO 0

await mqttClient.publishAsync('tasmota/waschmaschine/cmnd/LedState', '0');
await mqttClient.publishAsync('tasmota/waschmaschine/cmnd/LedMask', '0');
await mqttClient.publishAsync('tasmota/waschmaschine/cmnd/SetOption31', '1');
await mqttClient.publishAsync('tasmota/waschmaschine/cmnd/LedPower1', '0'); // Green/Link off

await mqttClient.subscribeAsync('maxSun/INFO');
await mqttClient.subscribeAsync('Fronius/solar/tele/SENSOR');
await mqttClient.subscribeAsync('solcast/forecasts');
await mqttClient.subscribeAsync('tasmota/espstrom/tele/SENSOR');
await mqttClient.subscribeAsync('tasmota/spuelmaschine/stat/POWER1');
await mqttClient.subscribeAsync('tasmota/waschmaschine/stat/POWER');
await mqttClient.subscribeAsync('vito/tele/SENSOR');
// await mqttClient.subscribeAsync('Wallbox/evse/state');
await mqttClient.subscribeAsync('auto/tele/STATUS');
await mqttClient.subscribeAsync(`vwsfriend/vehicles/${config.VWId}/domains/charging/batteryStatus/currentSOC_pct`);
await mqttClient.subscribeAsync(`vwsfriend/vehicles/${config.VWId}/domains/charging/chargingSettings/targetSOC_pct`);

while(_.isNull(vitoBetriebsart)) {
  await delay(ms('100ms'));
}

await mqttClient.subscribeAsync('tasmota/heizstab/stat/POWER');
await mqttClient.subscribeAsync('tasmota/heizstab/tele/SENSOR');

//                    s m h     d m wd
const job = new Cron('0 5 14,16,18,20,22 * * *', {timezone: 'Europe/Berlin'}, async() => {
  await getStrompreise();
});

_.noop('Cron job started', job);

await getStrompreise();

healthInterval = setInterval(async() => {
  await mqttClient.publishAsync(`mqtt-strom/health/STATE`, health);
}, ms('1min'));
await mqttClient.publishAsync(`mqtt-strom/health/STATE`, health);
