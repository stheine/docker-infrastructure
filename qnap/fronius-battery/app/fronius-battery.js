#!/usr/bin/env node

/* eslint-disable camelcase */

import fsPromises        from 'fs/promises';

import {setTimeout as delay} from 'timers/promises';

import _                 from 'lodash';
import axios             from 'axios';
import check             from 'check-types-2';
import cron              from 'node-cron';
import dayjs             from 'dayjs';
import fsExtra           from 'fs-extra';
import ms                from 'ms';
import mqtt              from 'async-mqtt';
import Ringbuffer        from '@stheine/ringbufferjs';
import utc               from 'dayjs/plugin/utc.js';

import FroniusClient     from './fronius-client.js';
import logger            from './logger.js';
import {sendMail}        from './mail.js';
import sunspecInverter   from './sunspec_map_inverter.js';
import sunspecSmartMeter from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

// ###########################################################################
// Globals

let   config;
const dcPowers = new Ringbuffer(10);
const einspeisungen = new Ringbuffer(60);
let   froniusInterval;
let   inverter;
let   lastLog;
let   lastRate;
let   momentanLeistung = 0;
let   mqttClient;
let   smartMeter;
let   smartMeterInterval;

dcPowers.enq(0);
einspeisungen.enq(0);

// ###########################################################################
// Process handling

const stopProcess = async function() {
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
      `https://api.solcast.com.au/rooftop_sites/${config.RESOURCE_ID}/forecasts?hours=24`,
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

const wattToRate = function({capacity, watt}) {
  if(!capacity) {
    return 0;
  }

  const rate = _.max([_.min([watt / capacity, 1]), 0]);

  return rate;
};

const getBatteryRate = function({capacity, chargeState, log, solcastForecasts}) {
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
  for(const forecast of solcastForecasts) {
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
    if(estimate > config.dcLimit) {
      // Estimate is for 30 minute period
      limitPv      += estimate / 2;
      limitPvHours += 1 / 2;
    }
  }

  // Charge to at least 12%
  // On the weekend (Saturday, Sunday) (try to) charge to 100% (to allow the BMS to calibrate the SoC)
  // In March/ April/ September/ October charge to springChargeGoal (95%)
  // In May/ June/ July/ August charge to summerChargeGoal (80%)
  if(chargeState < 12) {
    note = `Charge to min of 12% (is ${chargeState}%).`;
    rate = 1;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 3, 11) &&
    chargeState > config.springChargeGoal
  ) {
    note = `March to October, limit to ${config.springChargeGoal}%.`;
    rate = 0;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 5, 9) &&
    chargeState > config.summerChargeGoal
  ) {
    note = `May to August, limit to ${config.summerChargeGoal}%.`;
    rate = 0;
  } else if(toCharge < 250) {
    note = `Charge the last few Wh with 1000W (${toCharge}Wh toCharge).`;
    rate = wattToRate({capacity, watt: 1000});
  } else if(maxDcPower > config.dcLimit) {
    if(limitPvHours || highPvHours > 4) {
      note = `PV (${maxDcPower}W) over the limit and good forecast. ` +
        `Charge what's over the limit minus momentanLeistung, min 100W, max ${toCharge / (limitPvHours || 1)}W.`;
      rate = wattToRate({
        capacity,
        watt: _.min([
          _.max([
            100,                                                             // At least 100W
            maxDcPower + 10 - _.max([0, momentanLeistung]) - config.dcLimit, // Over the limit
            toCharge / highPvHours,                                          // Remaining by highPvHours
          ]),
          toCharge / (limitPvHours || 1),                                    // Remaining by limitPvHours
        ]),
      });
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
      rate = wattToRate({capacity, watt: _.max([1000, toCharge / highPvHours * 2])});
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
    (toCharge > 30 && maxDcPower > 10 && now - lastLog > ms('28 minutes')) ||
    rate !== lastRate
  ) {
    logger.debug('getBatteryRate', {
      toCharge:         `${_.round(toCharge / 1000, 1)}kWh`,
      chargeState:      `${chargeState}%`,
      maxDcPower:       `${maxDcPower}W (${_.uniq(dcPowers.dump()).join(',')})`,
      momentanLeistung: `${_.round(momentanLeistung / 1000, 1)}kW`,
      maxEinspeisung:   `${maxEinspeisung}W (${_.uniq(einspeisungen.dump()).join(',')})`,
      totalPv:          `${_.round(totalPv) / 1000}kWh`,
      totalPvHours,
      highPv:           `${_.round(highPv) / 1000}kWh`,
      highPvHours,
      highPvEstimates:  highPvEstimates.join(','),
      limitPv:          `${_.round(limitPv) / 1000}kWh`,
      limitPvHours,
      note,
      rate:             `${_.round(rate * 100, 1)}% (${_.round(capacity * rate)}W)`,
    });

    lastLog  = now;
    lastRate = rate;
  }

  return rate;
};

