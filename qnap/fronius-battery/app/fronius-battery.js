#!/usr/bin/env node

'use strict';

/* eslint-disable camelcase */

const fs                = require('fs/promises');

// const {setTimeout: delay} = require('timers/promises');

const _                 = require('lodash');
const check             = require('check-types-2');
const cron              = require('node-cron');
const dayjs             = require('dayjs');
const fronius           = require('fronius');
const fsExtra           = require('fs-extra');
const millisecond       = require('millisecond');
const mqtt              = require('async-mqtt');
const needle            = require('needle');
const utc               = require('dayjs/plugin/utc');

const config            = require('/var/fronius-battery/config.js');
const FroniusClient     = require('./fronius-client');
const logger            = require('./logger.js');
const sunspecInverter   = require('./sunspec_map_inverter.js');
const sunspecSmartMeter = require('./sunspec_map_smart_meter.js');

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
    rate = _.max([wattToRate({capacity, watt: dcPower - 5800}), 1000]); // Charge-rate, based on dcPower, at least 1kW.
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
  // Sanity check
  await inverter.readRegister('Mn');

  // Get charge rate
  const solcast     = await getSolcast();
  const chargeState = _.round(await inverter.readRegister('ChaState'), 1);
  const dcPower     = _.round(await inverter.readRegister('1_DCW') + await inverter.readRegister('2_DCW'));
  const rate        = getBatteryRate({capacity, chargeState, dcPower, solcast});

  // logger.debug('handleRate', {chargeState, rate});

  // Set charge rate
  await inverter.writeRegister('StorCtl_Mod', [1]); // Bit0 enable charge control, Bit1 enable discharge control
  await inverter.writeRegister('InOutWRte_RvrtTms', [3900]); // Timeout for (dis)charge rate in seconds
  await inverter.writeRegister('InWRte', [rate * 100 * 100]); // rate% von 5120W => max Ladeleistung
  // await inverter.writeRegister('OutWRte', [10000]); // 0% nicht entladen

  // Display current charge rate
  // logger.info('Inverter Status (StVnd)', await inverter.readRegister('StVnd'));
  // logger.info('Inverter Power (VA)', await inverter.readRegister('VA'));

  // logger.info('Battery State (ChaSt)', await inverter.readRegister('ChaSt'));
  // logger.info('Battery Percent (ChaState)', await inverter.readRegister('ChaState'));

  // logger.info('Battery Control (StorCtl_Mod)', await inverter.readRegister('StorCtl_Mod'));
  // logger.info('Battery Rate Timeout (InOutWRte_RvrtTms)', await inverter.readRegister('InOutWRte_RvrtTms'));
  // logger.info('Battery Charge Rate (InWRte)', await inverter.readRegister('InWRte'));
};

(async() => {
  // Globals

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

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
    try {
      const powerFlow = await froniusClient.powerFlow({format: 'json'});

      if(powerFlow) {
        // logger.info({powerFlow});

        await mqttClient.publish('Fronius/solar/tele/SENSOR', JSON.stringify(powerFlow));
      }
    } catch(err) {
      logger.error(`Failed to read powerFlow: ${err.message}`);
    }
  }, millisecond('10 seconds'));

  // #########################################################################
  // Handle SmartMeter
  smartMeterInterval = setInterval(async() => {
    const leistung     = await smartMeter.readRegister('W');
    const verbrauchW   = await smartMeter.readRegister('TotWhImp');
    const einspeisungW = await smartMeter.readRegister('TotWhExp');

    // console.log({leistung, verbrauchW, einspeisungW});

    try {
      const SML = {
        Leistung:    leistung,
        Verbrauch:   verbrauchW / 1000,
        Einspeisung: einspeisungW / 1000,
      };

      // console.log(SML);

      await mqttClient.publish('tasmota/espstrom/tele/SENSOR', JSON.stringify({SML}));
    } catch(err) {
      logger.error(`Failed to read smartMeter: ${err.message}`);
    }
  }, millisecond('5 seconds'));

  // #########################################################################
  // Read battery capacity
  const capacity = await inverter.readRegister('WHRtg');

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
