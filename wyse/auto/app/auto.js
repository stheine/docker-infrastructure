#!/usr/bin/env node

/* eslint-disable camelcase */
/* eslint-disable no-process-exit */

// TODO letzte mqttUpdate timestamp speichern und forceUpdate nur nach min-delay erlauben
// TODO zeitstempel vom vwPlugConnectionState per mqtt senden, und im ui 30 min danach optionen anbieten

import {setTimeout as delay} from 'node:timers/promises';
import os                    from 'node:os';

import _                     from 'lodash';
import AsyncLock             from 'async-lock';
import check                 from 'check-types-2';
import dayjs                 from 'dayjs';
import {execa}               from 'execa';
import fsExtra               from 'fs-extra';
import {logger}              from '@stheine/helpers';
import mqtt                  from 'mqtt';
import ms                    from 'ms';
import Ringbuffer            from '@stheine/ringbufferjs';
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
const packageJson     = await fsExtra.readJson('./package.json');

const vwPrefix        = `vwsfriend/vehicles/${vwId}`;
let   chargeEndTimeout;
let   chargeStartTimeout;
let   lastChargeUpdate;
const lastPvProductionKw = new Ringbuffer(60); // Fronius/solar/tele/SENSOR every 5s => 60 => 5min
let   disconnectedHandler;
let   hausBatterySocPct;
let   maxSunTime;
let   missingUpdateHandler;
let   pvProductionKw;
let   strompreise;
let   vwBatterySocPct;
let   vwBatteryTemperatureC;
let   vwChargePowerKw;
let   vwChargingState;
let   vwCruisingRange;
let   vwIsActive;
let   vwIsOnline;
let   vwPlugConnectionState;
let   vwParkingLatitude;
let   vwParkingLongitude;
let   vwTargetSoc;
let   vwTargetSocPending;
let   wallboxExternalCurrent;
let   weconnectConnected;
let   weconnectUpdated;
let   weconnectUpdateIntervalS;

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
    `  vwChargingState:           ${vwChargingState}\n` +
    `  wallboxState:              ${wallboxState}\n` +
    '  ---\n' +
    `  hausBatterySoc:            ${_.round(hausBatterySocPct, 1)} %\n` +
    `  pvProduction:              ${_.round(pvProductionKw, 1)} kW\n` +
    `  vwIsActive:                ${vwIsActive}\n` +
    `  vwIsOnline:                ${vwIsOnline}\n` +
    `  vwChargePowerKw:           ${vwChargePowerKw} kW\n` +
    `  vwPlugConnectionState:     ${vwPlugConnectionState}\n` +
    // `  vwParkingLatitude:      ${vwParkingLatitude}\n` +
    // `  vwParkingLongitude:     ${vwParkingLongitude}\n` +
    `  vwCruisingRange:           ${vwCruisingRange} km\n` +
    `  vwTargetSoc:               ${vwTargetSoc} %` +
      `${vwTargetSocPending && vwTargetSocPending !== vwTargetSoc ? ` (pending: ${vwTargetSocPending} %)` : ''}\n` +
    `  vwBatterySoc:              ${vwBatterySocPct} %\n` +
    `  vwBatteryTemperature:      ${vwBatteryTemperatureC} °C\n` +
    `  wallboxExternalCurrent:    ${wallboxExternalCurrent} mA\n` +
    `  weconnectConnected:        ${weconnectConnected} ${weconnectUpdated}\n` +
    ' ');
};

