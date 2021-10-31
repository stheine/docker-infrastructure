#!/usr/bin/env node

'use strict';

const ModbusRTU      = require('modbus-serial');

const logger         = require('./logger.js');
const {readRegister} = require('./utils.js');
const sunspecMap     = require('./sunspec_map.js');

(async() => {
  const client = new ModbusRTU();

  try {
    await client.connectTCP('192.168.6.11', {port: 502});
    await client.setID(1);

    // logger.info('SID', await readRegister(client, 'SID'));
    // logger.info('ChaSt', await readRegister(client, 'ChaSt'));
    // logger.info('ChaState', await readRegister(client, 'ChaState'));

    // logger.info('1_IDStr', await readRegister(client, '1_IDStr'));
    // logger.info('1_DCA', await readRegister(client, '1_DCA'));
    // logger.info('1_DCV', await readRegister(client, '1_DCV'));
    // logger.info('1_DCW', await readRegister(client, '1_DCW'));
    // logger.info('1_DCWH', await readRegister(client, '1_DCWH'));

    // return;

    for(const spec of sunspecMap.values()) {
      if(!spec.name) {
        continue;
      }
      if(spec.type === 'sunssf') {
        continue;
      }

      logger.info(spec.name, await readRegister(client, spec.name));
    }
  } finally {
    await client.close();
  }
})();
