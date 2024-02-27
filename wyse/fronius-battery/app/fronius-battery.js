#!/usr/bin/env node

/* eslint-disable camelcase */

import fsPromises            from 'node:fs/promises';
import os                    from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

import _                     from 'lodash';
import AsyncLock             from 'async-lock';
import axios                 from 'axios';
import check                 from 'check-types-2';
import cron                  from 'node-cron';
import dayjs                 from 'dayjs';
import fsExtra               from 'fs-extra';
import ms                    from 'ms';
import mqtt                  from 'async-mqtt';
import promiseAllByKeys      from 'promise-results/allKeys.js';
import Ringbuffer            from '@stheine/ringbufferjs';
import utc                   from 'dayjs/plugin/utc.js';

import FroniusClient         from './fronius-client.js';
import getLatestVersion      from './getLatestVersion.js';
import logger                from './logger.js';
import {sendMail}            from './mail.js';
import sunspecInverter       from './sunspec_map_inverter.js';
import sunspecSmartMeter     from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

// ###########################################################################
// Globals

let   config;
const dcPowers = new Ringbuffer(10);
const einspeisungen = new Ringbuffer(60);
let   froniusBatteryStatus;
let   froniusInterval;
const hostname = os.hostname();

let   healthInterval;
let   inverter;
let   lastLog;
let   lastRate;
const lock = new AsyncLock();
let   maxSun = 0;
let   momentanLeistung = 0;
let   mqttClient;
const notified = {};
let   smartMeter;
let   smartMeterInterval;

dcPowers.enq(0);
einspeisungen.enq(0);

const updateFroniusBatteryStatus = async function(set) {
  await lock.acquire('fronius-battery.json', async() => {
    froniusBatteryStatus = {...froniusBatteryStatus, ...set};

    await mqttClient.publish('Fronius/solar/tele/STATUS', JSON.stringify(froniusBatteryStatus),
      {retain: true});

    await fsPromises.copyFile('/var/fronius/fronius-battery.json',
      '/var/fronius/fronius-battery.json.bak');
    await fsExtra.writeJson('/var/fronius/fronius-battery.json', froniusBatteryStatus,
      {spaces: 2});
  });
};

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(froniusInterval) {
    clearInterval(froniusInterval);
    // logger.info('fronius.closed');
    froniusInterval = undefined;
  }

  if(inverter) {
    await inverter.close();
    // logger.info('inverter.closed');
    inverter = undefined;
  }

  if(smartMeter) {
    if(smartMeterInterval) {
      clearInterval(smartMeterInterval);
      smartMeterInterval = undefined;
    }

    await smartMeter.close();
    // logger.info('smartMeter.closed');
    smartMeter = undefined;
  }

  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Solcast, weather forecast

const getSolcastForecasts = async function() {
  let cacheAge;
  let cachedSolcast;
  let newSolcast;

  try {
    await fsPromises.access('/var/fronius/solcast-cache.json');

    const stats = await fsPromises.stat('/var/fronius/solcast-cache.json');

    cacheAge = stats ? Date.now() - stats.mtime : null;

    if(cacheAge) {
      cachedSolcast = await fsExtra.readJSON('/var/fronius/solcast-cache.json');

      check.assert.object(cachedSolcast);
      check.assert.array(cachedSolcast.forecasts);
    }

    if(cacheAge && cacheAge < ms('30 minutes')) {
      // Return cached data
      return cachedSolcast.forecasts;
    }
  } catch {
    cacheAge = null;
  }

  try {
    // logger.info('Refresh solcast cache');

    const response = await axios.get(
      `https://api.solcast.com.au/rooftop_sites/${config.RESOURCE_ID}/forecasts?hours=36`,
      {
        headers: {Authorization: `Bearer ${config.API_KEY}`},
        json:    true,
      }
    );

    newSolcast = response.data;

    check.assert.object(newSolcast);
    check.assert.array(newSolcast.forecasts);

    await fsExtra.writeJson('/var/fronius/solcast-cache.json', newSolcast, {spaces: 2});

    await mqttClient.publish('solcast/forecasts', JSON.stringify(newSolcast.forecasts), {retain: true});

    return newSolcast.forecasts;
  } catch(err) {
    // Failed to update the solcast data
    if(cacheAge && cacheAge < ms('90 minutes')) {
      // Return cached data
      return cachedSolcast.forecasts;
    }

    throw new Error(`Failed to refresh solcast data and cache outdated: ${err.message}`);
  }
};

