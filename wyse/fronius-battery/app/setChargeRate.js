#!/usr/bin/env node

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

(async() => {
  const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

  try {
    await inverter.open();

    const rate = 0.2; // 20%
    let   setRate;

    // Set charge rate
    try {
      await inverter.writeRegister('StorCtl_Mod', [1]); // Bit0 enable charge control, Bit1 enable discharge control
    } catch(err) {
      throw new Error(`Failed writing battery charge control: ${err.message}`);
    }
    try {
      await inverter.writeRegister('InOutWRte_RvrtTms', [3900]); // Timeout for (dis)charge rate in seconds
    } catch(err) {
      throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
    }
    try {
      setRate = rate * 100 * 100;

      await inverter.writeRegister('InWRte', [setRate]); // rate% von 5120W => max Ladeleistung
    } catch(err) {
      throw new Error(`Failed writing battery charge rate ${setRate}: ${err.message}`);
    }
  } finally {
    await inverter.close();
  }
})();
