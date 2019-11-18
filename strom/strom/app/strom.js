#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const check          = require('check-types');
const fsExtra        = require('fs-extra');
const moment         = require('moment');
const mqtt           = require('async-mqtt');
const smartmeterObis = require('smartmeter-obis');

const logger         = require('./logger');

// ###########################################################################
// Globals

let mqttClient;
let smTransport;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  // if you want to cancel the processing because of this error,
  // call smTransport.stop() before returning, else processing continues
  smTransport.stop();

  await mqttClient.end();

  logger.info(`Shutdown -------------------------------------------------`);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Main (async)

(async() => {
  // Globals
  let solarLeistung = 0;
  let zaehlerTimestamp;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/strom/strom.json');

  let {gesamtEinspeisung} = status;

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // Subscribe to Solar data to get feed-in
  mqttClient.on('message', async(topic, messageBuffer) => {
    try {
      const message = JSON.parse(messageBuffer.toString());

      solarLeistung = message.ENERGY.Power;
    } catch(err) {
      logger.error(`Failed to parse mqtt message for '${topic}': ${messageBuffer.toString()}`);
    }
  });

  await mqttClient.subscribe('PowSolar/tele/SENSOR');

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
        logger.error('handleData(): Error received', err);
        // handle error

        await stopProcess();

        return;
      }

      const payload = {};

      for(const obisId of Object.keys(obisResult)) {
        const obisName = smartmeterObis.ObisNames.resolveObisName(
          obisResult[obisId],
          smOptions.obisNameLanguage,
        ).obisName;

        switch(obisId) {
          case '1-0:1.8.0*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (Total)
            check.assert.equal(obisResult[obisId].getValueLength(), 1);
            payload.gesamtLeistung = obisResult[obisId].getValue(0).value;
            break;

          case '1-0:16.7.0*255': {      // Momentanwert Gesamtwirkleistung (Total)
            check.assert.equal(obisResult[obisId].getValueLength(), 1);

            const zaehlerLeistung   = obisResult[obisId].getValue(0).value;

            payload.zaehlerLeistung  = zaehlerLeistung;
            payload.momentanLeistung = zaehlerLeistung + solarLeistung;

            if(zaehlerLeistung < 0 && zaehlerTimestamp) {
              const nowTimestamp = moment();

                                // Leistung (W)    * differenzSeitLetzterMessung (ms)    (s)    (h)    (k)    positive
              gesamtEinspeisung += zaehlerLeistung * (nowTimestamp - zaehlerTimestamp) / 1000 / 3600 / 1000 * -1; // kWh

              await fsExtra.writeJson('/var/strom/strom.json', {gesamtEinspeisung});
            }
            payload.gesamtEinspeisung = gesamtEinspeisung;

            zaehlerTimestamp = moment();

  //          logger.info(`${value}W`);
            break;
          }

          case '1-0:0.0.9*255':         // Device ID
          case '1-0:1.8.1*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T1)
          case '1-0:1.8.2*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T2)
          case '129-129:199.130.3*255': // Manufacturer ID/ Hersteller
          case '129-129:199.130.5*255': // Forename/ Public Key
            // Suppress these values
            break;

          default:
            logger.error(`Unhandled obisId ${obisResult[obisId].idToString()}: ${obisName}`);
            break;
        }

    //    logger.info(
    //      obisResult[obisId].idToString() + ': ' +
    //      obisName + ' = ' +
    //      obisResult[obisId].valueToString() + ' / ' +
    //      name + ' = ' + value
    //    );
      }

      // Publish to mqtt
      logger.info('mqtt', payload);

      await mqttClient.publish(`Stromzaehler/tele/SENSOR`, JSON.stringify(payload));
    } catch(errHandleData) {
      logger.error('handleData(): Exception', errHandleData);
    }
  };

  smTransport = smartmeterObis.init(smOptions, handleData);

  smTransport.process();

  // setTimeout(smTransport.stop, 60000);
})();
