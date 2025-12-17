#!/usr/bin/env node

/* eslint-disable camelcase */
/* eslint-disable unicorn/no-lonely-if */
/* eslint-disable no-process-exit */

// TODO letzte mqttUpdate timestamp speichern und forceUpdate nur nach min-delay erlauben

import {setTimeout as delay} from 'node:timers/promises';
import os                    from 'node:os';

import _                     from 'lodash';
import AsyncLock             from 'async-lock';
import check                 from 'check-types-2';
import dayjs                 from 'dayjs';
import {execa}               from 'execa';
// import fsExtra               from 'fs-extra';
import {logger}              from '@stheine/helpers';
import mqtt                  from 'mqtt';
import ms                    from 'ms';
import utc                   from 'dayjs/plugin/utc.js';

import configFile            from './configFile.js';
import statusFile            from './statusFile.js';

dayjs.extend(utc);

const forceUpdateDelay = '15s';

// #########################################################################
// Read static data

const config = await configFile.read();
const {vwBatteryCapacityKwh, vwId} = config;

const status = await statusFile.read();
let   {atHome, chargeMode, wallboxState} = status;

// #########################################################################
// Globals

const health          = 'OK'; // TODO irgendwo unhealthy reporten?
let   healthInterval;
const lock            = new AsyncLock();
let   mqttClient;
const hostname        = os.hostname();
const clientId        = `${hostname}-${Math.random().toString(16).slice(2, 8)}`;
// const packageJson     = await fsExtra.readJson('./package.json');

let   chargeEndTimeout;
let   chargeStartTimeout;
let   lastChargeUpdate;
let   lastLadeleistungKw;
let   lastPvProductionKw;
let   lastPvProductionKwAvg;
let   disconnectedHandler;
let   hausBatterySocPct;
let   maxSunTime;
let   missingUpdateHandler;
let   pvProductionKw;
let   revertChargeModeTimeout;
let   strompreise;
let   vwBatterySocPct;
let   vwConnected;
let   vwAutoUnlock;
let   vwParkingLatitude;
let   vwParkingLongitude;
let   vwTargetSoc;
let   vwTargetSocPending;
let   vwUpdated;
let   vwUpdateIntervalS;
let   wallboxExternalCurrent;

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

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

// #########################################################################
// Init MQTT
mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId});

// #########################################################################
// Logging
const logState = function(where) {
  logger.debug(`${where || ''} Status:\n` +
    `  atHome:                    ${atHome}\n` +
    `  chargeMode:                ${chargeMode}\n` +
    `  wallboxState:              ${wallboxState}\n` +
    '  ---\n' +
    `  hausBatterySoc:            ${_.round(hausBatterySocPct, 1)} %\n` +
    `  pvProduction:              ${_.round(pvProductionKw, 1)} kW\n` +
    // `  vwParkingLatitude:      ${vwParkingLatitude}\n` +
    // `  vwParkingLongitude:     ${vwParkingLongitude}\n` +
    `  vwTargetSoc:               ${vwTargetSoc} %` +
      `${vwTargetSocPending && vwTargetSocPending !== vwTargetSoc ? ` (pending: ${vwTargetSocPending} %)` : ''}\n` +
    `  vwBatterySoc:              ${vwBatterySocPct} %\n` +
    `  wallboxExternalCurrent:    ${wallboxExternalCurrent} mA\n` +
    `  vwConnected:               ${vwConnected} ${vwUpdated}\n` +
    ' ');
};

process.on('SIGHUP', async() => {
  logger.debug('lastPvProductionKw', _.map(lastPvProductionKw, kw => _.round(kw, 1)));
  logState('SIGHUP');
});

// #########################################################################
// Functions
const updateStatus = async function(update) {
  for(const [key, value] of Object.entries(update)) {
    status[key] = value;
  }

  await statusFile.write(update);
  await mqttClient.publishAsync('auto/tele/STATUS', JSON.stringify(status), {retain: true});
};

const restartCarconnectivity = async function(service) {
  const {stdout, stderr} = await execa('/usr/local/bin/docker', [
    'restart', `docker-${service}-1`,
  ]);

  if(stderr) {
    logger.info(`Restarted ${service} with error`, {stdout, stderr});
  } else {
    logger.info(`Restarted ${service}`, stdout);
  }
};

