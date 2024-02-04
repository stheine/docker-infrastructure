#!/usr/bin/env node

import fronius from 'fronius';

import logger  from './logger.js';

(async() => {
  // #########################################################################
  // Handle Fronius data
  const froniusClient = new fronius.Client('http://192.168.6.11');

  const powerFlow = await froniusClient.powerFlow({format: 'json'});

  logger.info({powerFlow});
})();