const wattToRate = function({capacityWh, watt}) {
  if(!capacityWh) {
    return 0;
  }

  const rate = _.max([_.min([watt / capacityWh, 1]), 0]);

  return rate;
};

const getBatteryRate = function({capacityWh, chargeState, log, solcastForecasts}) {
  if(!capacityWh) {
    return 0;
  }

  const maxDcPower        = _.max(dcPowers.dump());
  const maxEinspeisung    = _.max(einspeisungen.dump());
  const toChargeWh        = _.round(capacityWh * (100 - chargeState) / 100);
  let   demandOvernightWh = 0;
  let   tomorrowPvWh      = 0;
  let   totalPvWh         = 0;
  let   totalPvHours      = 0;
  let   highPvWh          = 0;
  let   highPvHours       = 0;
  const highPvEstimates   = [];
  let   limitPvWh         = 0;
  let   limitPvHours      = 0;
  let   note;
  let   rate;
  const now          = dayjs.utc();
  const maxSunTime   = now.clone()
    .hour(new Date(maxSun).getUTCHours())
    .minute(new Date(maxSun).getUTCMinutes())
    .second(0);
  const today22Time = now.clone().hour(22).minute(0).second(0);
  const tomorrow6Time = now.clone().hour(30).minute(0).second(0);
  const midnightTime = now.clone().hour(24).minute(0).second(0);
  const tomorrowMidnightTime = now.clone().hour(48).minute(0).second(0);
  const tomorrowNoonTime = now.clone().hour(36).minute(0).second(0);

  // Note, the pv_estimate is given in kWh. Multiply 1000 to get Wh.
  for(const forecast of solcastForecasts) {
    const {period_end} = forecast;
    const period_end_date = Date.parse(period_end);

    const {pv_estimate90: estimateKWh} = forecast;
    const estimateWh = estimateKWh * 1000; // kWh to Wh

    switch(true) {
      case period_end_date < Date.now():
        // Already passed
        break;

      case period_end_date < midnightTime:
        // Today
        totalPvWh += estimateWh / 2;

        // console.log({estimateWh});

        if(estimateWh > 500) {
          // Estimate is for 30 minute period
          totalPvHours += 1 / 2;
        }
        if(estimateWh > 3000) {
          // Estimate is for 30 minute period
          highPvWh    += estimateWh / 2;
          highPvHours += 1 / 2;
          highPvEstimates.push(_.round(estimateWh));
        }
        if(estimateWh > config.dcLimit) {
          // Estimate is for 30 minute period
          limitPvWh    += estimateWh / 2;
          limitPvHours += 1 / 2;
        }
        break;

      case period_end_date < tomorrowMidnightTime:
        // Tomorrow
        tomorrowPvWh += estimateWh / 2;

        break;

      default:
        // After tomorrow
        break;
    }

    if(period_end_date > maxSunTime && period_end_date < tomorrowNoonTime) {
      // This includes the coming night
      let predictDemandWh;

      if(period_end_date < today22Time || period_end_date > tomorrow6Time) {
        predictDemandWh = 500;
      } else {
        predictDemandWh = 200;
      }

      if(estimateWh < predictDemandWh) {
        demandOvernightWh += (predictDemandWh - estimateWh) / 2;

        // console.log({period_end: dayjs(period_end_date).format('HH:mm'), predictDemandWh, estimateWh});
      }
    }
  }

  // Charge to at least 20%
  // On the weekend (Saturday, Sunday) (try to) charge to 100% (to allow the BMS to calibrate the SoC)
  // In April/ September/ October charge to springChargeGoal (95%)
  // In May/ June/ July/ August charge to summerChargeGoal (80%)
  if(froniusBatteryStatus.chargeMax) {
    note = `Charge maximum.`;
    rate = 1;
  } else if(chargeState < 20) {
    note = `Charge to min of 20% (is ${chargeState}%) with max.`;
    rate = 1;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 4, 11) &&
    chargeState > config.springChargeGoal &&
    tomorrowPvWh > 3 * capacityWh &&
    demandOvernightWh < capacityWh * config.springChargeGoal / 100 &&
    !froniusBatteryStatus.chargeTo
  ) {
    note = `April to October, limit to ${config.springChargeGoal}%.`;
    rate = 0;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 5, 9) &&
    chargeState > config.summerChargeGoal &&
    tomorrowPvWh > 3 * capacityWh &&
    demandOvernightWh < capacityWh * config.summerChargeGoal / 100 &&
    !froniusBatteryStatus.chargeTo
  ) {
    note = `May to August, limit to ${config.summerChargeGoal}%.`;
    rate = 0;
  } else if(toChargeWh < capacityWh * 0.03) {
    note = `Charge the last few Wh with ${capacityWh * 0.05}W (${toChargeWh}Wh toCharge).`;
    rate = wattToRate({capacityWh, watt: capacityWh * 0.05});
  } else if(maxDcPower > config.dcLimit) {
    if(limitPvHours || maxDcPower > config.dcLimit) {
      note = `PV (${maxDcPower}W) over the limit and very good forecast. ` +
        `Charge what's over the limit minus momentanLeistung, min ${capacityWh * 0.1}W, max ${toChargeWh / (limitPvHours || 1)}W.`;
      rate = wattToRate({
        capacityWh,
        watt: _.max([
          capacityWh * 0.1,                                                // At least 0.1C
          maxDcPower + 10 - _.max([0, momentanLeistung]) - config.dcLimit, // Over the limit
        ]),
      });
    } else if(highPvHours > 4) {
      note = `PV (${maxDcPower}W) over the limit and good forecast. ` +
        `Charge what's over the limit minus momentanLeistung, min ${capacityWh * 0.1}W, max ${toChargeWh / (limitPvHours || 1)}W.`;
      rate = wattToRate({
        capacityWh,
        watt: _.min([
          _.max([
            capacityWh * 0.1,                                                // At least 0.1C
            maxDcPower + 10 - _.max([0, momentanLeistung]) - config.dcLimit, // Over the limit
            toChargeWh / highPvHours,                                        // Remaining by highPvHours
          ]),
          toChargeWh / (limitPvHours || 1),                                  // Remaining by limitPvHours
        ]),
      });
    } else if(totalPvWh > 3 * toChargeWh) {
      if(now < maxSunTime) {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. Before max sun.`;
        rate = wattToRate({capacityWh, watt: _.max([capacityWh * 0.1, toChargeWh / highPvHours])});
      } else {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. After max sun.`;
        rate = wattToRate({capacityWh, watt: _.max([capacityWh * 0.2, toChargeWh / highPvHours])});
      }
    } else {
      note = `PV (${maxDcPower}W) over the limit but low forecast. Charge max.`;
      rate = 1;
    }
  } else if(maxEinspeisung > config.dcLimit - 500) {
    note = `PV Einspeisung (${maxEinspeisung}W) close to the limit. Charge ${capacityWh * 0.1}W.`;
    rate = wattToRate({capacityWh, watt: capacityWh * 0.1});
  } else if(limitPvWh && totalPvWh - limitPvWh > 2 * toChargeWh) {
    note = `Limit expected for later and enough PV after the limit. Wait to reach limit.`;
    rate = 0;
  } else if(limitPvWh && limitPvHours > 2) {
    note = `Long limit expected. Wait to reach limit.`;
    rate = 0;
  } else if(limitPvWh && highPvHours > 4) {
    note = `Short limit expected and max sun. Wait to reach limit.`;
    rate = 0;
  } else if(highPvWh && highPvHours > toChargeWh / 2000) {
    if(now < maxSunTime) {
      note = `High PV for enough hours to charge. Before max sun.`;
      rate = wattToRate({capacityWh, watt: _.max([capacityWh * 0.1, toChargeWh / highPvHours])});
    } else {
      note = `High PV for enough hours to charge. After max sun.`;
      rate = wattToRate({capacityWh, watt: _.max([capacityWh * 0.2, toChargeWh / highPvHours * 2])});
    }
  } else if(totalPvWh > 3 * toChargeWh) {
    note = `Sufficient for today, but won't reach the limit level.`;
    rate = 0.4; // Charge-rate 40%;
  } else {
    note = `Pretty low forecast for today. Charge max.`;
    rate = 1; // Charge-rate 100%.
  }

  if(log ||
    !lastLog ||
    (toChargeWh > 30 && maxDcPower > 10 && now - lastLog > ms('28 minutes')) ||
    rate !== lastRate
  ) {
    logger.debug('getBatteryRate', {
      totalPv:          `${_.round(totalPvWh) / 1000}kWh`,
      totalPvHours,
      highPv:           `${_.round(highPvWh) / 1000}kWh`,
      highPvHours,
      highPvEstimates:  highPvEstimates.join(','),
      limitPv:          `${_.round(limitPvWh) / 1000}kWh`,
      limitPvHours,
      tomorrowPv:       `${_.round(tomorrowPvWh) / 1000}kWh`,
      maxSun,
      maxDcPower:       `${maxDcPower}W (${_.uniq(dcPowers.dump()).join(',')})`,
      maxEinspeisung:   `${maxEinspeisung}W (${_.uniq(einspeisungen.dump()).join(',')})`,
      momentanLeistung: `${_.round(momentanLeistung / 1000, 1)}kW`,
      chargeState:      `${chargeState}%`,
      toCharge:         `${_.round(toChargeWh / 1000, 1)}kWh`,
      demandOvernight:  `${_.round(demandOvernightWh / 1000, 1)}kWh`,
      rate:             `${_.round(capacityWh * rate)}W (${_.round(rate, 2)}C)`,
      note,
    });

    lastLog  = now;
    lastRate = rate;
  }

  return rate;
};

