#!/usr/bin/env node

import {logger}         from '@stheine/helpers';

import FroniusClient    from './fronius-client.js';
import getLatestVersion from './getLatestVersion.js';
import sunspec          from './sunspec_map_inverter.js';

(async() => {
  const inverter = new FroniusClient({ip: '192.168.6.11', port: 502, id: 1, sunspec});

  try {
    await inverter.open();

    const currentVersion = await inverter.readRegister('Vr');
    const latestVersion  = await getLatestVersion();

    logger.info({currentVersion, latestVersion});
  } finally {
    await inverter.close();
  }
})();