process.on('SIGHUP', async() => {
  logger.debug('lastPvProductionKw', _.map(lastPvProductionKw.dump(), kw => _.round(kw, 1)));
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

const restartVwsFriend = async function() {
  const {stdout, stderr} = await execa('/usr/local/bin/docker', [
    'restart', 'docker-vwsfriend-1',
  ]);

  if(stderr) {
    logger.info('Restarted vwsfriend with error', {stdout, stderr});
  } else {
    logger.info('Restarted vwsfriend', stdout);
  }
};

const forceUpdate = async function() {
  await mqttClient.publishAsync('vwsfriend/mqtt/weconnectForceUpdate_writetopic', 'true');
};

const startCharging = async function() {
  check.assert.assigned(wallboxState, 'Missing wallboxState');
  // check.assert.equal(vwPlugConnectionState, 'connected', 'Not connected');

  if(!atHome) {
    return;
  }

  if(wallboxState === 'Lädt') {
    logger.info('Lädt bereits');

    return;
  }

  if(vwBatterySocPct >= vwTargetSoc) {
    logger.info('Ladeziel bereits erreicht');

    return;
  }

  if(lock.isBusy('changeCharging')) {
    logger.info('changeCharging locked');

    return;
  }

  await lock.acquire('changeCharging', async() => {
    await mqttClient.publishAsync('Wallbox/evse/external_current_update', JSON.stringify(6000));
    await mqttClient.publishAsync('Wallbox/evse/start_charging', JSON.stringify(null));

    await delay(ms('2s'));

    await mqttClient.publishAsync(`${vwPrefix}/controls/charging_writetopic`, 'start');

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

const setChargeCurrent = async function(milliAmpere) {
  if(milliAmpere === wallboxExternalCurrent) {
    return;
  }

  const ladestromMa    = milliAmpere;
  const ladeleistungKw = _.round(milliAmpere * 3 * 230 / 1000 / 1000, 1);

  logger.debug(`Ladestrom ${ladestromMa} mA, ${ladeleistungKw} kW`);

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

const stopCharging = async function() {
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
    await mqttClient.publishAsync(`${vwPrefix}/controls/charging_writetopic`, 'stop');

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

    await startCharging();
    await setChargeCurrent(16000);
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

    if(atHome && chargeMode === 'Sofort') {
      await triggerSofort();
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
    const cost =
      _.sum(_.map(_.slice(nightData, key, key + hoursToCharge), 'cent')) / hoursToCharge * kwhToCharge;

    if(minCost === undefined || cost < minCost) {
      minKey  = key;
      minCost = cost;
    }

    key++;
  } while(key + hoursToCharge <= nightData.length);

  // logger.debug({kwhToCharge, minKey, minCost, hoursToCharge});

  const chargeStartTime = dayjs(nightData[minKey].startTime);
  const chargeEndTime   = nightData[minKey + hoursToCharge] ?
    dayjs(nightData[minKey + hoursToCharge].startTime) :
    dayjs(chargeStartTime).add(1, 'hour');

  logger.debug({
    kwhToCharge,
    hoursToCharge,
    nightData:       _.map(nightData, data => `${data.startTime} ${data.cent}c (${data.level})`),
    minCost:         _.round(minCost),
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

  const now = dayjs.utc();

  if(!lock.isBusy('changeCharging')) {
    const averagePvProductionKw = lastPvProductionKw.avg() || pvProductionKw;

    // logger.debug({
    //   averagePvProductionKw: _.round(averagePvProductionKw, 1),
    //   pvProductionKw:        _.round(pvProductionKw, 1),
    // });

    if(['Überschuss', 'Überschuss+'].includes(chargeMode)) {
      if(wallboxState === 'Lädt') {
        if(hausBatterySocPct < 90 && averagePvProductionKw < 1.5 ||
          hausBatterySocPct < 80 && averagePvProductionKw < 2.5 && pvProductionKw <= 4 ||
          hausBatterySocPct < 70 && averagePvProductionKw < 4 && now > maxSunTime
        ) {
          logger.debug(`PV ${chargeMode}, Laden Ende`, {
            averagePvProductionKw: _.round(averagePvProductionKw, 1),
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
            _.round((averagePvProductionKw - 0.3 - chargeBatteryKw) * 1000 / 3 / 230 * 1000),
          ]);

          // logger.debug(`calc current=${currentMa}`);

          await setChargeCurrent(currentMa);
        }
      } else if(['Warte auf Ladefreigabe', 'Ladebereit', 'Fehler'].includes(wallboxState) &&
        averagePvProductionKw > 4 &&
        (
          hausBatterySocPct > 80 ||
          hausBatterySocPct > 40 && now < maxSunTime ||
          averagePvProductionKw > 6 ||
          chargeMode === 'Überschuss+'
        )
      ) {
        logger.debug(`PV ${chargeMode}, Laden Start`, {
          averagePvProductionKw: _.round(averagePvProductionKw, 1),
          hausBatterySocPct:     _.round(hausBatterySocPct, 1),
          maxSunTime:            maxSunTime.local().format('HH:mm'),
        });

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
          if(['Aus', 'Nachts', 'Sofort', 'Überschuss', 'Überschuss+'].includes(message)) {
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
                await triggerSofort();
                break;

              case 'Überschuss':
              case 'Überschuss+':
                // if(wallboxState === 'Lädt') {
                //   await stopCharging();
                // }

                await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', JSON.stringify(80), {retain: true});

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
          vwTargetSocPending = message;

          if(message) {
            logger.debug(`Setze targetSoc=${message} (pending)`);

            await mqttClient.publishAsync(`${vwPrefix}/domains/charging/chargingSettings/targetSOC_pct_writetopic`,
              JSON.stringify(message));
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

        lastPvProductionKw.enq(pvProductionKw);

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

      case 'vwsfriend/mqtt/weconnectConnected':
        if(weconnectUpdateIntervalS) {
          weconnectConnected = message === 'True';

          if(weconnectConnected) {
            if(disconnectedHandler) {
              logger.debug('Clear disconnectedTimeout');
              clearTimeout(disconnectedHandler);
              disconnectedHandler = null;
            }
          } else if(!disconnectedHandler) {
            logger.debug('Start disconnectedTimeout');
            disconnectedHandler = setTimeout(async() => {
              disconnectedHandler = undefined;
              logger.debug('Trigger restart in disconnected handler');
              await restartVwsFriend();
            }, ms(`${2 * weconnectUpdateIntervalS / 60 + 1}m`));
          }
        }
        break;

      case 'vwsfriend/mqtt/weconnectUpdateInterval_s':
        weconnectUpdateIntervalS = message;
        break;

      case 'vwsfriend/mqtt/weconnectUpdated': {
        if(weconnectUpdateIntervalS) {
          weconnectUpdated = message;

          const now   = dayjs.utc();
          const ageMs = now - dayjs(weconnectUpdated);
          // const ageS  = ageMs / 1000;

          // logger.debug('weconnectUpdated', {weconnectUpdated, ageS});

          if(ageMs < ms(`${2 * weconnectUpdateIntervalS / 60 + 1}m`)) {
            if(missingUpdateHandler) {
              clearTimeout(missingUpdateHandler);
              missingUpdateHandler = null;
            }

            missingUpdateHandler = setTimeout(async() => {
              missingUpdateHandler = undefined;
              logger.debug('Trigger missingUpdate handler');
              await restartVwsFriend();
            }, ms(`${2 * weconnectUpdateIntervalS + 1}m`) - ageMs);
          } else {
            logger.debug('Outdated update');
            await restartVwsFriend();
          }
        }
        break;
      }

      case `${vwPrefix}/domains/charging/batteryStatus/currentSOC_pct`:
        vwBatterySocPct = message;
        break;

      case `${vwPrefix}/domains/charging/batteryStatus/cruisingRangeElectric_km`:
        vwCruisingRange = message;
        break;

      case `${vwPrefix}/domains/charging/chargingStatus/chargePower_kW`:
        vwChargePowerKw = message;
        break;

      case `${vwPrefix}/domains/charging/chargingStatus/chargingState`:
        if(message) {
          vwChargingState = message;
        }
        break;

      case `${vwPrefix}/domains/charging/chargingSettings/targetSOC_pct`:
        vwTargetSoc = message;

        if(vwTargetSocPending) {
          if(vwTargetSocPending === vwTargetSoc) {
            logger.debug(`Pending targetSoc=${message} active now`);

            await mqttClient.publishAsync('auto/cmnd/vwTargetSocPending', '', {retain: true});
          } else {
            logger.debug(`Pending targetSoc=${message}=>${vwTargetSocPending} still pending`);

            await delay(ms('30s'));

            await mqttClient.publishAsync(`${vwPrefix}/domains/charging/chargingSettings/targetSOC_pct_writetopic`,
              JSON.stringify(vwTargetSocPending));
          }
        }
        break;

      case `${vwPrefix}/domains/charging/plugStatus/plugConnectionState`:
        vwPlugConnectionState = message;
        break;

      case `${vwPrefix}/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMin_K`:
        vwBatteryTemperatureC = Number(message) - 273.15;
        break;

      case `${vwPrefix}/domains/readiness/readinessStatus/connectionState/isActive`:
        vwIsActive = message === 'True';
        break;

      case `${vwPrefix}/domains/readiness/readinessStatus/connectionState/isOnline`:
        vwIsOnline = message === 'True';
        break;

      case `${vwPrefix}/parking/parkingPosition/latitude`:
        vwParkingLatitude = Number(message);

        await handleLocation();
        break;

      case `${vwPrefix}/parking/parkingPosition/longitude`:
        vwParkingLongitude = Number(message);

        await handleLocation();
        break;

      case 'Wallbox/evse/auto_start_charging':
        check.assert.false(message?.auto_start_charging);
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
        await checkPVUeberschussLaden();

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

// eslint-disable-next-line no-console
console.log('\u001B]2;auto\u0007'); // windowTitle
logger.info(`-------------------- Startup --------------------`);
logger.info(`${packageJson.name} ${packageJson.version}`);

// Subscribe
await mqttClient.subscribeAsync('auto/cmnd/#');
await mqttClient.subscribeAsync('Fronius/solar/tele/SENSOR');
await mqttClient.subscribeAsync('maxSun/INFO');
await mqttClient.subscribeAsync('strom/tele/preise');
await mqttClient.subscribeAsync('vwsfriend/mqtt/weconnectUpdateInterval_s');
await mqttClient.subscribeAsync('vwsfriend/mqtt/weconnectConnected');
await mqttClient.subscribeAsync('vwsfriend/mqtt/weconnectUpdated');
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/batteryStatus/currentSOC_pct`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/batteryStatus/cruisingRangeElectric_km`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/chargingStatus/chargePower_kW`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/chargingStatus/chargingState`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/chargingSettings/targetSOC_pct`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/charging/plugStatus/plugConnectionState`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMin_K`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/readiness/readinessStatus/connectionState/isActive`);
await mqttClient.subscribeAsync(`${vwPrefix}/domains/readiness/readinessStatus/connectionState/isOnline`);
await mqttClient.subscribeAsync(`${vwPrefix}/parking/parkingPosition/latitude`);
await mqttClient.subscribeAsync(`${vwPrefix}/parking/parkingPosition/longitude`);
await mqttClient.subscribeAsync('Wallbox/evse/auto_start_charging');
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