const forceUpdate = async function() {
  // TODO carconnectivity?
  // await mqttClient.publishAsync('force update howto??? TODO ???', 'true');
};

const setChargeCurrent = async function(milliAmpere) {
  if(milliAmpere === wallboxExternalCurrent) {
    return;
  }

  const ladestromMa    = milliAmpere;
  const ladeleistungKw = _.round(milliAmpere * 3 * 230 / 1000 / 1000, 1);

  if(lastLadeleistungKw !== ladeleistungKw) {
    logger.debug(`Ladestrom ${ladestromMa} mA, ${ladeleistungKw} kW`);

    lastLadeleistungKw = ladeleistungKw;
  }

  // Ladestrom:  Wallbox/evse/external_current <mA>
  //  6000 mA  =>  4,1 kW   =>  4   kW
  //  7000 mA  =>  4,8 kW   =>  4,5 kW
  //  8000 mA  =>  5,5 kW   =>  5   kW
  //  9000 mA  =>  6,2 kW   =>  6   kW
  // 10000 mA  =>  6,9 kW   =>  6,5 kW
  // 11000 mA  =>  7,6 kW   =>  7   kW
  // 12000 mA  =>  8,3 kW   =>  7   kW
  // 13000 mA  =>  9,0 kW   =>  8   kW
  // 14000 mA  =>  9,7 kW   =>  8,5 kW
  // 15000 mA  => 10,4 kW   =>  9   kW
  // 16000 mA  => 11,0 kW   => 10   kW
  await mqttClient.publishAsync('Wallbox/evse/external_current_update', JSON.stringify(milliAmpere));

  updateStatus({ladestromMa, ladeleistungKw});

  // await delay(ms('5s'));

  // await forceUpdate();
};

const startCharging = async function() {
  check.assert.assigned(wallboxState, 'Missing wallboxState');
  // if(!atHome) {
  //   return;
  // }

  if(wallboxState === 'Lädt') {
    logger.info('Lädt bereits');

    return;
  }

  if(!['Warte auf Ladefreigabe', 'Ladebereit', 'Fehler'].includes(wallboxState)) {
    logger.info(`Falscher wallboxState='${wallboxState}'`);

    return;
  }

//  if((vwTargetSocPending && vwBatterySocPct >= vwTargetSocPending) ||
//    (!vwTargetSocPending && vwBatterySocPct >= vwTargetSoc)
//  ) {
//    logger.info('Ladeziel bereits erreicht');
//
//    return;
//  }

  if(lock.isBusy('changeCharging')) {
    logger.info('changeCharging locked');

    return;
  }

  await lock.acquire('changeCharging', async() => {
    await setChargeCurrent(6000);
    await mqttClient.publishAsync('Wallbox/evse/start_charging', JSON.stringify(null));

    await delay(ms('2s'));

    await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/commands/start-stop_writetopic`, 'start');

    await delay(ms('2s'));

    await forceUpdate();

    let retries = 4;
    let success = false;

    do {
      logger.debug(`Trigger read for start (${wallboxState})`);

      await delay(ms(forceUpdateDelay));

      if(wallboxState === 'Lädt') {
        retries = 0;
        success = true;
      } else {
        retries--;

        if(retries) {
          await forceUpdate();
        }
      }
    } while(retries);

    logger.error('startCharging finished', {wallboxState});

    if(!success) {
      return 1;
    }
  });
};

const stopCharging = async function() {
  lastLadeleistungKw = null;

  if(!['Ladebereit', 'Lädt'].includes(wallboxState)) {
    logger.info(`Lädt nicht (${wallboxState})`);

    return;
  }

  if(lock.isBusy('changeCharging')) {
    logger.info('changeCharging locked');

    return;
  }

  await lock.acquire('changeCharging', async() => {
    await mqttClient.publishAsync('Wallbox/evse/stop_charging', JSON.stringify(null));
    // await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/commands/start-stop_writetopic`, 'stop');

    await delay(ms('2s'));

    await forceUpdate();

    let retries = 4;
    let success = false;

    do {
      logger.debug(`Trigger read for stop (${wallboxState})`);

      await delay(ms(forceUpdateDelay));

      if(!['Ladebereit', 'Lädt'].includes(wallboxState)) {
        retries = 0;
        success = true;
      } else {
        retries--;

        if(retries) {
          await forceUpdate();
        }
      }
    } while(retries);

    logger.error(`stopCharging finished (${wallboxState})`);

    if(!success) {
      return 1;
    }
  });
};

