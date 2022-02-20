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
import {sendMail}        from './mail.js';
import sunspecInverter   from './sunspec_map_inverter.js';
import sunspecSmartMeter from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

const {API_KEY, RESOURCE_ID} = config;

const dcLimit = 5500; // Actual limit is 5775, but I start with a little tolerance.

// ###########################################################################
// Globals

let froniusInterval;
let inverter;
let lastLog;
let lastRate;
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
  if(!capacity) {
    return 0;
  }

  const rate = _.max([_.min([watt / capacity, 1]), 0]);

  return rate;
};

const getBatteryRate = function({capacity, chargeState, dcPower, solcast}) {
  if(!capacity) {
    return 0;
  }

  const toCharge     = _.round(capacity * (100 - chargeState) / 100);
  let   totalPv      = 0;
  let   totalPvHours = 0;
  let   highPv       = 0;
  let   highPvHours  = 0;
  let   limitPv      = 0;
  let   limitPvHours = 0;
  let   note;
  let   rate;
  const now          = dayjs.utc();
  const maxPvTime    = now.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun
  const midnightTime = now.clone().hour(24).minute(0).second(0);

  // Note, the pv_estimate is given in kw. Multiply 1000 to get watt.
  for(const forecast of solcast) {
    const {period_end} = forecast;
    const period_end_date = Date.parse(period_end);

    if(period_end_date < Date.now()) {
      // Already passed
      continue;
    }
    if(period_end_date > midnightTime) {
      // Tomorrow
      continue;
    }

    let {pv_estimate} = forecast;

    pv_estimate *= 1000; // kW to watt

    // console.log({pv_estimate});

    if(pv_estimate) {
      // Estimate is for 30 minute period
      totalPv      += pv_estimate / 2;
      totalPvHours += 1 / 2;
    }
    if(pv_estimate > 3000) {
      // Estimate is for 30 minute period
      highPv      += pv_estimate / 2;
      highPvHours += 1 / 2;
    }
    if(pv_estimate > dcLimit) {
      // Estimate is for 30 minute period
      limitPv      += pv_estimate / 2;
      limitPvHours += 1 / 2;
    }
  }

  if(chargeState < 10) {
    note = `Charge to min of 10% (is ${chargeState}%).`;
    rate = 1;
  } else if(toCharge < 100) {
    note = `Charge the last few Wh with 1000W (${toCharge}Wh toCharge).`;
    rate = wattToRate({capacity, watt: 1000});
  } else if(dcPower > dcLimit) {
    if(limitPvHours > 1 || highPvHours > 4) {
      note = `PV (${dcPower}W) over the limit and good forecast. Charge what's over the limit, at least 500W.`;
      rate = _.max([wattToRate({capacity, watt: dcPower - dcLimit}), wattToRate({capacity, watt: 500})]);
    } else if(totalPv > 3 * toCharge) {
      if(now < maxPvTime) {
        note = `PV (${dcPower}W) over the limit and sufficient for today. Before high PV.`;
        rate = wattToRate({capacity, watt: 1000});
      } else {
        note = `PV (${dcPower}W) over the limit and sufficient for today. After high PV.`;
        rate = wattToRate({capacity, watt: 2000});
      }
    } else {
      note = `PV (${dcPower}W) over the limit but low forecast. Charge max.`;
      rate = 1;
    }
  } else if(limitPv && totalPv - limitPv > 2 * toCharge) {
    note = `Limit expected for later and enough PV after the limit. Wait to reach limit.`;
    rate = 0;
  } else if(limitPv && limitPvHours > 2) {
    note = `Long limit expected. Wait to reach limit.`;
    rate = 0;
  } else if(limitPv && highPvHours > 4) {
    note = `Short limit expected and high PV. Wait to reach limit.`;
    rate = 0;
  } else if(highPv && highPvHours > toCharge / 2000) {
    if(now < maxPvTime) {
      note = `High PV for enough hours to charge. Before high PV.`;
      rate = wattToRate({capacity, watt: 1000});
    } else {
      note = `High PV for enough hours to charge. After high PV.`;
      rate = wattToRate({capacity, watt: 2000});
    }
  } else if(totalPv > 3 * toCharge) {
    note = `Sufficient for today, but won't reach the limit level.`;
    rate = 0.4; // Charge-rate 40%;
  } else {
    note = `Pretty low forecast for today. Charge max.`;
    rate = 1; // Charge-rate 100%.
  }

  if(!lastLog ||
    (toCharge > 30 && dcPower > 10 && dayjs() - lastLog > millisecond('28 minutes')) ||
    rate !== lastRate
  ) {
    logger.debug('getBatteryRate', {
      toCharge:     `${toCharge}Wh`,
      chargeState:  `${chargeState}%`,
      dcPower:      `${dcPower}W`,
      totalPv:      _.round(totalPv),
      totalPvHours,
      highPv:       _.round(highPv),
      highPvHours,
      limitPv:      _.round(limitPv),
      limitPvHours,
      note,
      rate:         `${_.round(rate, 3) * 100}% (${capacity * rate}W)`,
    });

    lastLog  = dayjs();
    lastRate = rate;
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
      setRate = _.round(rate, 4) * 100 * 100;

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

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Batterie Fehler',
      html:    err.message,
    });
  }

  // #########################################################################
  // Handle charge-rate once and scheduled
  await handleRate(capacity);

  //                s min h d m wd
  const schedule = '0 */5 * * * *'; // Every 5 minutes

  cron.schedule(schedule, async() => {
    // logger.info(`--------------------- Cron ----------------------`);

    if(!capacity) {
      try {
        capacity = await inverter.readRegister('WHRtg');

        await sendMail({
          to:      'technik@heine7.de',
          subject: 'Fronius Solar Batterie ok',
          html:    `Batterie ${capacity} ok`,
        });
      } catch{
        logger.error(`Failed to read battery capacity: ${err.message}`);
      }
    }

    await handleRate(capacity);
  });
})();
