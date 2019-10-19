#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const check          = require('check-types');
const fsExtra        = require('fs-extra');
const moment         = require('moment');
const mqtt           = require('async-mqtt');
const smartmeterObis = require('smartmeter-obis');

const rrdtool        = require('./rrdtool');

// ###########################################################################
// Globals

let   mqttClient;
let   smTransport;
const status = {};

// ###########################################################################
// Logging

const log = {
  info(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg);
    }
  },
  warn(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg);
    }
  },
  error(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg);
    }
  },
};

// ###########################################################################
// Process handling

const stopProcess = async function() {
  // if you want to cancel the processing because of this error,
  // call smTransport.stop() before returning, else processing continues
  smTransport.stop();

  await mqttClient.end();

  log.info(`Shutdown -------------------------------------------------`);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Main (async)

(async() => {
  // #########################################################################
  // Startup

  log.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // SmartmeterObis

  const smOptions = {
    protocol:                    'SmlProtocol',
    protocolSmlIgnoreInvalidCRC: false,
    transport:                   'SerialRequestResponseTransport',
    transportSerialPort:         '/dev/ttyAMA0',
    transportSerialBaudrate:      9600,
    transportSerialDataBits:      8,
    transportSerialParity:        'none',
    transportSerialStopBits:      1,
    requestInterval:              0,
    obisNameLanguage:             'de',
    obisFallbackMedium:           6,
  };

  const handleData = async function(err, obisResult) {
    try {
      if(err) {
        log.error('handleData(): Error received', err);
        // handle error

        await stopProcess();

        return;
      }

      const rrdUpdates = {};

      for(const obisId of Object.keys(obisResult)) {
        const obisName = smartmeterObis.ObisNames.resolveObisName(
          obisResult[obisId],
          smOptions.obisNameLanguage
        ).obisName;
        let   rrdName;
        let   rrdValue;

        switch(obisId) {
          case '1-0:1.8.0*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (Total)
            check.assert.equal(obisResult[obisId].getValueLength(), 1);
            rrdName = 'gesamtLeistung';
            rrdValue = obisResult[obisId].getValue(0).value;
            break;

          case '1-0:16.7.0*255':        // Momentanwert Gesamtwirkleistung (Total)
            check.assert.equal(obisResult[obisId].getValueLength(), 1);
            rrdName = 'momentanLeistung';
            rrdValue = obisResult[obisId].getValue(0).value;

            status[rrdName] = rrdValue;

            await fsExtra.writeJson('/var/strom/strom.json', status);

  //          log.info(`${rrdValue}W`);
            break;

          case '1-0:0.0.9*255':         // Device ID
          case '1-0:1.8.1*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T1)
          case '1-0:1.8.2*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T2)
          case '129-129:199.130.3*255': // Manufacturer ID/ Hersteller
          case '129-129:199.130.5*255': // Forename/ Public Key
            // Suppress these values
            break;

          default:
            log.error(`Unhandled obisId ${obisResult[obisId].idToString()}: ${obisName}`);
            break;
        }

        if(rrdName) {
          rrdUpdates[rrdName] = rrdValue;
        }

    //    log.info(
    //      obisResult[obisId].idToString() + ': ' +
    //      obisName + ' = ' +
    //      obisResult[obisId].valueToString() + ' / ' +
    //      rrdName + ' = ' + rrdValue
    //    );
      }

      // Update values into rrd database
      log.info('rrd', rrdUpdates);

      await rrdtool.update('/var/strom/strom.rrd', rrdUpdates);
    } catch(errHandleData) {
      log.error('handleData(): Exception', errHandleData);

      smTransport.stop();
    }
  };

  smTransport = smartmeterObis.init(smOptions, handleData);

  smTransport.process();

  // setTimeout(smTransport.stop, 60000);

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  mqttClient.on('message', async(topic, messageBuffer) => {
    let message;

    try {
      message = JSON.parse(messageBuffer.toString());
    } catch(err) {
      log.error(`Failed to parse mqtt message for '${topic}': ${messageBuffer.toString()}`);

      return;
    }

    switch(topic) {
      case 'tele/PowSolar/SENSOR': {
        // message = {
        //   Time: '2019-10-14T15:53:49',
        //   ENERGY: {
        //     TotalStartTime: '2019-10-08T16:24:23',
        //     Total:          0.008,
        //     Yesterday:      0.000,
        //     Today:          0.000,
        //     Period:         0,
        //     Power:          0,
        //     ApparentPower:  0,
        //     ReactivePower:  0,
        //     Factor:         0.00,
        //     Voltage:        0,
        //     Current:        0.000,
        //   },
        // }

        const rrdUpdates = {
          apparentPower: message.ENERGY.ApparentPower,
          power:         message.ENERGY.Power,
          reactivePower: message.ENERGY.ReactivePower,
          total:         message.ENERGY.Total,
        };

        status.apparentPower = message.ENERGY.ApparentPower;
        status.power         = message.ENERGY.Power;
        status.reactivePower = message.ENERGY.ReactivePower;

        await fsExtra.writeJson('/var/strom/strom.json', status);

        // Update values into rrd database
        log.info('rrd', rrdUpdates);

        await rrdtool.update('/var/strom/solar.rrd', rrdUpdates);
        break;
      }

      default:
        log.warn(`Unhandled mqtt topic '${topic}'`);
        break;
    }
  });

//  await mqttClient.subscribe('stat/PowSolar/POWER');   // Button oder per cmnd/PowSolar/power ' '
//  await mqttClient.subscribe('stat/PowSolar/STATUS8'); // Angefordert per cmnd/PowSolar/STATUS '8'
//  await mqttClient.subscribe('tele/PowSolar/#');
  await mqttClient.subscribe('tele/PowSolar/SENSOR');  // Automatisch, interval
})();