let handleRateErrorCount = 0;

const handleRate = async function({capacityWh, log = false}) {
  try {
    // try {
    //   // Sanity check
    //   await inverter.readRegister('Mn');
    // } catch(err) {
    //   throw new Error(`Failed sanity check: ${err.message}`);
    // }

    // Get charge rate
    let solcastForecasts;
    let chargeState;
    let dcPower;
    let rate;
    let setRate;

    try {
      let retries = 3;

      do {
        try {
          solcastForecasts = await getSolcastForecasts();

          check.assert.array(solcastForecasts,
            `Not an array returned from getSolcastForecasts(): ${JSON.stringify(solcastForecasts)}`);
        } catch(err) {
          retries--;

          if(retries) {
            await delay(ms('3 seconds'));
          } else {
            throw new Error(`Failed after retries: ${err.message}`);
          }
        }
      } while(!solcastForecasts && retries);
    } catch(err) {
      throw new Error(`Failed getting solcastForecasts: ${err.message}`);
    }
    try {
      const results = await inverter.readRegisters(['ChaState', '1_DCW', '2_DCW']);

      chargeState = _.round(results.ChaState, 1);
      dcPower     = _.round(results['1_DCW'] + results['2_DCW']);

      dcPowers.enq(dcPower);
    } catch(err) {
      throw new Error(`Failed getting battery state: ${err.message}`);
    }
    try {
      rate        = getBatteryRate({capacityWh, chargeState, log, solcastForecasts});
    } catch(err) {
      throw new Error(`Failed getting battery rate: ${err.message}`);
    }

    // logger.debug('handleRate', {chargeState, rate});

    // Set charge rate
    try {
      await inverter.writeRegister('StorCtl_Mod', [1]); // Bit0 enable charge control, Bit1 enable discharge control
    } catch(err) {
      logger.warn(`Failed writing battery charge control: ${err.message}`);
      // throw new Error(`Failed writing battery charge control: ${err.message}`);
    }
    try {
      await inverter.writeRegister('InOutWRte_RvrtTms', [3900]); // Timeout for (dis)charge rate in seconds
    } catch(err) {
      logger.warn(`Failed writing battery charge rate timeout: ${err.message}`);
      // throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
    }
    try {
      setRate = _.round(rate * 100 * 100);

      await inverter.writeRegister('InWRte', [setRate]); // rate% von 5120W => max Ladeleistung
    } catch(err) {
      throw new Error(`Failed writing battery charge rate ${setRate}: ${err.message}`);
    }
    // await inverter.writeRegister('OutWRte', [10000]); // 0% nicht entladen

    // Display current charge rate
    // const results = _.merge({},
    //   await inverter.readRegisters(['StVnd', 'VA']),
    //   await inverter.readRegisters(['ChaSt', 'ChaState', 'StorCtl_Mod', 'InOutWRte_RvrtTms', 'InWRte']));
    // logger.info('Inverter Status (StVnd)', results.StVnd);
    // logger.info('Inverter Power (VA)', results.VA);

    // logger.info('Battery State (ChaSt)', results.ChaSt);
    // logger.info('Battery Percent (ChaState)', results.ChaState);

    // logger.info('Battery Control (StorCtl_Mod)', results.StorCtl_Mod);
    // logger.info('Battery Rate Timeout (InOutWRte_RvrtTms)', results.InOutWRte_RvrtTms);
    // logger.info('Battery Charge Rate (InWRte)', results.InWRte);

    Reflect.deleteProperty(notified, 'handleRate');

    handleRateErrorCount = 0;
  } catch(err) {
    logger.error(`Failed to handle battery rate: ${err.message}`);

    handleRateErrorCount++;

    if(handleRateErrorCount > 3 && !notified.handleRate) {
      await sendMail({
        to:      'technik@heine7.de',
        subject: 'Fronius Solar Fehler, handleRate()',
        html:    err.message,
      });

      notified.handleRate = true;
    }
  }
};

