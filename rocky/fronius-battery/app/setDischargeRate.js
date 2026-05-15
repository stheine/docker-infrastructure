#!/usr/bin/env node

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

try {
  await inverter.open();

  const rate = 0.6; // 20%
  let   setRate;

//  // Allow GRID(1) charge
//  try {
//    await inverter.writeRegister('ChaGriSet', [0]);
//  } catch(err) {
//    throw new Error(`Failed writing PV only (ChaGriSet): ${err.message}`);
//  }
  // Set charge rate
  try {
    await inverter.writeRegister('StorCtl_Mod', [3]); // Bit0 enable charge control, Bit1 enable discharge control
  } catch(err) {
    throw new Error(`Failed writing battery charge control (StorCtl_Mod): ${err.message}`);
  }
  try {
    await inverter.writeRegister('InOutWRte_RvrtTms', [3900]); // Timeout for (dis)charge rate in seconds
  } catch(err) {
    throw new Error(`Failed writing battery charge rate timeout (InOutWRte_RvrtTms): ${err.message}`);
  }
  try {
    await inverter.writeRegister('InWRte', [0]); // rate% von max Ladeleistung
  } catch(err) {
    throw new Error(`Failed writing battery charge rate ${setRate} (InWRte): ${err.message}`);
  }
  try {
    setRate = rate * 100 * 100;

    await inverter.writeRegister('OutWRte', [setRate]); // rate% von max Ladeleistung
  } catch(err) {
    throw new Error(`Failed writing battery charge rate ${setRate} (OutWRte): ${err.message}`);
  }
  try {
    await inverter.writeRegister('InWRte', [-setRate]); // rate% von max Ladeleistung
  } catch(err) {
    throw new Error(`Failed writing battery charge rate ${setRate} (InWRte): ${err.message}`);
  }
  // Allow PV charging only
  try {
    await inverter.writeRegister('ChaGriSet', [0]);
  } catch(err) {
    throw new Error(`Failed writing PV only (ChaGriSet): ${err.message}`);
  }
} finally {
  await inverter.close();
}

// WChaMax
//   Setpoint for maximum charge.
//   Additional Fronius description:
//   Reference Value for maximum Charge and Discharge.
//   Multiply this value by InWRte to define maximum charging and
//   OutWRte to define maximum discharging.
//   Every rate between this two limits is allowed.
//   The inverter is not fully capable of transferring power as reported by this reference value.
//   Note that InWRte and OutWRte can be negative to define ranges for charging and discharging only
//
// OutWRte
//   Percent of max discharge rate.
//   Additional Fronius description:
//   Defines maximum Discharge rate.
//   If not used than the default is 100 and WChaMax defines max.
//   Discharge rate. See WChaMax for details
//
// InWRte
//   Percent of max charging rate.
//   Additional Fronius description:
//   Defines maximum Charge rate.
//   If not used than the default is 100 and WChaMax defines max.
//   Charge rate. See WChaMax for details


