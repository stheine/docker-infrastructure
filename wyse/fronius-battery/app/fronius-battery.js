#!/usr/bin/env node

/* eslint-disable function-call-argument-newline */

import {setTimeout as delay} from 'node:timers/promises';
import fsPromises            from 'node:fs/promises';
import os                    from 'node:os';

import _                     from 'lodash';
import AsyncLock             from 'async-lock';
import check                 from 'check-types-2';
import {Cron}                from 'croner';
import dayjs                 from 'dayjs';
import fsExtra               from 'fs-extra';
import mqtt                  from 'mqtt';
import ms                    from 'ms';
import promiseAllByKeys      from 'promise-results/allKeys.js';
import Ringbuffer            from '@stheine/ringbufferjs';
import utc                   from 'dayjs/plugin/utc.js';
import {
  logger,
  sendMail,
} from '@stheine/helpers';

import FroniusClient         from './fronius-client.js';
import getLatestVersion      from './getLatestVersion.js';
import sunspecInverter       from './sunspec_map_inverter.js';
import sunspecSmartMeter     from './sunspec_map_smart_meter.js';

dayjs.extend(utc);

// ###########################################################################
// Globals

let   config;
const dcPowers              = new Ringbuffer(10);
const einspeisungen         = new Ringbuffer(60);
let   froniusBatteryStatus;
let   froniusInterval;
const hostname              = os.hostname();
const lock                  = new AsyncLock();

let   autoStatus            = {};
let   chargeStatePct;
let   capacityWh;
let   chargeBaselineW;
let   gridChargingDoneInterval;
let   gridChargingHandlerTimeout;
let   healthInterval;
let   heizstabLeistung      = null;
let   inverter;
let   lastLog;
let   lastRate;
let   maxSun                = 0;
let   momentanLeistung      = 0;
let   mqttClient;
const notified              = {};
let   smartMeter;
let   smartMeterInterval;
let   solcastAnalysis;
let   strompreise;
let   sunTimes;
let   vwChargePowerKw;
let   vwBatterySocPct;
let   vwTargetSocPct;

dcPowers.enq(0);
einspeisungen.enq(0);