(async() => {
  // Globals
  let froniusIntervalErrorCount = 0;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  // #########################################################################
  // Read static data

  try {
    config = await fsExtra.readJson('/var/fronius/config.json');

    check.assert.object(config);
    check.assert.string(config.API_KEY);
    check.assert.string(config.RESOURCE_ID);
    check.assert.number(config.springChargeGoal);
    check.assert.number(config.summerChargeGoal);
  } catch(err) {
    logger.error('Failed to read JSON in /var/fronius/config.json', err.message);

    process.exit(1);
  }

  try {
    const savedFroniusBatteryStatus = await fsExtra.readJson('/var/fronius/fronius-battery.json');

    check.assert.nonEmptyObject(savedFroniusBatteryStatus);

    await updateFroniusBatteryStatus(savedFroniusBatteryStatus);
  } catch(err) {
    logger.error('Failed to read JSON in /var/fronius/fronius-battery.json', err.message);

    process.exit(1);
  }

  // #########################################################################
  // Init Modbus
  try {
    inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
    await inverter.open();

    smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
    await smartMeter.open();
  } catch(err) {
    logger.error(`Failed to open inverter or smartMeter`);

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Fehler, startup',
      html:    err.message,
    });


    await delay(ms('1 minute')); // Delay shutdown (Version update & restart takes ~10 minutes)

    await stopProcess();

    return;
  }

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

  // #########################################################################
  // Handle Stromzähler data
  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      const message = JSON.parse(messageRaw);

      switch(topic) {
        case 'Fronius/solar/cmnd':
          if(Object.hasOwn(message, 'chargeMax')) {
            if(message.chargeMax) {
              logger.info(`Charge maximum.`);

              await updateFroniusBatteryStatus({chargeMax: message.chargeMax});
            } else {
              logger.info(`Charge maximum. Reset.`);

              await updateFroniusBatteryStatus({chargeMax: null});
            }
          } else if(Object.hasOwn(message, 'chargeTo')) {
            if(message.chargeTo) {
              logger.info(`Charge exception. Charge ${message.chargeTo}% today.`);

              await updateFroniusBatteryStatus({chargeTo: message.chargeTo});
            } else {
              logger.info(`Charge exception. Reset to normal charge today.`);

              await updateFroniusBatteryStatus({chargeTo: null});
            }
          }
          break;

        case 'maxSun/INFO':
          maxSun = message;
          break;

        case 'strom/tele/SENSOR':
          ({momentanLeistung} = message);

          break;

        case 'tasmota/espstrom/tele/SENSOR': {
          const zaehlerEinspeisung = -message.SML.Leistung;

          // logger.debug({zaehlerEinspeisung});

          einspeisungen.enq(zaehlerEinspeisung);
          break;
        }

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }
    } catch(err) {
      logger.eror('mqtt handler failed', {topic, messageRaw, errMessage: err.message});
    }
  });

  await mqttClient.subscribe('Fronius/solar/cmnd');
  await mqttClient.subscribe('maxSun/INFO');
  await mqttClient.subscribe('strom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espstrom/tele/SENSOR');

  healthInterval = setInterval(async() => {
    await mqttClient.publish(`fronius-battery/health/STATE`, 'OK');
  }, ms('1min'));

  // #########################################################################
  // Handle Fronius data
  froniusInterval = setInterval(async() => {
    if(!inverter) {
      logger.info('Reconnecting Modbus Inverter');
      inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
      await inverter.open();
    }
    if(!smartMeter) {
      logger.info('Reconnecting Modbus SmartMeter');
      smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
      await smartMeter.open();
    }

    try {
      const results = await promiseAllByKeys({
        resultsSmartMeter: smartMeter.readRegisters(['W']),
        resultsMppt:       inverter.readRegisters(['ChaState', '1_DCW', '2_DCW', '3_DCW', '4_DCW',
          '1_DCWH', '2_DCWH', '3_DCWH', '4_DCWH']),
        resultsInverter:   inverter.readRegisters(['W', 'TmpCab']),
      });

      const {resultsSmartMeter, resultsMppt, resultsInverter} = results;
      const newFroniusBatteryStatus = {};

      if(resultsMppt['1_DCWH'] && resultsMppt['2_DCWH']) {
        newFroniusBatteryStatus.solarWh = resultsMppt['1_DCWH'] + resultsMppt['2_DCWH'];
      }
      if(resultsMppt['3_DCWH']) {
        newFroniusBatteryStatus.storageChargeWh = resultsMppt['3_DCWH'];
      }
      if(resultsMppt['4_DCWH']) {
        newFroniusBatteryStatus.storageDisChargeWh = resultsMppt['4_DCWH'];
      }

      await updateFroniusBatteryStatus(newFroniusBatteryStatus);

      await mqttClient.publish('Fronius/solar/tele/SENSOR', JSON.stringify({
        time: Date.now(),
        battery: {
          powerIncoming: resultsMppt['3_DCW'],
          powerOutgoing: resultsMppt['4_DCW'],
          stateOfCharge: resultsMppt.ChaState / 100,
          ...newFroniusBatteryStatus,
        },
        meter: {
          powerIncoming: resultsSmartMeter.W > 0 ?  resultsSmartMeter.W : 0,
          powerOutgoing: resultsSmartMeter.W < 0 ? -resultsSmartMeter.W : 0,
        },
        inverter: {
          powerIncoming: resultsInverter.W < 0 ? -resultsInverter.W : 0,
          powerOutgoing: resultsInverter.W > 0 ?  resultsInverter.W : 0,
          tmpCab:        _.round(resultsInverter.TmpCab),
        },
        solar: {
          powerOutgoing: resultsMppt['1_DCW'] + resultsMppt['2_DCW'],
        },
      }), {retain: true});

      Reflect.deleteProperty(notified, 'froniusInterval');

      froniusIntervalErrorCount = 0;
    } catch(err) {
      logger.error(`froniusInterval(), failed to read data: ${err.message}`);

      froniusIntervalErrorCount++;

      if(froniusIntervalErrorCount > 3 && !notified.froniusInterval) {
        await sendMail({
          to:      'technik@heine7.de',
          subject: 'Fronius Solar Fehler, froniusInterval()',
          html:    err.message,
        });

        notified.froniusInterval = true;
      }

      if(err.message === 'Port Not Open') {
        await inverter.close();
        inverter = undefined;

        await smartMeter.close();
        smartMeter = undefined;

        logger.info('Inverter and SmartMeter closed');
      }
    }
  }, ms('5 seconds'));

