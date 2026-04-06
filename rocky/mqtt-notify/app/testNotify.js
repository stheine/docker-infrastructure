#!/usr/bin/env node

import {logger}   from '@stheine/helpers';

import configFile from './configFile.js';
import notify     from './notify.js';

(async() => {
  const config = await configFile.read();

  await notify({config,
    data: {
      priority: -1,
      message:  'this is a message',
      sound:    'none',
      title:    'title',
      ttl:      60,
    }});

  logger.info('OK');
})();