const handleRate = async function({capacity, log = false}) {
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
      rate        = getBatteryRate({capacity, chargeState, log, solcastForecasts});
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

  let froniusBatteryStatus;

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
    froniusBatteryStatus = await fsExtra.readJson('/var/fronius/fronius-battery.json');
  } catch(err) {
    logger.error('Failed to read JSON in /var/fronius/fronius-battery.json', err.message);

    process.exit(1);
  }

  let {solarWh, storageChargeWh, storageDisChargeWh} = froniusBatteryStatus;

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

  await mqttClient.subscribe('strom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espstrom/tele/SENSOR');

  // #########################################################################
  // Handle Fronius data
  froniusInterval = setInterval(async() => {
    if(!inverter) {
      logger.info('Reconnector Modbus inverter');
      inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
      await inverter.open();
    }
    if(!smartMeter) {
      smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
      await smartMeter.open();
    }

    try {
      const resultsSmartMeter = await smartMeter.readRegisters(['W']);
      const resultsMppt       = await inverter.readRegisters(['ChaState',
        '1_DCW', '2_DCW', '3_DCW', '4_DCW', '1_DCWH', '2_DCWH', '3_DCWH', '4_DCWH']);
      const resultsInverter   = await inverter.readRegisters(['W']);

      if(resultsMppt['1_DCWH'] && resultsMppt['2_DCWH']) {
        solarWh = resultsMppt['1_DCWH'] + resultsMppt['2_DCWH'];
      }
      if(resultsMppt['3_DCWH']) {
        storageChargeWh = resultsMppt['3_DCWH'];
      }
      if(resultsMppt['4_DCWH']) {
        storageDisChargeWh = resultsMppt['4_DCWH'];
      }

      await fsPromises.copyFile('/var/fronius/fronius-battery.json',
        '/var/fronius/fronius-battery.json.bak');
      await fsExtra.writeJson('/var/fronius/fronius-battery.json', {
        ...froniusBatteryStatus,
        solarWh,
        storageChargeWh,
        storageDisChargeWh,
      }, {spaces: 2});

      await mqttClient.publish('Fronius/solar/tele/SENSOR', JSON.stringify({
        battery: {
          powerIncoming:      resultsMppt['3_DCW'],
          powerOutgoing:      resultsMppt['4_DCW'],
          solarWh,
          stateOfCharge:      resultsMppt.ChaState / 100,
          storageChargeWh,
          storageDisChargeWh,
        },
        meter: {
          powerIncoming: resultsSmartMeter.W > 0 ?  resultsSmartMeter.W : 0,
          powerOutgoing: resultsSmartMeter.W < 0 ? -resultsSmartMeter.W : 0,
        },
        inverter: {
          powerIncoming: resultsInverter.W < 0 ? -resultsInverter.W : 0,
          powerOutgoing: resultsInverter.W > 0 ?  resultsInverter.W : 0,
        },
        solar: {
          powerOutgoing: resultsMppt['1_DCW'] + resultsMppt['2_DCW'],
        },
      }), {retain: true});
    } catch(err) {
      logger.error(`froniusInterval(), failed to read data: ${err.message}`);

      await sendMail({
        to:      'technik@heine7.de',
        subject: 'Fronius Solar Fehler, froniusInterval()',
        html:    err.message,
      });

      if(err.message === 'Port Not Open') {
        await inverter.close();
        inverter = undefined;
        await smartMeter.close();
        smartMeter = undefined;
        logger.info('inverter and smartMeter closed');
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
  {
    await delay(ms('10 seconds')); // Await mqtt report cycle

    await handleRate({capacity});

    //                s min h d m wd
    const schedule = '0 * * * * *'; // Every minute

    cron.schedule(schedule, async() => {
      // logger.info(`--------------------- Cron handleRate ----------------------`);

      if(!capacity) {
        try {
          capacity = await inverter.readRegister('WHRtg');

          await sendMail({
            to:      'technik@heine7.de',
            subject: 'Fronius Solar Batterie ok',
            html:    `Batterie ${capacity} ok`,
          });
        } catch(err) {
          logger.error(`Failed to read battery capacity: ${err.message}`);
        }
      }

      await handleRate({capacity});
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
        const url = 'https://www.fronius.com/de-de/germany/solarenergie/installateure-partner/technische-daten/alle-produkte/wechselrichter/fronius-symo-gen24-plus/fronius-symo-gen24-8-0-plus';
        const response = await axios.get(url);
        const latestVersion = response.data.replace(/^[\s\S]*Firmware Changelog Fronius Gen24 Tauro /, '').replace(/<\/span>[\s\S]*$/, '');

        logger.info('Software version check', {runningVersion, latestVersion});

        if(runningVersion !== latestVersion) {
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
        }
      } catch(err) {
        logger.error(`Failed to read software version: ${err.message}`);
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

      await handleRate({capacity, log: true});
    } catch(err) {
      logger.error('Failed to read JSON in /var/fronius/fronius-battery.json in SIGHUP handler', err.message);
    }
  });
})();