const updateFroniusBatteryStatus = async function(set) {
  await lock.acquire('fronius-battery.json', async() => {
    froniusBatteryStatus = {...froniusBatteryStatus, ...set};

    await mqttClient.publishAsync('Fronius/solar/tele/STATUS', JSON.stringify(froniusBatteryStatus),
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
  if(froniusBatteryStatus.gridCharge) {
    await updateFroniusBatteryStatus({gridCharge: false});
  }

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
    await mqttClient.endAsync();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Solcast, weather forecast

const wattToRate = function({watt}) {
  if(!capacityWh) {
    return 0;
  }

  const rate = _.max([_.min([watt / capacityWh, 1]), 0]);

  return rate;
};

const getBatteryChargePct = function({log}) {
  if(!capacityWh) {
    return 0;
  }
  if(_.isEmpty(solcastAnalysis)) {
    return 0;
  }

  const maxDcPower        = _.max(dcPowers.dump());
  const maxEinspeisung    = _.max(einspeisungen.dump());
  const toChargeWh        = _.round(capacityWh * (100 - chargeStatePct) / 100);
  let   demandOvernightWh = 0;
  let   note;
  let   rate;
  const now          = dayjs.utc();
  const maxSunTime   = now.clone()
    .hour(new Date(maxSun).getUTCHours())
    .minute(new Date(maxSun).getUTCMinutes())
    .second(0);
  const today22Time = now.clone().hour(22).minute(0).second(0);
  const tomorrow6Time = now.clone().hour(24 + 6).minute(0).second(0);
  const tomorrowNoonTime = now.clone().hour(36).minute(0).second(0);

  const {
    highPvHours,
    highPvWh,
    hourlyForecasts,
    limitPvHours,
    limitPvWh,
    tomorrowPvWh,
    totalPvWh,
  } = solcastAnalysis;

  for(const forecast of hourlyForecasts) {
    const {estimateWh, startDate} = forecast;
    const periodStartDate = Date.parse(startDate);

    // const {pv_estimate: estimateKWh} = forecast;
    // const estimateWh = estimateKWh * 1000; // kWh to Wh

    if(periodStartDate > maxSunTime && periodStartDate < tomorrowNoonTime) {
      // This includes the coming night
      let predictDemandWh;

      if(periodStartDate < today22Time || periodStartDate > tomorrow6Time) {
        predictDemandWh = 500;
      } else {
        predictDemandWh = 200;
      }

      if(estimateWh < predictDemandWh) {
        demandOvernightWh += (predictDemandWh - estimateWh) / 2;

        // console.log({period_end: dayjs(periodStartDate).format('HH:mm'), predictDemandWh, estimateWh});
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
  } else if(chargeStatePct < 20) {
    note = `Charge to min of 20% (is ${chargeStatePct}%) with max.`;
    rate = 1;
  } else if(autoStatus.atHome &&
    ['Ladebereit', 'Warte auf Ladefreigabe'].includes(autoStatus.wallboxState) &&
    vwBatterySocPct < vwTargetSocPct
  ) {
    note = `Charge maximum (Auto).`;
    rate = 1;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 4, 11) &&
    chargeStatePct > config.springChargeGoal &&
    tomorrowPvWh > 3 * capacityWh &&
    demandOvernightWh < capacityWh * config.springChargeGoal / 100 &&
    !froniusBatteryStatus.chargeTo
  ) {
    note = `April to October, limit to ${config.springChargeGoal}%.`;
    rate = 0;
  } else if(!['Sat', 'Sun'].includes(now.format('ddd')) &&
    _.inRange(now.format('M'), 5, 9) &&
    chargeStatePct > config.summerChargeGoal &&
    tomorrowPvWh > 3 * capacityWh &&
    demandOvernightWh < capacityWh * config.summerChargeGoal / 100 &&
    !froniusBatteryStatus.chargeTo
  ) {
    note = `May to August, limit to ${config.summerChargeGoal}%.`;
    rate = 0;
  } else if(toChargeWh < capacityWh * 0.03) {
    note = `Charge the last few Wh with ${capacityWh * 0.05}W (${toChargeWh}Wh toCharge).`;
    rate = wattToRate(capacityWh * 0.05);
  } else if(maxDcPower > config.dcLimit) {
    if(limitPvHours || maxDcPower > config.dcLimit) {
      note = `PV (${maxDcPower}W) over the limit and very good forecast. ` +
        `Charge what's over the limit minus momentanLeistung, ` +
        `min ${capacityWh * 0.1}W, max ${toChargeWh / (limitPvHours || 1)}W.`;
      rate = wattToRate(_.max([
        capacityWh * 0.1,                                                // At least 0.1C
        maxDcPower + 10 - _.max([0, momentanLeistung + heizstabLeistung]) - config.dcLimit, // Over the limit
      ]));
    } else if(highPvHours > 4) {
      note = `PV (${maxDcPower}W) over the limit and good forecast. ` +
        `Charge what's over the limit minus momentanLeistung, ` +
        `min ${capacityWh * 0.1}W, max ${toChargeWh / (limitPvHours || 1)}W.`;
      rate = wattToRate(_.min([
        _.max([
          capacityWh * 0.1,                                                // At least 0.1C
          maxDcPower + 10 - _.max([0, momentanLeistung + heizstabLeistung]) - config.dcLimit, // Over the limit
          toChargeWh / highPvHours,                                        // Remaining by highPvHours
        ]),
        toChargeWh / (limitPvHours || 1),                                  // Remaining by limitPvHours
      ]));
    } else if(totalPvWh > 3 * toChargeWh) {
      if(now < maxSunTime) {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. Before max sun.`;
        rate = wattToRate(_.max([capacityWh * 0.1, toChargeWh / highPvHours]));
      } else {
        note = `PV (${maxDcPower}W) over the limit and sufficient for today. After max sun.`;
        rate = wattToRate(_.max([capacityWh * 0.2, toChargeWh / highPvHours]));
      }
    } else {
      note = `PV (${maxDcPower}W) over the limit but low forecast. Charge max.`;
      rate = 1;
    }
  } else if(maxEinspeisung > config.dcLimit - 500) {
    note = `PV Einspeisung (${maxEinspeisung}W) close to the limit. Charge ${capacityWh * 0.1}W.`;
    rate = wattToRate(capacityWh * 0.1);
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
      rate = wattToRate(_.max([capacityWh * 0.1, toChargeWh / highPvHours]));
    } else {
      note = `High PV for enough hours to charge. After max sun.`;
      rate = wattToRate(_.max([capacityWh * 0.2, toChargeWh / highPvHours * 2]));
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
    logger.debug('getBatteryChargePct', {
      totalPv:          `${_.round(totalPvWh) / 1000}kWh`,
      highPv:           `${_.round(highPvWh) / 1000}kWh`,
      highPvHours,
      limitPv:          `${_.round(limitPvWh) / 1000}kWh`,
      limitPvHours,
      tomorrowPv:       `${_.round(tomorrowPvWh) / 1000}kWh`,
      maxSun,
      maxDcPower:       `${maxDcPower}W (${_.uniq(dcPowers.dump()).join(',')})`,
      maxEinspeisung:   `${maxEinspeisung}W (${_.uniq(einspeisungen.dump()).join(',')})`,
      momentanLeistung: `${_.round(momentanLeistung / 1000, 1)}kW`,
      vwChargePowerKw:  `${vwChargePowerKw}kW`,
      vwBatterySocPct:  `${vwBatterySocPct}%`,
      heizstabLeistung: `${_.round(heizstabLeistung / 1000, 1)}kW`,
      chargeState:      `${chargeStatePct}%`,
      toCharge:         `${_.round(toChargeWh / 1000, 1)}kWh`,
      demandOvernight:  `${_.round(demandOvernightWh / 1000, 1)}kWh`,
      rate:             `${_.round(capacityWh * rate)}W (${_.round(rate, 2)}C)`,
      note,
    });

    lastLog  = now;
    lastRate = rate;
  }

  return rate * 100;
};

let handleRateErrorCount = 0;

// eslint-disable-next-line no-unused-vars
const resetBattery = async function() {
  // Allow charge and discharge control
  try {
    await inverter.writeRegister('StorCtl_Mod', [0]);
  } catch(err) {
    throw new Error(`Failed writing battery charge control: ${err.message}`);
  }

  try {
    await inverter.writeRegister('InOutWRte_RvrtTms', [5]);
  } catch(err) {
    throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
  }

  // Only charge from PV
  try {
    await inverter.writeRegister('ChaGriSet', [0]);
  } catch(err) {
    throw new Error(`Failed writing grid allow: ${err.message}`);
  }
};

const preventBatteryUnload = async function() {
  // Entladen verhindern (während Auto geladen wird):
  // OutWRte (discharge) auf 0 (null) setzen

  // Allow charge and discharge control
  try {
    // Bit0 enable charge control
    // Bit1 enable discharge control
    await inverter.writeRegister('StorCtl_Mod', [3]);
  } catch(err) {
    throw new Error(`Failed writing battery charge control: ${err.message}`);
  }

  try {
    // Timeout for (dis)charge rate in seconds, 3900s => 65min
    await inverter.writeRegister('InOutWRte_RvrtTms', [3900]);
  } catch(err) {
    throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
  }

  // Prevent discarge
  try {
    await inverter.writeRegister('OutWRte', [0]);
  } catch(err) {
    throw new Error(`Failed writing battery discharge rate: ${err.message}`);
  }
};

const setBatteryGridCharge = async function(chargePct = 100) {
  // Akku zwangsladen (während niedriger Strompreise):
  // ==> Maximale Ladeleistung:
  //     InWRte (charge) auf 10000 (100.00 %) setzen
  // ==> Laden erzwingen = "negatives Entladen":
  //     OutWRte (discharge) auf -10000 (-100.00 %) setzen

  // Allow charge and discharge control
  try {
    // Bit0 enable charge control
    // Bit1 enable discharge control
    await inverter.writeRegister('StorCtl_Mod', [3]);
  } catch(err) {
    throw new Error(`Failed writing battery charge control: ${err.message}`);
  }

  try {
    // Timeout for (dis)charge rate in seconds, 3900s => 65min
    await inverter.writeRegister('InOutWRte_RvrtTms', [3900]);
  } catch(err) {
    throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
  }

  // Allow charging from grid
  try {
    await inverter.writeRegister('ChaGriSet', [1]);
  } catch(err) {
    throw new Error(`Failed writing grid allow: ${err.message}`);
  }

  // Max load rate
  try {
    // Allow 100% of max Charge rate. * 100 => Scaling Factor
    await inverter.writeRegister('InWRte', [100 * 100]);
  } catch(err) {
    throw new Error(`Failed writing max battery charge rate: ${err.message}`);
  }

  // Set load
  try {
    // % of max Charge. * 100 => Scaling Factor
    await inverter.writeRegister('OutWRte', [-chargePct * 100]);
  } catch(err) {
    throw new Error(`Failed writing battery discharge rate: ${err.message}`);
  }
};

const setBatteryPvCharge = async function(chargePct) {
  // Allow charge control
  try {
    // Bit0 enable charge control
    await inverter.writeRegister('StorCtl_Mod', [1]);
  } catch(err) {
    throw new Error(`Failed writing battery charge control: ${err.message}`);
  }

  try {
    // Timeout for (dis)charge rate in seconds, 3900s => 65min
    await inverter.writeRegister('InOutWRte_RvrtTms', [3900]);
  } catch(err) {
    throw new Error(`Failed writing battery charge timeout: ${err.message}`);
  }

  // Only charge from PV
  try {
    await inverter.writeRegister('ChaGriSet', [0]);
  } catch(err) {
    throw new Error(`Failed writing PV charge: ${err.message}`);
  }

  // Set charge rate
  try {
    const set = _.round(chargePct * 100); // * 100 => scalingFactor

    await inverter.writeRegister('InWRte', [set]); // rate% von max Ladeleistung
  } catch(err) {
    throw new Error(`Failed writing battery chargePct ${chargePct}: ${err.message}`);
  }
};

const handleRate = async function(log = false) {
  try {
    // Get charge rate
    let dcPower;
    let chargePct;

    try {
      const results = await inverter.readRegisters(['ChaState', '1_DCW', '2_DCW']);

      chargeStatePct = _.round(results.ChaState, 1);
      dcPower        = _.round(results['1_DCW'] + results['2_DCW']);

      dcPowers.enq(dcPower);
    } catch(err) {
      throw new Error(`Failed getting battery state: ${err.message}`);
    }

    if(froniusBatteryStatus.gridCharge) {
      // Do nothing. Battery charging handled in handler.
    } else if(autoStatus.chargeMode === 'Nachts' && autoStatus.wallboxState === 'Lädt') {
      await preventBatteryUnload();
    } else {
      try {
        chargePct = getBatteryChargePct({log});
        // logger.debug('handleRate', {chargeStatePct, chargePct});

        await setBatteryPvCharge(chargePct);

        Reflect.deleteProperty(notified, 'handleRate');

        handleRateErrorCount = 0;
      } catch(err) {
        throw new Error(`Failed getting battery chargePct: ${err.message}`);
      }
    }
  } catch(err) {
    logger.error(`Failed to handle battery charge: ${err.message}`);

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
  check.assert.number(config.springChargeGoal);
  check.assert.number(config.summerChargeGoal);
} catch(err) {
  logger.error('Failed to read JSON in /var/fronius/config.json', err.message);

  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

try {
  const savedFroniusBatteryStatus = await fsExtra.readJson('/var/fronius/fronius-battery.json');

  check.assert.nonEmptyObject(savedFroniusBatteryStatus);

  await updateFroniusBatteryStatus(savedFroniusBatteryStatus);
} catch(err) {
  logger.error('Failed to read JSON in /var/fronius/fronius-battery.json', err.message);

  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

// #########################################################################
// Init Modbus
try {
  inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec: sunspecInverter});
  await inverter.open();

  smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec: sunspecSmartMeter});
  await smartMeter.open();

  // #########################################################################
  // Read battery basics
  try {
    chargeStatePct  = _.round(await inverter.readRegister('ChaState'), 1);
    capacityWh      = await inverter.readRegister('WHRtg');
    chargeBaselineW = await inverter.readRegister('WChaMax');
  } catch(err) {
    logger.error(`Failed to read battery basics: ${err.message}`);

    await sendMail({
      to:      'technik@heine7.de',
      subject: 'Fronius Solar Batterie Fehler',
      html:    err.message,
    });
  }
} catch(err) {
  logger.error(`Failed to open inverter or smartMeter`);

  await sendMail({
    to:      'technik@heine7.de',
    subject: 'Fronius Solar Fehler, startup',
    html:    err.message,
  });


  await delay(ms('1 minute')); // Delay shutdown (Version update & restart takes ~10 minutes)

  await stopProcess();
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
    let message;

    try {
      message = JSON.parse(messageRaw);
    } catch{
      // ignore
    }

    switch(topic) {
      case 'auto/tele/STATUS':
        autoStatus = message;
        break;

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
        } else if(Object.hasOwn(message, 'gridChargePct')) {
          if(message.gridChargePct) {
            await updateFroniusBatteryStatus({gridCharge: true});
            await setBatteryGridCharge(message.gridChargePct);

            logger.info(`Starting grid charge with ${message.gridChargePct}%`);

            if(gridChargingDoneInterval) {
              clearInterval(gridChargingDoneInterval);
              gridChargingDoneInterval = undefined;
            }

            gridChargingDoneInterval = setInterval(async() => {
              if(chargeStatePct >= 100) {
                await updateFroniusBatteryStatus({gridCharge: false});

                clearInterval(gridChargingDoneInterval);
                gridChargingDoneInterval = undefined;

                logger.info(`Finished grid charge (${chargeStatePct}%)`);
              }
            }, ms('1 minute'));
          } else {
            await updateFroniusBatteryStatus({gridCharge: false});

            logger.info(`Stoping grid charge (${chargeStatePct}%)`);

            if(gridChargingDoneInterval) {
              clearInterval(gridChargingDoneInterval);
              gridChargingDoneInterval = undefined;
            }
          }
        } else {
          logger.error(`Unhandled cmnd '${topic}'`, message);
        }
        break;

      case 'maxSun/INFO':
        maxSun = message;
        break;

      case 'solcast/analysis':
        solcastAnalysis = message;
        break;

      case 'strom/tele/preise':
        strompreise = message;
        break;

      case 'strom/tele/SENSOR':
        ({momentanLeistung} = message);

        break;

      case 'sunTimes/INFO':
        sunTimes = message;
        break;

      case 'tasmota/espstrom/tele/SENSOR': {
        const zaehlerEinspeisung = -message.SML.Leistung;

        // logger.debug({zaehlerEinspeisung});

        einspeisungen.enq(zaehlerEinspeisung);
        break;
      }

      case 'tasmota/heizstab/stat/POWER': {
        switch(messageRaw) {
          case 'OFF':
            heizstabLeistung = 0;
            break;

          case 'ON':
            if(!heizstabLeistung) {
              heizstabLeistung = 2000;
            }
            break;

          default:
            logger.error(`Unhandled message '${topic}'`, messageRaw);
            break;
        }
        break;
      }

      case 'tasmota/heizstab/tele/SENSOR':
        heizstabLeistung = message.ENERGY.Power;
        break;

      case `vwsfriend/vehicles/${config.VWId}/domains/charging/batteryStatus/currentSOC_pct`:
        vwBatterySocPct = messageRaw;
        break;

      case `vwsfriend/vehicles/${config.VWId}/domains/charging/chargingSettings/targetSOC_pct`:
        vwTargetSocPct = messageRaw;
        break;

      case `vwsfriend/vehicles/${config.VWId}/domains/charging/chargingStatus/chargePower_kW`:
        vwChargePowerKw = messageRaw;
        break;

      default:
        logger.error(`Unhandled topic '${topic}'`, message);
        break;
    }
  } catch(err) {
    logger.error('mqtt handler failed', {topic, messageRaw, errMessage: err.message});
  }
});

await mqttClient.subscribeAsync('auto/tele/STATUS');
await mqttClient.subscribeAsync('Fronius/solar/cmnd');
await mqttClient.subscribeAsync('maxSun/INFO');
await mqttClient.subscribeAsync('solcast/analysis');
await mqttClient.subscribeAsync('strom/tele/preise');
await mqttClient.subscribeAsync('strom/tele/SENSOR');
await mqttClient.subscribeAsync('sunTimes/INFO');
await mqttClient.subscribeAsync('tasmota/espstrom/tele/SENSOR');
await mqttClient.subscribeAsync('tasmota/heizstab/stat/POWER');
await mqttClient.subscribeAsync('tasmota/heizstab/tele/SENSOR');
await mqttClient.subscribeAsync(`vwsfriend/vehicles/${config.VWId}/domains/charging/batteryStatus/currentSOC_pct`);
await mqttClient.subscribeAsync(`vwsfriend/vehicles/${config.VWId}/domains/charging/chargingSettings/targetSOC_pct`);
await mqttClient.subscribeAsync(`vwsfriend/vehicles/${config.VWId}/domains/charging/chargingStatus/chargePower_kW`);

healthInterval = setInterval(async() => {
  await mqttClient.publishAsync(`fronius-battery/health/STATE`, 'OK');
}, ms('1min'));

// #########################################################################
// Handle Fronius data
froniusInterval = setInterval(async() => {
  if(lock.isBusy('froniusInterval')) {
    return;
  }

  await lock.acquire('froniusInterval', async() => {
    let froniusIntervalErrorCount = 0;

    while(!inverter || !smartMeter) {
      try {
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
      } catch(err) {
        if(err.message.includes('ECONNREFUSED')) {
          froniusIntervalErrorCount++;

          if(froniusIntervalErrorCount < 10) {
            await delay(ms('1 minute'));
          } else if(!notified.froniusInterval) {
            await sendMail({
              to:      'technik@heine7.de',
              subject: 'Fronius Solar Fehler, froniusInterval()',
              html:    err.message,
            });

            notified.froniusInterval = true;
          }
        } else {
          throw err;
        }
      }
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

      await mqttClient.publishAsync('Fronius/solar/tele/SENSOR', JSON.stringify({
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

      if(err.message === 'Port Not Open') {
        await inverter.close();
        inverter = undefined;

        await smartMeter.close();
        smartMeter = undefined;

        logger.info('Inverter and SmartMeter closed');
      }
    }
  });
}, ms('5 seconds'));

// #########################################################################
// Handle battery grid charging
const handleBatteryGridChargingHandler = async function() {
  if(froniusBatteryStatus.gridCharge) {
    return;
  }

  logger.debug('handleBatteryGridChargingHandler', 'Now is the beginning of the cheapest hour');

  check.assert.nonEmptyObject(solcastAnalysis);

  const now         = dayjs.utc();
  const sunriseDate = dayjs(sunTimes.sunrise);
  const sunsetDate  = dayjs(sunTimes.sunset);
  const {
    hourlyForecasts,
    totalPvWh,
  } = solcastAnalysis;

  check.assert.nonEmptyArray(hourlyForecasts);
  check.assert.number(totalPvWh || 0);

  let toChargeWhFixed;
  let toChargeWhNeed;

  if(totalPvWh < 7000) {
    // Niedriger PV Ertrag vorhergesagt, dann voll laden
    toChargeWhFixed = _.round(capacityWh * (100 - chargeStatePct) / 100);

    logger.debug(`handleBatteryGridChargingHandler, very low forecast (${_.round(totalPvWh)}Wh), ` +
      `charge ${toChargeWhFixed}Wh`);
  } else if(totalPvWh < 10000) {
    // Wenig PV Ertrag vorhergesagt, dann auf Hälfte laden
    // TODO anteilig?
    toChargeWhFixed = _.max([0, _.round(capacityWh * (100 - chargeStatePct) / 100 / 2)]);

    logger.debug(`handleBatteryGridChargingHandler, low forecast (${_.round(totalPvWh)}Wh), ` +
      `charge ${toChargeWhFixed}Wh`);
  } else {
    logger.debug(`handleBatteryGridChargingHandler, okish forecast (${_.round(totalPvWh)}Wh)`);
  }

  {
    const dayData = _.filter(strompreise, data => {
      const startTimeDate = dayjs(data.startTime);

      if(startTimeDate < sunriseDate) {
        return false;
      }

      if(startTimeDate > sunsetDate) {
        return false;
      }

      return true;
    });
    const maxCentsDuringDaytime = _.max(_.map(dayData, 'cent'));

    if(maxCentsDuringDaytime > 15) {
      // Teurer Preis am Tag, voll laden
      toChargeWhFixed = _.round(capacityWh * (100 - chargeStatePct) / 100);

      logger.debug(`handleBatteryGridChargingHandler, expensive daylight price (${maxCentsDuringDaytime}ct), ` +
        `charge ${toChargeWhFixed}Wh`);
    }
  }

  {
    // logger.debug('handleBatteryGridChargingHandler', {
    //   now,
    //   sunsetDate,
    //   hourlyForecasts,
    // });

    let currentWh = _.round(capacityWh * chargeStatePct / 100);
    let chargeWh  = 0;
    let foundGood = false;
    let timeH;

    currentWh -= 1000; // 1000 Mindestreserve der Batterie;

    for(timeH of _.range(now.local().hour(), _.first(hourlyForecasts).timeH)) {
      if(timeH === 7) {
        currentWh -= 1000; // Kaffe und Tee am Morgen
      }

      if(timeH < 7) {
        currentWh -= 300;
      } else {
        currentWh -= 500;
      }

      if(currentWh < 0) {
        chargeWh -= currentWh;
        currentWh = 0;
      }

      logger.debug(`Forecast: ${timeH}:00 => ${currentWh}Wh`);
    }

    for(const forecast of hourlyForecasts) {
      const {estimateWh, startDate} = forecast;

      if(dayjs(startDate) > sunsetDate) {
        break;
      }

      timeH      = forecast.timeH;
      currentWh += estimateWh;

      if(timeH === 7) {
        currentWh -= 1000; // Kaffe und Tee am Morgen
      } else if(timeH === 13) {
        currentWh -= 1500; // Mittagessen
      } else if(timeH === 19) {
        currentWh -= 1500; // Abendessen und Beleuchtung
      }

      if(timeH < 7) {
        currentWh -= 300;
      } else {
        currentWh -= 500;
      }

      if(currentWh < 0) {
        chargeWh -= currentWh;
        currentWh = 0;
      }

      if(estimateWh < 1500) {
        logger.debug(`Forecast: ${timeH}:00 ${estimateWh}Wh => ${currentWh}Wh`);
      } else {
        logger.debug(`Forecast: ${timeH}:00 ${estimateWh}Wh => ${currentWh}Wh - good estimate`);
        foundGood = true;
      }
    }

    for(timeH of _.range(timeH + 1, 24)) {
      if(timeH === 19) {
        currentWh -= 1500; // Abendessen und Beleuchtung
      }

      if(timeH > 23) {
        currentWh -= 300;
      } else {
        currentWh -= 500;
      }

      if(currentWh < 0) {
        chargeWh -= currentWh;
        currentWh = 0;
      }

      logger.debug(`Forecast: ${timeH}:00 => ${currentWh}Wh`);
    }

    logger.debug('handleBatteryGridChargingHandler, calculate need', {
      currentWh, foundGood, chargeWh,
    });

    if(foundGood) {
      toChargeWhNeed = _.round(chargeWh);

      logger.debug(`handleBatteryGridChargingHandler, forecast (${_.round(totalPvWh)}), ` +
        `current: ${chargeStatePct}%, need: ${_.round(chargeWh)}Wh, charge ${toChargeWhNeed}Wh`);
    } else {
      toChargeWhNeed = _.round(capacityWh * (100 - chargeStatePct) / 100);

      logger.debug(`handleBatteryGridChargingHandler, no good estimate hour (${_.round(totalPvWh)}Wh), ` +
        `current: ${chargeStatePct}%, need: ${_.round(chargeWh)}Wh, charge ${toChargeWhNeed}Wh`);
    }
  }

  const toChargeWh = _.max([toChargeWhFixed, toChargeWhNeed]);

  if(toChargeWh > 0) {
    let   gridChargePct        = _.round(toChargeWh / capacityWh * 100 * 1.25);
    const targetChargeStatePct = _.min([100, chargeStatePct + gridChargePct]);

    if(gridChargePct > 100 || toChargeWh > 8000) {
      gridChargePct = 100;
    }

    await updateFroniusBatteryStatus({gridCharge: true});
    await setBatteryGridCharge(gridChargePct);

    logger.info(`Starting grid charge for ${toChargeWh}Wh (${chargeStatePct}% -> ${targetChargeStatePct}%)`);

    if(gridChargingDoneInterval) {
      clearInterval(gridChargingDoneInterval);
      gridChargingDoneInterval = undefined;
    }

    gridChargingDoneInterval = setInterval(async() => {
      await setBatteryGridCharge(gridChargePct);

      if(chargeStatePct >= targetChargeStatePct) {
        await updateFroniusBatteryStatus({gridCharge: false});

        clearInterval(gridChargingDoneInterval);
        gridChargingDoneInterval = undefined;

        logger.info(`Finished grid charge for ${toChargeWh}Wh (${chargeStatePct}%)`);
      }
    }, ms('1 minute'));
  } else {
    logger.debug(`No need to charge (toChargeWh=${toChargeWh}Wh), ${chargeStatePct}%`);
  }

  await updateFroniusBatteryStatus({batteryGridChargeDate: dayjs.utc().format('YYYY-MM-DD')});

  logger.debug('handleBatteryGridChargingHandler finished', {
    batteryGridChargeDate: froniusBatteryStatus.batteryGridChargeDate,
  });

  gridChargingHandlerTimeout = undefined;
};

const handleBatteryGridChargingSchedule = async function() {
  const now         = dayjs.utc();
  const sunriseDate = dayjs(sunTimes.sunrise);
  const sunsetDate  = dayjs(sunTimes.sunset);
  const today6Date  = dayjs().hour(6).minute(0).second(0);

  if(gridChargingHandlerTimeout) {
    // The handler is already scheduled

    if(now.date() === sunriseDate.date() && now > sunriseDate && now > today6Date) {
      // During daytime, or after sunset
      clearTimeout(gridChargingHandlerTimeout);
      gridChargingHandlerTimeout = undefined;
    }

    return;
  }
  if(froniusBatteryStatus.batteryGridChargeDate === dayjs.utc().format('YYYY-MM-DD')) {
    // The grid charge already happened today
    return;
  }

  logger.debug('handleBatteryGridChargingSchedule start', {
    batteryGridChargeDate: froniusBatteryStatus.batteryGridChargeDate,
  });

  // check.assert.equal(now.date(), sunriseDate.date(), 'Sunrise date mismatch');
  // check.assert.equal(now.date(), sunsetDate.date(), 'Sunset date mismatch');
  if(now.date() !== sunriseDate.date()) {
    logger.debug('Sunrise date mismatch', {now, sunTimes});

    return;
  }
  if(now.date() !== sunsetDate.date()) {
    logger.debug('Sunset date mismatch', {now, sunTimes});

    return;
  }

  const nightData = _.filter(strompreise, data => {
    const startTimeDate = dayjs(data.startTime);

    if(startTimeDate < now) {
      return false;
    }

    if(startTimeDate > sunriseDate && startTimeDate > today6Date) {
      return false;
    }

    return true;
  });

  if(!nightData.length) {
    if(now.hour() >= 16) {
      logger.debug('Failed to find nightData', {strompreise, sunTimes, now});
    }

    return;
  }

  // logger.debug('handleBatteryGridChargingSchedule', {
  //   nightData,
  //   firstNightData: nightData.at(0),
  //   lastNightData:  nightData.at(-1),
  //   ..._.pick(sunTimes, ['sunrise', 'sunset', 'sunriseTomorrow', 'sunsetTomorrow']),
  // });

  let key      = 0;
  let minKey;
  let minCost;

  do {
    const cost = nightData[key].cent;

    if(minCost === undefined || cost < minCost) {
      minKey  = key;
      minCost = cost;
    }

    key++;
  } while(key < nightData.length);

  logger.debug('handleBatteryGridChargingSchedule', {minKey, minCost, nightData: nightData[minKey]});

  const minCostStartTime = dayjs(nightData[minKey].startTime);

  gridChargingHandlerTimeout = setTimeout(() => handleBatteryGridChargingHandler(),
    minCostStartTime - now + ms('1 minute'));
};

await handleBatteryGridChargingSchedule();

setInterval(() => handleBatteryGridChargingSchedule(),
  ms('5 minutes'));

// #########################################################################
// Handle charge-rate once and scheduled
await delay(ms('10 seconds')); // Await mqtt report cycle

await handleRate();

setInterval(async() => {
  // logger.info(`--------------------- Cron handleRate ----------------------`);

  if(!capacityWh || !chargeBaselineW) {
    try {
      capacityWh      = await inverter.readRegister('WHRtg');
      chargeBaselineW = await inverter.readRegister('WChaMax');

      await sendMail({
        to:      'technik@heine7.de',
        subject: 'Fronius Solar Batterie ok',
        html:    `Batterie ${capacityWh}/${chargeBaselineW} ok`,
      });
    } catch(err) {
      logger.error(`Failed to read battery capacity: ${err.message}`);
    }
  }

  await handleRate();
}, ms('1 minute'));

// #########################################################################
// Check for software version update
{
  //                s min h  d m wd
  const schedule = '0 0   18 * * *'; // Once per day at 18:00

  const job = new Cron(schedule, {timezone: 'Europe/Berlin'}, async() => {
    // logger.info(`--------------------- Cron SW Version ----------------------`);

    try {
      const runningVersion = await inverter.readRegister('Vr');
      const latestVersion  = await getLatestVersion();
      // eslint-disable-next-line max-len
      const url = 'https://www.fronius.com/de-de/germany/download-center#!/searchconfig/%7B%22countryPath%22%3A%22%2Fsitecore%2Fcontent%2FGermany%22%2C%22language%22%3A%22de-DE%22%2C%22searchword%22%3A%22gen24%22%2C%22selectedCountry%22%3A%22Germany%22%2C%22solarenergy%22%3A%7B%22facets%22%3A%5B%7B%22id%22%3A%22Firmware%22%2C%22categoryId%22%3A%22DocumentType%22%7D%5D%7D%7D';

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

  _.noop('Cron job started', job);
}

// #########################################################################
// Reset charge exception
{
  //                s min h  d m wd
  const schedule = '0 0   0  * * *'; // Midnight

  const job = new Cron(schedule, {timezone: 'Europe/Berlin'}, async() => {
    if(froniusBatteryStatus.chargeMax) {
      logger.info(`Reset charge maximum.`);

      await updateFroniusBatteryStatus({chargeMax: null});
    }
    if(froniusBatteryStatus.chargeTo) {
      logger.info(`Reset charge exception. Normal charge today.`);

      await updateFroniusBatteryStatus({chargeTo: null});
    }
  });

  _.noop('Cron job started', job);
}

// #########################################################################
// Signal handler (SIGHUP) to manually trigger a re-read of the config and call handleRate().
process.on('SIGHUP', async() => {
  try {
    config = await fsExtra.readJson('/var/fronius/config.json');

    check.assert.object(config);

    logger.error(`Read springChargeGoal=${config.springChargeGoal}% summerChargeGoal=${config.summerChargeGoal}%`);

    await handleRate(true);
  } catch(err) {
    logger.error('Failed to read JSON in /var/fronius/config.json in SIGHUP handler', err.message);
  }
});
