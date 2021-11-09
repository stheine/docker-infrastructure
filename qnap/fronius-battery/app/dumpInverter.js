#!/usr/bin/env node

'use strict';

const FroniusClient  = require('./fronius-client');
const logger         = require('./logger.js');
const sunspec        = require('./sunspec_map_inverter.js');

(async() => {
  const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

  try {
    await inverter.open();

    for(const spec of sunspec.values()) {
      if(!spec.name) {
        continue;
      }
      if(spec.type === 'sunssf') {
        continue;
      }

      logger.info(spec.name, await inverter.readRegister(spec.name));
    }
  } finally {
    await inverter.close();
  }
})();