const triggerSofort = async function() {
  if(wallboxState !== 'Lädt') {
    if(vwBatterySocPct < 70) {
      await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', JSON.stringify(70), {retain: true});
    }

    await setChargeCurrent(16000);
    await startCharging();
  }
};

// Handle location
const handleLocation = async function() {
  // logger.debug('handleLocation', {vwParkingLatitude, vwParkingLongitude});

  let newAtHome;

  if(!vwParkingLatitude || !vwParkingLongitude) {
    return;
  }

  if(
    (_.round(vwParkingLatitude, 3) === 48.622 || _.round(vwParkingLatitude, 3) === 48.623) &&
    (_.round(vwParkingLongitude, 3) === 8.886 || _.round(vwParkingLongitude, 3) === 8.887)
  ) {
    newAtHome = true;
  } else {
    newAtHome = false;
  }

  if(newAtHome !== atHome) {
    atHome = newAtHome;

    await updateStatus({atHome});

    logState('handleLocation');

    if(atHome && ['Sofort', 'Sofort+'].includes(chargeMode)) {
      await triggerSofort();
    }

    if(atHome && !vwAutoUnlock) {
      logger.debug('trigger auto-unlock, True', {vwAutoUnlock, atHome});

      await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/settings/auto_unlock_writetopic`,
        'True');
    } else if(!atHome && vwAutoUnlock) {
      logger.debug('trigger auto-unlock, False', {vwAutoUnlock, atHome});

      await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/settings/auto_unlock_writetopic`,
        'False');
    }
  }
};

const getChargeTime = function() {
  check.assert.nonEmptyArray(strompreise, 'strompreise fehlen');

  if(wallboxState === 'Lädt') {
    return {};
  }

  if(vwBatterySocPct >= vwTargetSoc) {
    return {};
  }

  // logger.debug({strompreise});

  const kwhToCharge = vwBatteryCapacityKwh * (vwTargetSoc - vwBatterySocPct) / 100;
  const hoursToCharge = Math.ceil(kwhToCharge / 10);

  const now           = dayjs.utc();
  const tomorrow7Time = now.clone().hour(24 + 7).minute(0).second(0);

  const nightData = _.filter(strompreise, data =>
    dayjs(data.startTime) > now &&
    dayjs(data.startTime) < tomorrow7Time);

  // logger.debug({nightData});

  let key      = 0;
  let minKey;
  let minCost;

  do {
    const cost = _.sum(_.map(_.slice(nightData, key, key + (hoursToCharge * 4)), 'cent'));

    if(minCost === undefined || cost < minCost) {
      minKey  = key;
      minCost = cost;
    }

    key++;
  } while(key + (hoursToCharge * 4) <= nightData.length);

  // logger.debug({kwhToCharge, minKey, minCost, hoursToCharge});

  const chargeStartTime = dayjs(nightData[minKey].startTime);
  const chargeEndTime   = nightData[minKey + (hoursToCharge * 4)] ?
    dayjs(nightData[minKey + (hoursToCharge * 4)].startTime) :
    dayjs(chargeStartTime).add(1, 'hour');

  logger.debug({
    kwhToCharge,
    hoursToCharge,
    nightData:       _.map(nightData, data => `${data.startTime} ${data.cent}c (${data.level})`),
    chargeStartTime: chargeStartTime.toISOString(),
    chargeEndTime:   chargeEndTime.toISOString(),
  });

  return {chargeStartTime, chargeEndTime};
};

