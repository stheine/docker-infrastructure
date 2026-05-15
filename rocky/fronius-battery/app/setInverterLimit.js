#!/usr/bin/env node

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

try {
  await inverter.open();

  const rate = 0.2; // 20%
  let   setRate;

// Defaults:
// WMaxLimPct 100
// WMaxLimPct_WinTms 0
// WMaxLimPct_RvrtTms 0
// WMaxLimPct_RmpTms 0
// WMaxLim_Ena DISABLED

  // Limit Power output
  try {
    await inverter.writeRegister('WMaxLimPct', [10 * 100]);
  } catch(err) {
    throw new Error(`Failed writing PV only (WMaxLimPct): ${err.message}`);
  }
  try {
    await inverter.writeRegister('WMaxLimPct_WinTms', [10]);
  } catch(err) {
    throw new Error(`Failed writing PV only (WMaxLimPct_WinTms): ${err.message}`);
  }
  try {
    await inverter.writeRegister('WMaxLimPct_RvrtTms', [60]);
  } catch(err) {
    throw new Error(`Failed writing PV only (WMaxLimPct_RvrtTms): ${err.message}`);
  }
  try {
    await inverter.writeRegister('WMaxLimPct_RmpTms', [10]);
  } catch(err) {
    throw new Error(`Failed writing PV only (WMaxLimPct_RmpTms): ${err.message}`);
  }
  try {
    await inverter.writeRegister('WMaxLim_Ena', [1]);
  } catch(err) {
    throw new Error(`Failed writing PV only (WMaxLim_Ena): ${err.message}`);
  }
} finally {
  await inverter.close();
}
