#!/usr/bin/env node

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

try {
  await inverter.open();

  const rate = -0.5; // 20%
  let   setRate;

  // Set charge rate
  try {
    await inverter.writeRegister('StorCtl_Mod', [0]); // Bit0 enable charge control, Bit1 enable discharge control
  } catch(err) {
    throw new Error(`Failed writing battery charge control: ${err.message}`);
  }
  try {
    await inverter.writeRegister('InOutWRte_RvrtTms', [5]); // Timeout for (dis)charge rate in seconds
  } catch(err) {
    throw new Error(`Failed writing battery charge rate timeout: ${err.message}`);
  }
  try {
    await inverter.writeRegister('ChaGriSet', [0]);
  } catch(err) {
    throw new Error(`Failed writing PV only: ${err.message}`);
  }
  try {
    await inverter.writeRegister('InWRte', [0]);
  } catch(err) {
    throw new Error(`Failed writing InWRte: ${err.message}`);
  }
} finally {
  await inverter.close();
}
