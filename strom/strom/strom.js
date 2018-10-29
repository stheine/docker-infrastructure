#!/usr/bin/env node

const _              = require('lodash');
const check          = require('check-types');
const fsExtra        = require('fs-extra');
const moment         = require('moment');
const rrdtool        = require('rrdtool');
const smartmeterObis = require('smartmeter-obis');

const options = {
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
      console.error('handleData(): Error received', err);
      // handle error
      // if you want to cancel the processing because of this error,
      // call smTransport.stop() before returning, else processing continues

      smTransport.stop();
      return;
    }

    const rrdUpdates = {};

    for(var obisId in obisResult) {
      const obisName = smartmeterObis.ObisNames.resolveObisName(obisResult[obisId], options.obisNameLanguage).obisName;
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

          await fsExtra.writeJson('/var/strom/strom.json', {[rrdName]: rrdValue});

          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ${rrdValue}W`);
          break;

        case '1-0:0.0.9*255':         // Device ID
        case '1-0:1.8.1*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T1)
        case '1-0:1.8.2*255':         // Zählerstand 1 Summe Wirkarbeit Bezug + (T2)
        case '129-129:199.130.3*255': // Manufacturer ID/ Hersteller
        case '129-129:199.130.5*255': // Forename/ Public Key
          // Suppress these values
          break;

        default:
          console.error(`Unhandled obisId ${obisResult[obisId].idToString()}: ${obisName}`);
          break;
      }

      if(rrdName) {
        rrdUpdates[rrdName] = rrdValue;
      }

  //    console.log(
  //      obisResult[obisId].idToString() + ': ' +
  //      obisName + ' = ' +
  //      obisResult[obisId].valueToString() + ' / ' +
  //      rrdName + ' = ' + rrdValue
  //    );
    }

  //  console.log(rrdUpdates);

    // Update values into rrd database
    const rrdDb = rrdtool.open('/var/strom/strom.rrd');

    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')}`, {rrdUpdates});

    await new Promise((resolve, reject) => {
      rrdDb.update(rrdUpdates, err => {
        if(err) {
          return reject(err);
        }

        resolve();
      });
    });
  } catch(ex) {
    console.error('handleData(): Exception', ex);

    smTransport.stop();
  }
}

let smTransport = smartmeterObis.init(options, handleData);

smTransport.process();

// setTimeout(smTransport.stop, 60000);
