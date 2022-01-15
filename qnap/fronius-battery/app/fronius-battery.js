#!/usr/bin/env node

/* eslint-disable camelcase */

import fs                from 'fs/promises';

// const {setTimeout: delay} = require('timers/promises');

import _                 from 'lodash';
import check             from 'check-types-2';
import cron              from 'node-cron';
import dayjs             from 'dayjs';
import fronius           from 'fronius';
import fsExtra           from 'fs-extra';
import millisecond       from 'millisecond';
import mqtt              from 'async-mqtt';
import needle            from 'needle';
import utc               from 'dayjs/plugin/utc.js';

import config            from '/var/fronius-battery/config.js';
import FroniusClient     from './fronius-client.js';
import logger            from './logger.js';
import sunspecInverter   from './sunspec_map_inverter.js';
import sunspecSmartMeter from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

const {API_KEY, RESOURCE_ID} = config;

// ###########################################################################
// Globals

let froniusInterval;
let inverter;
let lastLog;
let mqttClient;
let smartMeter;
let smartMeterInterval;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(froniusInterval) {
    clearInterval(froniusInterval);
    logger.info('fronius.closed');
    froniusInterval = undefined;
  }

  if(inverter) {
    await inverter.close();
    logger.info('inverter.closed');
    inverter = undefined;
  }

  if(smartMeter) {
    if(smartMeterInterval) {
      clearInterval(smartMeterInterval);
      smartMeterInterval = undefined;
    }

    await smartMeter.close();
    logger.info('smartMeter.closed');
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

const getSolcast = async function() {
  let cacheAge;
  let solcast;

  try {
    await fs.access('/var/fronius-battery/solcast-cache.json');

    const stats = await fs.stat('/var/fronius-battery/solcast-cache.json');

    cacheAge = stats ? Date.now() - stats.mtime : null;
  } catch {
    cacheAge = null;
  }

  if(cacheAge && cacheAge < millisecond('30 minutes')) {
    solcast = await fsExtra.readJSON('/var/fronius-battery/solcast-cache.json');
  } else {
    // logger.info('Refresh solcast cache');

    const response = await needle('get',
      `https://api.solcast.com.au/rooftop_sites/${RESOURCE_ID}/forecasts?hours=24`,
      {
        headers: {Authorization: `Bearer ${API_KEY}`},
        json:    true,
      });

    solcast = response.body;

    await fsExtra.writeJson('/var/fronius-battery/solcast-cache.json', solcast, {spaces: 2});
  }

  check.assert.object(solcast);
  check.assert.array(solcast.forecasts);

  return solcast.forecasts;
};

const wattToRate = function({capacity, watt}) {
  const rate = _.round(_.max([_.min([watt / capacity, 1]), 0]), 2);

  return rate;
};

const getBatteryRate = function({capacity, chargeState, dcPower, solcast}) {
  const toCharge     = _.round(capacity * (100 - chargeState) / 100);
  let   totalPv      = 0;
  let   highPv       = 0;
  let   highPvHours  = 0;
  let   limitPv      = 0;
  let   limitPvHours = 0;
  let   rate;
  const now          = dayjs.utc();
  const maxPvTime    = now.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun

  // Note, the pv_estimate is given in kw. Multiply 1000 to get watt.
  for(const forecast of _.slice(solcast, 0, 24)) { // Check the next 12 hours
    const {period_end} = forecast;

    if(Date.parse(period_end) < Date.now()) {
      // Already passed
      continue;
    }

    let {pv_estimate} = forecast;

    pv_estimate *= 1000; // kW to watt

    // console.log({pv_estimate});

    if(pv_estimate) {
      // Estimate is for 30 minute period
      totalPv += pv_estimate / 2;
    }
    if(pv_estimate > 3000) {
      // Estimate is for 30 minute period
      highPv      += pv_estimate / 2;
      highPvHours += 1 / 2;
    }
    if(pv_estimate > 5800) {
      // Estimate is for 30 minute period
      limitPv      += pv_estimate / 2;
      limitPvHours += 1 / 2;
    }
  }

  if(chargeState < 10) {
    rate = 1; // Make sure to always have a base load of 10%.
  } else if(toCharge < 100) {
    rate = wattToRate({capacity, watt: 1000}); // Charge the last few Wh with 1000W.
  } else if(dcPower > 5800) {
    // PV over the limit. Charge what's over the limit.
    rate = _.max([wattToRate({capacity, watt: dcPower - 5800}), 1]); // Charge-rate, based on dcPower, at least 1kW.
  } else if(limitPv && totalPv - limitPv > 2 * toCharge) {
    // Limit expected for later and enough PV after the limit. Wait to reach limit.
    rate = 0;
  } else if(limitPv && limitPvHours > 2) {
    // Long limit expected. Wait to reach limit.
    rate = 0;
  } else if(limitPv && highPvHours > 4) {
    // Short limit expected and high PV. Wait to reach limit.
    rate = 0;
  } else if(highPv && highPvHours > toCharge / 2000) {
    // High PV for enough hours to charge.
    if(maxPvTime < now) {
      rate = wattToRate({capacity, watt: 2000}); // After high PV. Charge 2000W.
    } else {
      rate = wattToRate({capacity, watt: 1000}); // Before high PV. Charge 1000W.
    }
  } else if(totalPv > 3 * toCharge) {
    // Sufficient for today, but won't even reach the high level.
    rate = 1; // Charge-rate 100%;

    // if(maxPvTime < now) {
    //   rate = wattToRate({capacity, watt: 2500}); // After high PV. Sufficient PV for battery charge. Charge 2500W.
    // } else {
    //   rate = wattToRate({capacity, watt: 1000}); // Before high PV. Sufficient PV for battery charge. Charge 1000W.
    // }
  } else {
    // Pretty low forecast for today
    rate = 1; // Charge-rate 100%.
  }

  totalPv = _.round(totalPv);
  highPv  = _.round(highPv);
  limitPv = _.round(limitPv);

  if(!lastLog || toCharge > 30 && dcPower > 10 && dayjs() - lastLog > millisecond('28 minutes')) {
    logger.debug('getBatteryRate', {
      toCharge:    `${toCharge}Wh`,
      chargeState: `${chargeState}%`,
      dcPower:     `${dcPower}W`,
      totalPv,
      highPv,
      highPvHours,
      limitPv,
      limitPvHours,
      rate:        `${rate * 100}% (${capacity * rate}W)`,
    });

    lastLog = dayjs();
  }

  return rate;
};

const handleRate = async function(capacity) {
  try {
    try {
      // Sanity check
      await inverter.readRegister('Mn');
    } catch(err) {
      throw new Error(`Failed sanity check: ${err.message}`);
    }

    // Get charge rate
    let solcast;
    let chargeState;
    let dcPower;
    let rate;
    let setRate;

    try {
      solcast = await getSolcast();
    } catch(err) {
      throw new Error(`Failed getting solcast: ${err.message}`);
    }
    try {
      chargeState = _.round(await inverter.readRegister('ChaState'), 1);
      dcPower     = _.round(await inverter.readRegister('1_DCW') + await inverter.readRegister('2_DCW'));
    } catch(err) {
      throw new Error(`Failed getting battery state: ${err.message}`);
    }
    try {
      rate        = getBatteryRate({capacity, chargeState, dcPower, solcast});
    } catch(err) {
      throw new Error(`Failed getting battery rate: ${err.message}`);
    }

    // logger.debug('handleRate', {chargeState, rate});

    // Set charge rate
    try {
      await inverter.writeRegister('StorCtl_Mod', [1]); // Bit0 enable charge control, Bit1 enable discharge control
    } catch(err) {
      throw new Error(`Failed writing battery charge control: ${err.message}`);
    }
    try {
      await inverter.writeRegister('InOutWRte_RvrtTms', [3900]); // Timeout for (dis)charge rate in seconds
    } catch(err) {
      throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
    }
    try {
      setRate = rate * 100 * 100;

      await inverter.writeRegister('InWRte', [setRate]); // rate% von 5120W => max Ladeleistung
    } catch(err) {
      throw new Error(`Failed writing battery charge rate ${setRate}: ${err.message}`);
    }
    // await inverter.writeRegister('OutWRte', [10000]); // 0% nicht entladen

    // Display current charge rate
    // logger.info('Inverter Status (StVnd)', await inverter.readRegister('StVnd'));
    // logger.info('Inverter Power (VA)', await inverter.readRegister('VA'));

    // logger.info('Battery State (ChaSt)', await inverter.readRegister('ChaSt'));
    // logger.info('Battery Percent (ChaState)', await inverter.readRegister('ChaState'));

    // logger.info('Battery Control (StorCtl_Mod)', await inverter.readRegister('StorCtl_Mod'));
    // logger.info('Battery Rate Timeout (InOutWRte_RvrtTms)', await inverter.readRegister('InOutWRte_RvrtTms'));
    // logger.info('Battery Charge Rate (InWRte)', await inverter.readRegister('InWRte'));
  } catch(err) {
    logger.error(`Failed to handle battery rate: ${err.message}`);
  }
};

(async() => {
  // Globals

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  let status;

  try {
    status = await fsExtra.readJson('/var/fronius-battery/fronius-battery.json');
  } catch {
    logger.error('Failed to read JSON in /var/fronius-battery/fronius-battery.json');

    process.exit(1);
  }

  let {storageChargeWh, storageDisChargeWh} = status;

  // #########################################################################
  // Init Modbus
  inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
  await inverter.open();

  smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
  await smartMeter.open();

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  // mqttClient.on('close',      ()  => logger.info('mqtt.close'));
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => logger.info('mqtt.end'));

  // #########################################################################
  // Handle Fronius data
  const froniusClient = new fronius.Client('http://192.168.6.11');

  froniusInterval = setInterval(async() => {
    if(!inverter) {
      logger.info('Reconnector Modbus inverter');
      inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
      await inverter.open();
    }

    try {
      const powerFlow                 = await froniusClient.powerFlow({format: 'json'});
      const currentStorageChargeWh    = await inverter.readRegister('3_DCWH');
      const currentStorageDisChargeWh = await inverter.readRegister('4_DCWH');
      let   storageCharging;

      if(currentStorageChargeWh && currentStorageDisChargeWh) {
        throw new Error(`Storage is charging and discharging at the same time`);
      }

      if(currentStorageChargeWh) {
        storageChargeWh = currentStorageChargeWh;
        storageCharging = 1;
      }
      if(currentStorageDisChargeWh) {
        storageDisChargeWh = currentStorageDisChargeWh;
        storageCharging = -1;
      }

      if(powerFlow) {
        // logger.info({powerFlow});

        await fsExtra.copyFile('/var/fronius-battery/fronius-battery.json', '/var/fronius-battery/fronius-battery.json.bak');
        await fsExtra.writeJson('/var/fronius-battery/fronius-battery.json', {
          storageChargeWh,
          storageDisChargeWh,
        }, {spaces: 2});

        await mqttClient.publish('Fronius/solar/tele/SENSOR', JSON.stringify({
          ...powerFlow,
          storageCharging,
          storageChargeWh,
          storageDisChargeWh,
        }));
      }
    } catch(err) {
      logger.error(`Failed to read powerFlow: ${err.message}`);

      if(err.message === 'Port Not Open') {
        await inverter.close();
        logger.info('inverter.closed');
        inverter = undefined;
      }
    }
  }, millisecond('10 seconds'));

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
//      leistung      = await smartMeter.readRegister('W');
//      verbrauchWh   = await smartMeter.readRegister('TotWhImp');
//      einspeisungWh = await smartMeter.readRegister('TotWhExp');
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
//  }, millisecond('5 seconds'));

  // #########################################################################
  // Read battery capacity
  let capacity;

  try {
    capacity = await inverter.readRegister('WHRtg');
  } catch(err) {
    logger.error(`Failed to read battery capacity: ${err.message}`);

    throw new Error('Init failed');
  }

  // #########################################################################
  // Handle charge-rate once and scheduled
  await handleRate(capacity);

  //                s min h d m wd
  const schedule = '0 */5 * * * *'; // Every 5 minutes

  cron.schedule(schedule, async() => {
    // logger.info(`--------------------- Cron ----------------------`);

    await handleRate(capacity);
  });
})();
