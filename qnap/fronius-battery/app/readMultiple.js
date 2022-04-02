#!/usr/bin/env node

import FroniusClient  from './fronius-client.js';
import logger         from './logger.js';
import sunspec        from './sunspec_map_inverter.js';

(async() => {
  const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

  try {
    await inverter.open();

    // const result = await inverter.readRegister('Hz');
    // const result = await inverter.readRegisters(['Hz']);
    // const result = await inverter.readRegisters(['Mn', 'Md', 'Vr', 'SN']);
    // const result = await inverter.readRegisters(['ChaState', '1_DCW', '2_DCW', '3_DCWH', '4_DCWH']);
    // const result = await inverter.readRegisters(['StVnd', 'VA']);
    const result = await inverter.readRegisters(['ChaSt', 'ChaState', 'StorCtl_Mod', 'InOutWRte_RvrtTms', 'InWRte']);

    logger.info(result);
  } finally {
    await inverter.close();
  }
})();