const handleNightChargingSchedule = async function() {
  if(chargeMode !== 'Nachts') {
    // TODO => auch dann laden, wenn ladestand gering, und/oder schlechte vorhersage, oder winter
    // logger.debug(`handleNightChargingSchedule, skip for chargeMode=${chargeMode}`);

    return;
  }

  if(chargeStartTimeout && chargeEndTimeout) {
    // logger.debug(`handleNightChargingSchedule, already scheduled`);

    return;
  }

  if(vwBatterySocPct >= vwTargetSoc) {
    // logger.debug(`handleNightChargingSchedule, already charged`);

    return;
  }

  const nowUtc = dayjs.utc();

  if(nowUtc.hour() < 18) {
    // logger.debug(`handleNightChargingSchedule, too early`);

    return;
  }

  const lastPreisStartDate = dayjs.utc(strompreise.at(-1).startTime);
  const diffHours          = lastPreisStartDate.diff(nowUtc, 'hour', true);

  check.assert.greater(diffHours, 20, `Letzter Preis fuer ${strompreise.at(-1).startTime}`);

  const {chargeStartTime, chargeEndTime} = getChargeTime();

  if(chargeStartTime && chargeEndTime) {
    logger.debug('handleNightChargingSchedule, plan for', {
      chargeStartTime: chargeStartTime.toISOString(),
      chargeEndTime:   chargeEndTime.toISOString(),
    });

    chargeStartTimeout = setTimeout(async() => {
      chargeStartTimeout = undefined;

      logger.debug('handleNightChargingSchedule, start charging');

      await startCharging();
      await setChargeCurrent(16000);
    }, chargeStartTime - nowUtc);

    chargeEndTimeout = setTimeout(async() => {
      chargeEndTimeout = undefined;

      logger.debug('handleNightChargingSchedule, stop charging');

      await stopCharging();

      chargeMode = 'Überschuss';

      await updateStatus({chargeMode});

      logger.debug(`Setze chargeMode=${chargeMode}`);

      await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', JSON.stringify(80), {retain: true});
    }, chargeEndTime - nowUtc);
  }
};

const checkPVUeberschussLaden = async function() {
  if(vwBatterySocPct >= vwTargetSoc) {
    return;
  }
  if(!lastPvProductionKwAvg) {
    return;
  }

  const now = dayjs.utc();

  if(!lock.isBusy('changeCharging')) {
    // logger.debug({
    //   lastPvProductionKwAvg: _.round(lastPvProductionKwAvg, 1),
    //   pvProductionKw:        _.round(pvProductionKw, 1),
    // });

    if(['Überschuss', 'Überschuss+'].includes(chargeMode)) {
      if(wallboxState === 'Lädt') {
        if(hausBatterySocPct < 90 && lastPvProductionKwAvg < 1.5 ||
          hausBatterySocPct < 80 && lastPvProductionKwAvg < 2.5 && pvProductionKw <= 4 ||
          hausBatterySocPct < 70 && lastPvProductionKwAvg < 4 && now > maxSunTime ||
          hausBatterySocPct < 20
        ) {
          logger.debug(`PV ${chargeMode}, Laden Ende`, {
            lastPvProductionKwAvg: _.round(lastPvProductionKwAvg, 1),
            pvProductionKw:        _.round(pvProductionKw, 1),
            hausBatterySocPct:     _.round(hausBatterySocPct, 1),
            maxSunTime:            maxSunTime.local().format('HH:mm'),
          });

          await stopCharging();
        } else {
          let chargeBatteryKw = 0;

          if(chargeMode === 'Überschuss+') {
            chargeBatteryKw = -0.5;
          } else if(hausBatterySocPct < 80) {
            chargeBatteryKw = 1;
          } else if(hausBatterySocPct < 90) {
            chargeBatteryKw = 0.5;
          }

          const currentMa = _.max([
            6000,
            _.round((lastPvProductionKwAvg - 0.3 - chargeBatteryKw) * 1000 / 3 / 230 * 1000),
          ]);

          // logger.debug(`calc current=${currentMa}`);

          await setChargeCurrent(currentMa);
        }
      } else if(['Warte auf Ladefreigabe', 'Ladebereit', 'Fehler'].includes(wallboxState) &&
        lastPvProductionKwAvg > 4 &&
        (
          hausBatterySocPct > 80 ||
          hausBatterySocPct > 40 && now < maxSunTime ||
          hausBatterySocPct > 30 && lastPvProductionKwAvg > 6 ||
          hausBatterySocPct > 30 && chargeMode === 'Überschuss+'
        )
      ) {
        logger.debug(`PV ${chargeMode}, Laden Start`, {
          lastPvProductionKwAvg: _.round(lastPvProductionKwAvg, 1),
          hausBatterySocPct:     _.round(hausBatterySocPct, 1),
          maxSunTime:            maxSunTime.local().format('HH:mm'),
          wallboxState,
        });

        await setChargeCurrent(6000);
        await startCharging();
      }
    }
  }
};

