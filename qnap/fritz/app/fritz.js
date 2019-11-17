#!/usr/bin/env node

'use strict';

/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */

const _                        = require('lodash');
const {CallMonitor, EventKind} = require('fritz-callmonitor');
const Fritzbox                 = require('tr-064-async');
const millisecond              = require('millisecond');
const mqtt                     = require('async-mqtt');

const logger                   = require('./logger');
const phonebookUtils           = require('./phonebookUtils');
const tr064Options             = require('/var/fritz/tr064Options');

// ###########################################################################
// Globals

let callMonitor;
let mqttClient;
let phonebookInterval;
let stateInterval;

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

process.on('SIGTERM', () => stopProcess());

// ###########################################################################
// Main (async)

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  let phonebook;
  let phonebookRefreshDate;

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Call monitor
  callMonitor = new CallMonitor('fritz.box', 1012);

  callMonitor.on('phone', async data => {
//    logger.info('Incoming callMonitor event, raw', data);

    let callee;
    let calleeName;
    let payload;
    let topic;

    if(data.callee || data.phoneNumber) {
      callee     = (data.callee || data.phoneNumber).replace(/#$/, '').replace(/\s/g, '');
      calleeName = phonebookUtils.resolve({logger, phonebook, number: callee});
    }

    // Gets called on every phone event
    switch(data.kind) {
      case EventKind.Call: // 0
        topic = 'FritzBox/callMonitor/call';
        payload = {
          callee,
          calleeName,
          caller:       data.caller,
          connectionId: data.connectionId,
          extension:    data.extension,
        };
        break;

      case EventKind.Ring: // 1
        topic = 'FritzBox/callMonitor/ring';
        payload = {
          caller:       data.caller,
          callee,
          calleeName,
          connectionId: data.connectionId,
        };
        break;

      case EventKind.PickUp: // 2
        topic = 'FritzBox/callMonitor/ring';
        payload = {
          extension:    data.extension,
          callee,
          calleeName,
          connectionId: data.connectionId,
        };
        break;

      case EventKind.HangUp: // 4
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

  ({phonebook, phonebookRefreshDate} = await phonebookUtils.refresh({fritzbox, logger}));
  phonebookInterval = setInterval(async() => {
    ({phonebook, phonebookRefreshDate} = await phonebookUtils.refresh({fritzbox, logger, phonebookRefreshDate}));
  }, millisecond('1 hour'));

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
