#!/usr/bin/env node

import FroniusClient  from './fronius-client.js';
import logger         from './logger.js';
import sunspec        from './sunspec_map_smart_meter.js';

(async() => {
  const smartMeter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 200, sunspec});

  try {
    await smartMeter.open();

    // logger.info('W', await smartMeter.readRegister('W'));
    // logger.info('TotWhImp', await smartMeter.readRegister('TotWhImp'));
    // logger.info('TotWhExp', await smartMeter.readRegister('TotWhExp'));

    for(const spec of sunspec.values()) {
      if(!spec.name) {
        continue;
      }
      if(spec.type === 'sunssf') {
        continue;
      }

      logger.info(spec.name, await smartMeter.readRegister(spec.name));
    }
  } finally {
    await smartMeter.close();
  }
})();
