#!/usr/bin/env node

'use strict';

/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */

const _                        = require('lodash');
const {CallMonitor, EventKind} = require('fritz-callmonitor');
const Fritzbox                 = require('tr-064-async');
const millisecond              = require('millisecond');
const moment                   = require('moment');
const mqtt                     = require('async-mqtt');
const request                  = require('request-promise-native');
const xmlJs                    = require('xml-js');

const tr064Options             = require('/var/fritz/tr064Options');

// ###########################################################################
// Globals

let callMonitor;
let mqttClient;
let phonebook;
let phonebookRefreshDate;
let phonebookInterval;
let stateInterval;

// ###########################################################################
// Logging

const logger = {
  /* eslint-disable no-console */
  info(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg);
    }
  },
  warn(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg);
    }
  },
  error(msg, params) {
    if(params) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg, params);
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg);
    }
  },
  /* eslint-enable no-console */
};

// ###########################################################################
// Process handling

const stopProcess = async function() {
  clearInterval(phonebookInterval);
  clearInterval(stateInterval);

  callMonitor.end();
  callMonitor = undefined;

  await mqttClient.end();
  mqttClient = undefined;

  logger.info(`Shutdown -------------------------------------------------`);
};

// ###########################################################################
// Refresh phonebook
const refreshPhonebook = async function(fritzbox) {
  const service = fritzbox.services['urn:dslforum-org:service:X_AVM-DE_OnTel:1'];

  const phonebookList = await service.actions.GetPhonebookList();
  const newPhonebook = {};

  for(const NewPhonebookID of phonebookList.NewPhonebookList.split(',')) {
    const phonebookData = await service.actions.GetPhonebook({NewPhonebookID});
    const {NewPhonebookURL} = phonebookData;

    const phonebookXml = await request(NewPhonebookURL + (phonebookRefreshDate ? phonebookRefreshDate.unix() : ''));

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
          newPhonebook[number._text.replace(/[\s/]/g, '')] = name;
        }
      } else {
        newPhonebook[contact.telephony.number._text.replace(/[\s/]/g, '')] = name;
      }
    }
  }

  if(_.isEmpty(newPhonebook)) {
    return;
  }

  phonebookRefreshDate = moment();

  phonebook = newPhonebook;

  logger.info('Phonebook refreshed');
