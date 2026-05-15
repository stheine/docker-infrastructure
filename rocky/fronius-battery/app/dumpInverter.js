#!/usr/bin/env node

import {logger}      from '@stheine/helpers';

import FroniusClient from './fronius-client.js';
import sunspec       from './sunspec_map_inverter.js';

const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

const displayValues = [
  'InOutWRte_RvrtTms',
  'StorCtl_Mod',
  'ChaGriSet',
  'InWRte',
  'OutWRte',
  'WChaMax',
  'WChaGra',
  'WDisCharGra',
  'WHRtg',
  'ChaSt',
  'WMaxLimPct',
  'WMaxLim_Ena',
  'WMaxLimPct_WinTms',
  'WMaxLimPct_RvrtTms',
  'WMaxLimPct_RmpTms',
];

try {
  await inverter.open();

  for(const spec of sunspec.values()) {
    if(!spec.name) {
      continue;
    }
    if(!displayValues.includes(spec.name)) {
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
