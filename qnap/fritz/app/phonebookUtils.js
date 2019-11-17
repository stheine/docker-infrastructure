#!/usr/bin/env node

'use strict';

/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */

const _       = require('lodash');
const moment  = require('moment');
const request = require('request-promise-native');
const xmlJs   = require('xml-js');

// ###########################################################################
// Refresh phonebook
module.exports = {
  async refresh({fritzbox, logger, modifiedSince}) {
    const service = fritzbox.services['urn:dslforum-org:service:X_AVM-DE_OnTel:1'];

    const phonebookList = await service.actions.GetPhonebookList();
    const phonebook = {};

    for(const NewPhonebookID of phonebookList.NewPhonebookList.split(',')) {
      const phonebookData = await service.actions.GetPhonebook({NewPhonebookID});
      const {NewPhonebookURL} = phonebookData;

      const phonebookXml = await request(NewPhonebookURL + (modifiedSince ? modifiedSince.unix() : ''));

      const phonebookRaw = xmlJs.xml2js(phonebookXml, {compact: true});

      if(phonebookRaw.phonebooks.phonebook._comment === ' not modified ') {
        // Not modified
        continue;
      }

      if(!_.isArray(phonebookRaw.phonebooks.phonebook.contact)) {
        // No enties in phonebook
        continue;
      }

      for(const contact of phonebookRaw.phonebooks.phonebook.contact) {
        const name = contact.person.realName._text;

        if(_.isArray(contact.telephony.number)) {
          for(const number of contact.telephony.number) {
            phonebook[number._text.replace(/[\s/]/g, '')] = name;
          }
        } else {
          phonebook[contact.telephony.number._text.replace(/[\s/]/g, '')] = name;
        }
      }
    }

    if(_.isEmpty(phonebook)) {
      return;
    }

    logger.info('Phonebook refreshed');
  //  logger.info(phonebook);

    return {phonebookRefreshDate: moment(), phonebook};
  },

  resolve({logger, number, phonebook}) {
    let name;

    if(phonebook[number]) {
      name = phonebook[number];
      // logger.info(`Single match '${number}' to '${name}'`);
    } else {
      const numberWithoutLeadingZero = number.replace(/^(?:\+49|0049|0+)/, '');
      const resolvedEntries = _.filter(phonebook, (phonebookName, phonebookNumber) =>
        phonebookNumber.endsWith(numberWithoutLeadingZero));

      if(_.keys(resolvedEntries).length > 1) {
        logger.warn(`Multiple phonebook entries for '${number}/${numberWithoutLeadingZero}'`, resolvedEntries);
      }

      if(_.keys(resolvedEntries).length) {
        name = _.first(resolvedEntries);
      }
    }

    if(name) {
      logger.info(`Resolved '${number}' to '${name}'`);
    }

    return name;
  },
};
