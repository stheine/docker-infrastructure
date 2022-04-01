#!/usr/bin/env node

/* eslint-disable camelcase */

import fsPromises        from 'fs/promises';

import {setTimeout as delay} from 'timers/promises';

import _                 from 'lodash';
import axios             from 'axios';
import check             from 'check-types-2';
import cron              from 'node-cron';
import dayjs             from 'dayjs';
import fronius           from 'fronius';
import fsExtra           from 'fs-extra';
import ms                from 'ms';
import mqtt              from 'async-mqtt';
import Ringbuffer        from '@stheine/ringbufferjs';
import utc               from 'dayjs/plugin/utc.js';

import config            from '/var/fronius-battery/config.js';
import FroniusClient     from './fronius-client.js';
import logger            from './logger.js';
import {sendMail}        from './mail.js';
import sunspecInverter   from './sunspec_map_inverter.js';
import sunspecSmartMeter from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

const {API_KEY, RESOURCE_ID} = config;

const dcLimit = 5750;

// ###########################################################################
// Globals

let dcPowers = new Ringbuffer(10);
let einspeisungen = new Ringbuffer(60);
let froniusInterval;
let garageLeistung = 0;
let inverter;
let lastLog;
let lastRate;
let momentanLeistung = 0;
let mqttClient;
let smartMeter;
let smartMeterInterval;

dcPowers.enq(0);
einspeisungen.enq(0);

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
    await fsPromises.access('/var/fronius-battery/solcast-cache.json');

    const stats = await fsPromises.stat('/var/fronius-battery/solcast-cache.json');

    cacheAge = stats ? Date.now() - stats.mtime : null;
  } catch {
    cacheAge = null;
  }

  if(cacheAge && cacheAge < ms('30 minutes')) {
    solcast = await fsExtra.readJSON('/var/fronius-battery/solcast-cache.json');
  } else {
    // logger.info('Refresh solcast cache');

    const response = await axios.get(
      `https://api.solcast.com.au/rooftop_sites/${RESOURCE_ID}/forecasts?hours=24`,
      {
        headers: {Authorization: `Bearer ${API_KEY}`},
        json:    true,
      });

    solcast = response.data;

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

const getBatteryRate = function({capacity, chargeState, log, solcast}) {
  if(!capacity) {
    return 0;
  }

  const maxDcPower      = _.max(dcPowers.dump());
  const maxEinspeisung  = _.max(einspeisungen.dump());
  const toCharge        = _.round(capacity * (100 - chargeState) / 100);
  let   totalPv         = 0;
  let   totalPvHours    = 0;
  let   highPv          = 0;
  let   highPvHours     = 0;
  const highPvEstimates = [];
  let   limitPv         = 0;
  let   limitPvHours    = 0;
  let   note;
  let   rate;
  const now          = dayjs.utc();
  const maxSunTime   = now.clone().hour(11).minute(25).second(0); // 11:25 UTC is the expected max sun
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

    let {pv_estimate90: estimate} = forecast;

    estimate *= 1000; // kW to watt

    // console.log({estimate});

    if(estimate > 500) {
      // Estimate is for 30 minute period
      totalPv      += estimate / 2;
      totalPvHours += 1 / 2;
    }
    if(estimate > 3000) {
      // Estimate is for 30 minute period
      highPv      += estimate / 2;
      highPvHours += 1 / 2;
      highPvEstimates.push(_.round(estimate));
    }
    if(estimate > dcLimit) {
      // Estimate is for 30 minute period
      limitPv      += estimate / 2;
      limitPvHours += 1 / 2;
    }
  }

  if(chargeState < 10) {
    note = `Charge to min of 10% (is ${chargeState}%).`;
    rate = 1;
  } else if(chargeState > 95 && _.inRange(dayjs().format('M'), 3, 11))  {
    note = `March to October, limit to 95%.`;
    rate = 0;
  } else if(toCharge < 100) {
    note = `Charge the last few Wh with 1000W (${toCharge}Wh toCharge).`;
    rate = wattToRate({capacity, watt: 1000});
  } else if(maxDcPower + garageLeistung > dcLimit) {
    if(limitPvHours > 1 || highPvHours > 4) {
      note = `PV (${maxDcPower}W + ${garageLeistung}W) over the limit and good forecast. Charge what's over the limit minus momentanLeistung, min 100W.`;
      rate = wattToRate({capacity, watt: _.max([100, maxDcPower + garageLeistung + 100 - momentanLeistung - dcLimit])});
    } else if(totalPv > 3 * toCharge) {
      if(now < maxSunTime) {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. Before max sun.`;
        rate = wattToRate({capacity, watt: _.max([500, toCharge / highPvHours])});
      } else {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. After max sun.`;
        rate = wattToRate({capacity, watt: _.max([1000, toCharge / highPvHours])});
      }
    } else {
      note = `PV (${maxDcPower}W) over the limit but low forecast. Charge max.`;
      rate = 1;
    }
  } else if(maxEinspeisung > 5700) {
    note = `PV Einspeisung (${maxEinspeisung}W) close to the limit. Charge 500W.`;
    rate = wattToRate({capacity, watt: 500});
  } else if(limitPv && totalPv - limitPv > 2 * toCharge) {
    note = `Limit expected for later and enough PV after the limit. Wait to reach limit.`;
    rate = 0;
  } else if(limitPv && limitPvHours > 2) {
    note = `Long limit expected. Wait to reach limit.`;
    rate = 0;
  } else if(limitPv && highPvHours > 4) {
    note = `Short limit expected and max sun. Wait to reach limit.`;
    rate = 0;
  } else if(highPv && highPvHours > toCharge / 2000) {
    if(now < maxSunTime) {
      note = `High PV for enough hours to charge. Before max sun.`;
      rate = wattToRate({capacity, watt: _.max([500, toCharge / highPvHours])});
    } else {
      note = `High PV for enough hours to charge. After max sun.`;
      rate = wattToRate({capacity, watt: _.max([1000, toCharge / highPvHours])});
    }
  } else if(totalPv > 3 * toCharge) {
    note = `Sufficient for today, but won't reach the limit level.`;
    rate = 0.4; // Charge-rate 40%;
  } else {
    note = `Pretty low forecast for today. Charge max.`;
    rate = 1; // Charge-rate 100%.
  }

  if(log ||
    !lastLog ||
    (toCharge > 30 && maxDcPower > 10 && dayjs() - lastLog > ms('28 minutes')) ||
    rate !== lastRate
  ) {
    logger.debug('getBatteryRate', {
      toCharge:         `${toCharge}Wh`,
      chargeState:      `${chargeState}%`,
      maxDcPower:       `${maxDcPower}W (${_.uniq(dcPowers.dump()).join(',')})`,
      garageLeistung,
      momentanLeistung: _.round(momentanLeistung),
      maxEinspeisung:   `${maxEinspeisung}W (${_.uniq(einspeisungen.dump()).join(',')})`,
      totalPv:          _.round(totalPv),
      totalPvHours,
      highPv:           _.round(highPv),
      highPvHours,
      highPvEstimates:  highPvEstimates.join(','),
      limitPv:          _.round(limitPv),
      limitPvHours,
      note,
      rate:             `${_.round(rate * 100, 1)}% (${_.round(capacity * rate)}W)`,
    });

    lastLog  = dayjs();
    lastRate = rate;
  }

  return rate;
};

