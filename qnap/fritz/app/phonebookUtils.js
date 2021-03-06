#!/usr/bin/env node

'use strict';

/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */

const _       = require('lodash');
const request = require('request-promise-native');
const xmlJs   = require('xml-js');

module.exports = {
  // ###########################################################################
  // Refresh phonebook
  async refresh({fritzbox, logger}) {
    const service = fritzbox.services['urn:dslforum-org:service:X_AVM-DE_OnTel:1'];

    const phonebookList = await service.actions.GetPhonebookList();
    const phonebook     = {};

    for(const NewPhonebookID of phonebookList.NewPhonebookList.split(',')) {
      const phonebookData = await service.actions.GetPhonebook({NewPhonebookID});
      const {NewPhonebookURL} = phonebookData;

      // logger.info(phonebookData);

      const phonebookXml = await request(NewPhonebookURL);
      const phonebookRaw = xmlJs.xml2js(phonebookXml, {compact: true});

      // logger.info(phonebookRaw);

      if(!_.isArray(phonebookRaw.phonebooks.phonebook.contact)) {
        // No entries in phonebook
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
      logger.warn('Phonebook is empty');

      return;
    }

    return phonebook;
  },

  // ###########################################################################
  // Refresh phone number
  resolve({logger, number, phonebook}) {
    const resolveNumber = number.replace(/#$/, '').replace(/\s/g, '');
    let   name;

    if(!resolveNumber) {
      return;
    }

    if(phonebook[resolveNumber]) {
      name = phonebook[resolveNumber];
      // logger.info(`Single match '${number}' to '${name}'`);
    } else {
      const numberWithoutLeadingZero = resolveNumber.replace(/^(?:\+49|0049|0+)/, '');
      const resolvedEntries = _.filter(phonebook, (phonebookName, phonebookNumber) =>
        phonebookNumber.endsWith(numberWithoutLeadingZero));

      if(_.keys(resolvedEntries).length > 1) {
        logger.warn(`Multiple phonebook entries end with '${number}'`, resolvedEntries);
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