//  // #########################################################################
//  // Handle SmartMeter
//  smartMeterInterval = setInterval(async() => {
//    if(!smartMeter) {
//      logger.info('Reconnector Modbus smartMeter');
//      smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
//      await smartMeter.open();
//    }
//
//    let leistung;
//    let verbrauchW;
//    let einspeisungW;
//
//    try {
//      const results = await smartMeter.readRegisters(['W', 'TotWhImp', 'TotWhExp']);
//
//      leistung      = results.W;
//      verbrauchWh   = results.TotWhImp;
//      einspeisungWh = results.TotWhExp;
//
//      // console.log({leistung, verbrauchW, einspeisungW});
//    } catch(err) {
//      logger.error(`Failed to read smartMeter: ${err.message}`);
//
//      if(err.message === 'Port Not Open') {
//        await smartMeter.close();
//        logger.info('smartMeter.closed');
//        smartMeter = undefined;
//      }
//    }
//
//    try {
//      const SML = {
//        Leistung:    leistung,
//        Verbrauch:   verbrauchWh / 1000,
//        Einspeisung: einspeisungWh / 1000,
//      };
//
//      // console.log(SML);
//
//      await mqttClient.publish('tasmota/espstrom/tele/SENSOR', JSON.stringify({SML}));
//    } catch(err) {
//      logger.error(`Failed to publish smartMeter: ${err.message}`);
//    }
//  }, ms('5 seconds'));

  // #########################################################################
  // Read battery capacity
  let capacityWh;

  try {
    capacityWh = await inverter.readRegister('WHRtg');
  } catch(err) {
    logger.error(`Failed to read battery capacityWh: ${err.message}`);

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Batterie Fehler',
      html:    err.message,
    });
  }

  // #########################################################################
  // Handle charge-rate once and scheduled
  {
    await delay(ms('10 seconds')); // Await mqtt report cycle

    await handleRate({capacityWh});

    //                s min h d m wd
    const schedule = '0 * * * * *'; // Every minute

    cron.schedule(schedule, async() => {
      // logger.info(`--------------------- Cron handleRate ----------------------`);

      if(!capacityWh) {
        try {
          capacityWh = await inverter.readRegister('WHRtg');

          await sendMail({
            to:      'technik@heine7.de',
            subject: 'Fronius Solar Batterie ok',
            html:    `Batterie ${capacityWh} ok`,
          });
        } catch(err) {
          logger.error(`Failed to read battery capacity: ${err.message}`);
        }
      }

      await handleRate({capacityWh});
    });
  }

  // #########################################################################
  // Check for software version update
  {
    //                s min h  d m wd
    const schedule = '0 0   18 * * *'; // Once per day at 18:00

    cron.schedule(schedule, async() => {
      // logger.info(`--------------------- Cron SW Version ----------------------`);

      try {
        const runningVersion = await inverter.readRegister('Vr');
        const latestVersion  = await getLatestVersion();

        logger.info('Software version check', {runningVersion, latestVersion});

        if(runningVersion === latestVersion) {
          Reflect.deleteProperty(notified, 'softwareVersion');
        } else if(!notified.softwareVersion) {
          (async() => { // Do not await this async handler!
            await delay(ms('5days'));
            await sendMail({
              to:      'technik@heine7.de',
              subject: 'Fronius Software Version update',
              html:    `
                <table>
                  <tr>
                    <td>Running</td><td>${runningVersion}</td>
                  </tr>
                  <tr>
                    <td>Latest</td><td>${latestVersion}</td>
                  </tr>
                  <tr>
                    <td colspan='2'><a href='${url}'>Fronius Product Download</a></td>
                  </tr>
                </table>`,
            });
          })();

          notified.softwareVersion = true;
        }
      } catch(err) {
        logger.error(`Failed to read software version: ${err.message}`);
      }
    });
  }

  // #########################################################################
  // Reset charge exception
  {
    //                s min h  d m wd
    const schedule = '0 0   0  * * *'; // Midnight

    cron.schedule(schedule, async() => {
      if(froniusBatteryStatus.chargeMax) {
        logger.info(`Reset charge maximum.`);

        await updateFroniusBatteryStatus({chargeMax: null});
      }
      if(froniusBatteryStatus.chargeTo) {
        logger.info(`Reset charge exception. Normal charge today.`);

        await updateFroniusBatteryStatus({chargeTo: null});
      }
    });
  }

  // #########################################################################
  // Signal handler (SIGHUP) to manually trigger a re-read of the config and call handleRate().
  process.on('SIGHUP', async() => {
    try {
      config = await fsExtra.readJson('/var/fronius/config.json');

      check.assert.object(config);

      logger.error(`Read springChargeGoal=${config.springChargeGoal}% summerChargeGoal=${config.summerChargeGoal}%`);

      await handleRate({capacityWh, log: true});
    } catch(err) {
      logger.error('Failed to read JSON in /var/fronius/fronius-battery.json in SIGHUP handler', err.message);
    }
  });
})();