const handleRate = async function({capacity, log = false}) {
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

      dcPowers.enq(dcPower);
    } catch(err) {
      throw new Error(`Failed getting battery state: ${err.message}`);
    }
    try {
      rate        = getBatteryRate({capacity, chargeState, log, solcast});
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
    // logger.info('Inverter Status (StVnd)', await inverter.readRegister('StVnd'));
    // logger.info('Inverter Power (VA)', await inverter.readRegister('VA'));

    // logger.info('Battery State (ChaSt)', await inverter.readRegister('ChaSt'));
    // logger.info('Battery Percent (ChaState)', await inverter.readRegister('ChaState'));

    // logger.info('Battery Control (StorCtl_Mod)', await inverter.readRegister('StorCtl_Mod'));
    // logger.info('Battery Rate Timeout (InOutWRte_RvrtTms)', await inverter.readRegister('InOutWRte_RvrtTms'));
    // logger.info('Battery Charge Rate (InWRte)', await inverter.readRegister('InWRte'));
  } catch(err) {
    logger.error(`Failed to handle battery rate: ${err.message}`);

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Fehler, handleRate()',
      html:    err.message,
    });
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
  try {
    inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
    await inverter.open();

    smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
    await smartMeter.open();
  } catch(err) {
    logger.error(`Failed to open inverter`);

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Fehler, startup',
      html:    err.message,
    });


    await delay(ms('10 seconds')); // Delay shutdown

    await stopProcess();

    return;
  }

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
  // Handle Stromzähler data
  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      const message = JSON.parse(messageRaw);

      switch(topic) {
        case 'strom/tele/SENSOR':
          ({momentanLeistung} = message);

          break;

        case 'tasmota/espstrom/tele/SENSOR': {
          const zaehlerEinspeisung = -message.SML.Leistung;

          // logger.debug({zaehlerEinspeisung});

          einspeisungen.enq(zaehlerEinspeisung);
          break;
        }

        case 'tasmota/solar/tele/SENSOR': {
          garageLeistung = message.ENERGY.Power;

          // logger.debug({garageLeistung});
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

  await mqttClient.subscribe('strom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espstrom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/solar/tele/SENSOR');

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
        logger.warn('Storage is charging and discharging at the same time', {currentStorageChargeWh, currentStorageDisChargeWh, powerFlow});
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

        await fsPromises.copyFile('/var/fronius-battery/fronius-battery.json', '/var/fronius-battery/fronius-battery.json.bak');
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

      await sendMail({
        to:      'technik@heine7.de',
        subject: 'Fronius Solar Fehler, froniusInterval()',
        html:    err.message,
      });

      if(err.message === 'Port Not Open') {
        await inverter.close();
        logger.info('inverter.closed');
        inverter = undefined;
      }
    }
  }, ms('1 minute'));

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
//  }, ms('5 seconds'));

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
  await delay(ms('10 seconds')); // Await mqtt report cycle

  await handleRate({capacity});

  //                s min h d m wd
  const schedule = '0 * * * * *'; // Every minute

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

    await handleRate({capacity});
  });

  process.on('SIGHUP', () => handleRate({capacity, log: true}));
})();
