#!/usr/bin/env node

import {logger}      from '@stheine/helpers';

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

try {
  await inverter.open();

  for(const spec of sunspec.values()) {
    if(!spec.name) {
      continue;
    }
    if(![
      'ChaGriSet',
      'ChaSt',
//      'ChaState',
      'InOutWRte_RvrtTms',
      'InWRte',
      'OutWRte',
      'StorCtl_Mod',
//      'WChaMax',
//      'WChaGra',
//      'WDisCharGra',
//      'WHRtg',
    ].includes(spec.name)) {
      continue;
    }
    if(spec.type === 'sunssf') {
      continue;
    }

    const value = await inverter.readRegister(spec.name);

    switch(spec.name) {
      case 'ChaGriSet':
        logger.info(spec.name, `${value}   PV(0): PV charge only, GRID(1): allow grid charge`);
        break;

      case 'InOutWRte_RvrtTms':
        logger.info(spec.name, `${value}s timeout`);
        break;

      case 'InWRte':
        logger.info(spec.name, `${value}% chargeRate of Max`);
        break;

      case 'OutWRte':
        logger.info(spec.name, `${value}% dischargeRate of Max`);
        break;

      case 'StorCtl_Mod':
        logger.info(spec.name, `${value}   1: chargeControl, 3: dischargeControl, 0: auto`);
        break;

      default:
        logger.info(spec.name, `${value}`);
        break;
    }
  }
} finally {
  await inverter.close();
}
