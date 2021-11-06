#!/usr/bin/env node

'use strict';

const Fritzbox       = require('tr-064-async');

const logger         = require('./logger');
const phonebookUtils = require('./phonebookUtils');
const tr064Options   = require('/var/fritz/tr064Options');

(async() => {
  const fritzbox = new Fritzbox.Fritzbox(tr064Options);

  await fritzbox.initTR064Device();

  const phonebook = await phonebookUtils.refresh({fritzbox, logger});

  // logger.info(phonebook);

  logger.info('resolve', phonebookUtils.resolve({logger, phonebook, number: '0561823605'}));
  logger.info('resolve', phonebookUtils.resolve({logger, phonebook, number: '07032201761'}));
  logger.info('resolve', phonebookUtils.resolve({logger, phonebook, number: '015787566886'}));
  logger.info('resolve', phonebookUtils.resolve({logger, phonebook, number: '+4915787566886'}));
  logger.info('resolve', phonebookUtils.resolve({logger, phonebook, number: '070314504900'}));
})();
