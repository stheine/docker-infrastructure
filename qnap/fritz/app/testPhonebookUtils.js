#!/usr/bin/env node

import Fritzbox           from 'tr-064-async';

import logger             from './logger.js';
import {refresh, resolve} from './phonebookUtils.js';
import tr064Options       from '/var/fritz/tr064Options.js';

(async() => {
  const fritzbox = new Fritzbox.Fritzbox(tr064Options);

  await fritzbox.initTR064Device();

  const phonebook = await refresh({fritzbox, logger});

  // logger.info(phonebook);

  logger.info('resolve', resolve({logger, phonebook, number: '0561823605'}));
  logger.info('resolve', resolve({logger, phonebook, number: '07032201761'}));
  logger.info('resolve', resolve({logger, phonebook, number: '015787566886'}));
  logger.info('resolve', resolve({logger, phonebook, number: '+4915787566886'}));
  logger.info('resolve', resolve({logger, phonebook, number: '070314504900'}));
})();