// #########################################################################
// Handle data
mqttClient.on('message', async(topic, messageBuffer) => {
  const messageRaw = messageBuffer.toString();

  try {
    let message;

    try {
      message = JSON.parse(messageRaw);
    } catch{
      message = messageRaw;
    }

    if(topic.startsWith('auto/cmnd/')) {
      const cmnd = topic.replace(/^auto\/cmnd\//, '');

      // console.log({topic, message, cmnd});

      switch(cmnd) {
        case 'setChargeMode': {
          if(['Aus', 'Nachts', 'Sofort', 'Sofort+', 'Überschuss', 'Überschuss+'].includes(message)) {
            chargeMode = message;

            await updateStatus({chargeMode});

            logger.debug(`Setze chargeMode=${chargeMode}`);

            if(chargeEndTimeout) { // TODO was, wenn er gerade laedt?
              clearTimeout(chargeEndTimeout);
              chargeEndTimeout = undefined;
            }
            if(chargeStartTimeout) {
              clearTimeout(chargeStartTimeout);
              chargeStartTimeout = undefined;
            }
            if(revertChargeModeTimeout) {
              clearTimeout(revertChargeModeTimeout);
              revertChargeModeTimeout = undefined;
            }

            switch(chargeMode) {
              case 'Aus':
                await stopCharging();
                break;

              case 'Nachts': {
                if(wallboxState === 'Lädt') {
                  await stopCharging();
                }

                await handleNightChargingSchedule();
                break;
              }

              case 'Sofort':
              case 'Sofort+':
                await triggerSofort();

                revertChargeModeTimeout = setTimeout(async() => {
                  await mqttClient.publishAsync('auto/cmnd/setChargeMode', 'Überschuss+');
                }, ms('12h'));
                break;

              case 'Überschuss':
              case 'Überschuss+':
                // if(wallboxState === 'Lädt') {
                //   await stopCharging();
                // }

                // if(vwTargetSocPending && vwTargetSocPending !== 80 ||
                //   !vwTargetSocPending && vwTargetSoc !== 80
                // ) {
                  // await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', JSON.stringify(80), {retain: true});
                // }

                // Handled in 'Fronius/solar/tele/SENSOR'
                break;

              default:
                logger.error(`Unhandled chargeMode='${chargeMode}'`);
                break;
            }
          } else {
            logger.error(`Unhandled chargeMode='${message}'`);
          }
          break;
        }

        case 'forceUpdate':
          await forceUpdate();
          break;

        case 'setChargeCurrent':
          await setChargeCurrent(message);
          break;

        case 'startCharging':
          await startCharging();
          break;

        case 'stopCharging':
          await stopCharging();
          break;

        case 'vwTargetSocPending':
          if(message) {
            if(message !== vwTargetSoc) {
              vwTargetSocPending = message;

              logger.debug(`Setze targetSoc=${message} (pending)`);

              await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/settings/target_level_writetopic`,
                JSON.stringify(message));
            } else {
              vwTargetSocPending = null;
              await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', '', {retain: true});
            }
          } else {
            vwTargetSocPending = null;
          }
          break;

        default:
          logger.error(`Unhandled cmnd '${cmnd}'`, message);
          break;
      }

      return;
    }

    switch(topic) {
      case 'Fronius/solar/tele/SENSOR': {
        const now = dayjs.utc();

        hausBatterySocPct = message.battery.stateOfCharge * 100;
        pvProductionKw    = message.solar.powerOutgoing / 1000;

        if(!lastChargeUpdate) {
          lastChargeUpdate = now;
        } else if((now - lastChargeUpdate) > ms('2m')) {
          await checkPVUeberschussLaden();

          lastChargeUpdate = now;
        }
        break;
      }

      case 'maxSun/INFO': {
        const maxSun = message;
        const maxSunDate = new Date(maxSun);
        const now = dayjs.utc();

        maxSunTime = now.clone()
          .hour(maxSunDate.getUTCHours())
          .minute(maxSunDate.getUTCMinutes())
          .second(0);
        break;
      }

      case 'strom/tele/preise':
        strompreise = message;
        break;

      case 'strom/tele/solarProduction':
        ({lastPvProductionKw, lastPvProductionKwAvg} = message);
        break;

      case 'carconnectivity/connectors/volkswagen/connection_state':
        vwConnected = message === 'True' || message === 'connected';

        // logger.debug('connection_state', {vwUpdated, vwUpdateIntervalS, vwConnected});

        if(vwUpdateIntervalS) {
          if(vwConnected) {
            if(disconnectedHandler) {
              // logger.debug('Clear disconnectedTimeout', {vwConnected, vwUpdated});
              clearTimeout(disconnectedHandler);
              disconnectedHandler = null;
            }
          } else if(!disconnectedHandler) {
            // logger.debug('Start disconnectedTimeout', {vwConnected, vwUpdated});
            disconnectedHandler = setTimeout(async() => {
              disconnectedHandler = undefined;
              logger.debug('Trigger restart in disconnected handler');

              await restartCarconnectivity('carconnectivity-mqtt');
            }, ms(`${8 * vwUpdateIntervalS / 60 + 1}m`));
          }
        }
        break;

      case 'carconnectivity/connectors/volkswagen/interval': {
        const intervalParts = message.split(':');

        vwUpdateIntervalS = Number(intervalParts[0]) * 3600 +
          Number(intervalParts[1]) * 60 +
          Number(intervalParts[2]);
        break;
      }

      case 'carconnectivity/connectors/volkswagen/last_update':
        if(vwUpdateIntervalS) {
          vwUpdated = message;

          const now   = dayjs.utc();
          const ageMs = now - dayjs(vwUpdated);

          // logger.debug('last_update', {vwUpdated, vwUpdateIntervalS, ageS: ageMs / 1000});

          if(ageMs < ms(`${8 * vwUpdateIntervalS / 60 + 1}m`)) {
            if(missingUpdateHandler) {
              clearTimeout(missingUpdateHandler);
              missingUpdateHandler = null;
            }

            missingUpdateHandler = setTimeout(async() => {
              missingUpdateHandler = undefined;
              logger.debug('Trigger missingUpdate handler', {vwConnected, vwUpdated});

              await restartCarconnectivity('carconnectivity-mqtt');
            }, ms(`${8 * vwUpdateIntervalS / 60 + 1}m`) - ageMs);
          } else {
            logger.debug(`Outdated update: ${vwUpdated}`, {vwConnected, vwUpdated});

            await restartCarconnectivity('carconnectivity-mqtt');
          }
        }
        break;

      case `carconnectivity/garage/${vwId}/drives/primary/level`:
        vwBatterySocPct = message;
        break;

      case `carconnectivity/garage/${vwId}/charging/settings/auto_unlock`:
        vwAutoUnlock = message === 'True';

        logger.debug({vwAutoUnlock, message});
        break;

      case `carconnectivity/garage/${vwId}/charging/settings/target_level`:
        vwTargetSoc = message;

        if(vwTargetSocPending) {
          if(vwTargetSocPending === vwTargetSoc) {
            logger.debug(`Pending targetSoc=${message} active now`);

            await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', '', {retain: true});
          } else {
            logger.debug(`Pending targetSoc=${message}=>${vwTargetSocPending} still pending`);

            await delay(ms('30s'));

            await mqttClient.publishAsync(`carconnectivity/garage/${vwId}/charging/settings/target_level_writetopic`,
              JSON.stringify(vwTargetSocPending));
          }
        }
        break;

      case `carconnectivity/garage/${vwId}/position/latitude`:
        vwParkingLatitude = Number(message);

        await handleLocation();
        break;

      case `carconnectivity/garage/${vwId}/position/longitude`:
        vwParkingLongitude = Number(message);

        await handleLocation();
        break;

      case 'Wallbox/evse/boost_mode':
        if(!message?.enabled) {
          await mqttClient.publishAsync('Wallbox/evse/boost_mode_update', JSON.stringify(true));
        }
        break;

      case 'Wallbox/evse/external_clear_on_disconnect':
        if(!message?.clear_on_disconnect) {
          await mqttClient.publishAsync('Wallbox/evse/external_clear_on_disconnect_update', JSON.stringify(true));
        }
        break;

      case 'Wallbox/evse/external_current':
        wallboxExternalCurrent = message?.current;

        // logState('Wallbox/evse/external_current');
        break;

      case 'Wallbox/evse/external_enabled':
        if(!message?.enabled) {
          await mqttClient.publishAsync('Wallbox/evse/external_enabled_update', JSON.stringify(true));
        }
        break;

      case 'Wallbox/evse/state': {
        let newWallboxState;

        switch(message.charger_state) {
          case 0:  newWallboxState = 'Nicht verbunden'; break;
          case 1:  newWallboxState = 'Warte auf Ladefreigabe'; break;
          case 2:  newWallboxState = 'Ladebereit'; break;
          case 3:  newWallboxState = 'Lädt'; break;
          case 4:  newWallboxState = 'Fehler'; break;
          default: newWallboxState = message.charger_state; break;
        }

        if(wallboxState && wallboxState !== 'Lädt' && newWallboxState === 'Lädt') {
          await mqttClient.publishAsync(`mqtt-notify/notify`, JSON.stringify({
            priority: -1,
            sound:    'none',
            title:    '🚗 Auto',
            message:  `Ladestart bei ${vwBatterySocPct}%`,
          }));
        } else if(wallboxState === 'Lädt' && newWallboxState !== 'Lädt') {
          await mqttClient.publishAsync(`mqtt-notify/notify`, JSON.stringify({
            priority: -1,
            sound:    'none',
            title:    '🚗 Auto',
            message:  `Ladeende bei ${vwBatterySocPct}%`,
          }));
        }

        wallboxState = newWallboxState;

        await updateStatus({wallboxState});

        switch(chargeMode) {
          case 'Sofort':
          case 'Sofort+':
            await triggerSofort();
            break;

          case 'Überschuss':
          case 'Überschuss+':
            await checkPVUeberschussLaden();
            break;

          default:
            // Nothing
            break;
        }

        // logState('Wallbox/evse/state');
        break;
      }

      case 'Wallbox/power_manager/external_control':
        // logger.debug(topic, message);
        // 0 - Keine Phasen angefordert, keine Stromfreigabe.
        // 1 - Eine Phase angefordert.
        // 3 - Drei Phasen angefordert.
        check.assert.identical(message, {phases_wanted: 0});
        break;

      default:
        logger.error(`Unhandled topic '${topic}'`, message);
        break;
    }
  } catch(err) {
    logger.error('mqtt handler failed', {topic, messageRaw, errMessage: err.message});
  }
});

// // eslint-disable-next-line no-console
// console.log('\u001B]2;auto\u0007'); // windowTitle
logger.info(`-------------------- Startup --------------------`);
// logger.info(`${packageJson.name} ${packageJson.version}`);

// Subscribe
await mqttClient.subscribeAsync('auto/cmnd/#');
await mqttClient.subscribeAsync('carconnectivity/connectors/volkswagen/interval');         // order A
await mqttClient.subscribeAsync('carconnectivity/connectors/volkswagen/connection_state'); // order B
await mqttClient.subscribeAsync('carconnectivity/connectors/volkswagen/last_update');      // order C
await mqttClient.subscribeAsync(`carconnectivity/garage/${vwId}/drives/primary/level`);
await mqttClient.subscribeAsync(`carconnectivity/garage/${vwId}/charging/settings/auto_unlock`);
await mqttClient.subscribeAsync(`carconnectivity/garage/${vwId}/charging/settings/target_level`);
await mqttClient.subscribeAsync(`carconnectivity/garage/${vwId}/position/latitude`);
await mqttClient.subscribeAsync(`carconnectivity/garage/${vwId}/position/longitude`);
await mqttClient.subscribeAsync('Fronius/solar/tele/SENSOR');
await mqttClient.subscribeAsync('maxSun/INFO');
await mqttClient.subscribeAsync('strom/tele/preise');
await mqttClient.subscribeAsync('strom/tele/solarProduction');
await mqttClient.subscribeAsync('Wallbox/evse/boost_mode');
await mqttClient.subscribeAsync('Wallbox/evse/external_clear_on_disconnect');
await mqttClient.subscribeAsync('Wallbox/evse/external_current');
await mqttClient.subscribeAsync('Wallbox/evse/external_enabled');
await mqttClient.subscribeAsync('Wallbox/evse/state');
await mqttClient.subscribeAsync('Wallbox/power_manager/external_control');

await handleNightChargingSchedule();

setInterval(() => handleNightChargingSchedule(),
  ms('5 minutes'));

healthInterval = setInterval(async() => {
  await mqttClient.publishAsync(`auto/health/STATE`, health);
}, ms('1min'));
await mqttClient.publishAsync(`auto/health/STATE`, health);
