#!/usr/bin/env node

import {logger}   from '@stheine/helpers';

import configFile from './configFile.js';
import notify     from './notify.js';

(async() => {
  const config = await configFile.read();

  await notify({config,
    data: {
      message: 'this is a message',
      title:   'title',
      ttl:     60,
    }});

  logger.info('OK');
})();