//  logger.info(phonebook);
};

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Main (async)

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Call monitor
  callMonitor = new CallMonitor('fritz.box', 1012);

  callMonitor.on('phone', async data => {
    logger.info(data);

    let callee;
    let calleeName;
    let payload;
    let topic;

    if(data.callee || data.phoneNumber) {
      callee = (data.callee || data.phoneNumber).replace(/#$/, '').replace(/\s/g, '');

      if(phonebook[callee]) {
        calleeName = phonebook[callee];
      } else {
        const calleeWithoutLeadingZero = callee.replace(/^(?:\+49|0049|0+)/, '');
        const phonebookEntries = _.filter(phonebook, (name, number) => number.endsWith(calleeWithoutLeadingZero));

        if(_.keys(phonebookEntries).length > 1) {
          logger.warn(`Multiple phonebook entries for '${callee}/${calleeWithoutLeadingZero}'`, phonebookEntries);
        }

        if(_.keys(phonebookEntries).length) {
          calleeName = phonebookEntries[_.first(_.keys(phonebookEntries))].name;
        }
      }

      if(calleeName) {
        logger.info(`Mapped '${callee}' to '${calleeName}'`);
      }
    }

    // Gets called on every phone event
    switch(data.kind) {
      case EventKind.Call:
        topic = 'FritzBox/callMonitor/call';
        payload = {
          callee,
          calleeName,
          caller:       data.caller,
          connectionId: data.connectionId,
          extension:    data.extension,
        };
        break;

      case EventKind.Ring:
        topic = 'FritzBox/callMonitor/ring';
        payload = {
          caller:       data.caller,
          callee,
          calleeName,
          connectionId: data.connectionId,
        };
        break;

      case EventKind.PickUp:
        topic = 'FritzBox/callMonitor/ring';
        payload = {
          caller:       data.phoneNumber,
          extension:    data.extension,
          connectionId: data.connectionId,
          callee,
          calleeName,
        };
        break;

      case EventKind.HangUp:
        topic = 'FritzBox/callMonitor/hangUp';
        payload = {
          callDuration: data.callDuration,
          connectionId: data.connectionId,
        };
        break;

      default:
        logger.error(`Unhandled EventKind=${data.kind}`);

        return;
    }

    logger.info('Publish to mqtt', {topic, payload});

    await mqttClient.publish(topic, JSON.stringify(payload));
  });

//  callMonitor.on('close', () => logger.info('Connection closed.'));
//  callMonitor.on('connect', () => logger.info('Connected to device.'));
  callMonitor.on('error', err => logger.error(err));

  callMonitor.connect();

  // #########################################################################
  // FritzBox TR-064 monitor
  const fritzbox = new Fritzbox.Fritzbox(tr064Options);

  await fritzbox.initTR064Device();

  await refreshPhonebook(fritzbox);
  phonebookInterval = setInterval(async() => await refreshPhonebook(fritzbox), millisecond('1 hour'));

  stateInterval = setInterval(async() => {
    let   service;
    let   data;
    const tele = {};

    service = fritzbox.services['urn:dslforum-org:service:DeviceInfo:1'];
    data    = await service.actions.GetInfo();
//    logger.info('DeviceInfo.getInfo', data);
    tele.upTime = data.NewUpTime;

    service = fritzbox.services['urn:dslforum-org:service:WANCommonInterfaceConfig:1'];
    data    = await service.actions.GetCommonLinkProperties();
//    logger.info('WANCommonInterfaceConfig.GetCommonLinkProperties', data);
// ???   tele.upstreamMaxBitRate   = data.NewLayer1UpstreamMaxBitRate;
// ???   tele.downstreamMaxBitRate = data.NewLayer1DownstreamMaxBitRate;
    tele.physicalLinkStatus   = data.NewPhysicalLinkStatus;

//    data = await service.actions.GetTotalBytesReceived());
//    logger.info('WANCommonInterfaceConfig.', data);

    data = await service.actions['X_AVM-DE_GetOnlineMonitor']({NewSyncGroupIndex: 0});
    // Max:
    //   downstream:         Newmax_ds: '28160000',
    //   upstream:           Newmax_us: '1312000',
    // Recent:
    // ! downstream:         Newds_current_bps:    '11733,327046,1384904,...',
    //   downstream_media:   Newmc_current_bps:    '    0,     0,      0,...',
    // ! upstream:           Newus_current_bps:    '12184, 18441,  41371,...',
    //   upstream_realtime:  Newprio_realtime_bps: '10933, 10945,  10933,...',
    //   upstream_high:      Newprio_high_bps:     '    0,  6039,  29313,...',
    //   upstream_normal:    Newprio_default_bps:  ' 1251,  1457,   1125,...',
    //   upstream_low:       Newprio_low_bps:      '    0,     0,      0,...',
//    logger.info('WANCommonInterfaceConfig.X_AVM-DE_GetOnlineMonitor', data);
    tele.downstreamMaxBitRate = data.Newmax_ds;
    tele.upstreamMaxBitRate   = data.Newmax_us;
    tele.downstreamCurrent    = _.max(data.Newds_current_bps.split(','));
    tele.upstreamCurrent      = _.max(data.Newus_current_bps.split(','));

//    service = fritzbox.services['urn:dslforum-org:service:WANIPConnection:1'];
//    data = await service.actions.GetInfo();
//    logger.info('WANIPConnection.GetInfo', data);
//    data = await service.actions.GetStatusInfo();
//    logger.info('WANIPConnection.GetStatusInfo', data);

    service = fritzbox.services['urn:dslforum-org:service:LANEthernetInterfaceConfig:1'];
//    data = await service.actions.GetInfo();
//    logger.info('LANEthernetInterfaceConfig.GetInfo', data);
//    data = await service.actions.GetStatistics();
//    logger.info('LANEthernetInterfaceConfig.GetStatistics', data);

//    logger.info('MQTT publish', tele);

    await mqttClient.publish(`FritzBox/tele/SENSOR`, JSON.stringify(tele));
  }, millisecond('20 seconds'));
})();
