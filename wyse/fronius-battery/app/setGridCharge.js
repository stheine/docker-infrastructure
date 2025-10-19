#!/usr/bin/env node

import {setTimeout as delay} from 'node:timers/promises';

import ms            from 'ms';

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

(async() => {
  const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

  try {
    await inverter.open();

    const chargePct = 80; // 80 => 80% of battery capacity => 8kW => max

    // Max load rate
    try {
      // Allow 100% of max Charge rate. * 100 => Scaling Factor
      await inverter.writeRegister('InWRte', [100 * 100]);
    } catch(err) {
      throw new Error(`Failed writing max battery charge rate: ${err.message}`);
    }

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

    // Set load
    try {
      // % of max Charge. * 100 => Scaling Factor
      await inverter.writeRegister('OutWRte', [-chargePct * 100]);
    } catch(err) {
      throw new Error(`Failed writing battery discharge rate: ${err.message}`);
    }
  } finally {
    await inverter.close();
  }
})();
