#!/usr/bin/env node

'use strict';

/* eslint-disable new-cap */
/* eslint-disable no-console */

const _                        = require('lodash');
const {CallMonitor, EventKind} = require('fritz-callmonitor');
const Fritzbox                 = require('tr-064-async');
const millisecond              = require('millisecond');
const moment                   = require('moment');
const mqtt                     = require('async-mqtt');

const tr064Options             = require('/var/fritz/tr064Options');

// ###########################################################################
// Globals

let callMonitor;
let interval;
let mqttClient;

// ###########################################################################
// Logging

const logger = {
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
};

// ###########################################################################
// Process handling

const stopProcess = async function() {
  clearInterval(interval);

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

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Call monitor
  callMonitor = new CallMonitor('fritz.box', 1012);

  callMonitor.on('phone', async data => {
    logger.info(data);

    // Gets called on every phone event
    switch(data.kind) {
      case EventKind.Ring:
        await mqttClient.publish(`FritzBox/callMonitor/ring`, JSON.stringify({
          caller:       data.caller,
          callee:       data.callee,
          connectionId: data.connectionId,
        }));
        break;

      case EventKind.PickUp:
        await mqttClient.publish(`FritzBox/callMonitor/ring`, JSON.stringify({
          caller:       data.phoneNumber,
          extension:    data.extension,
          connectionId: data.connectionId,
        }));
        break;

      case EventKind.HangUp:
        await mqttClient.publish(`FritzBox/callMonitor/hangUp`, JSON.stringify({
          callDuration: data.callDuration,
          connectionId: data.connectionId,
        }));
        break;

      case EventKind.Call:
        await mqttClient.publish(`FritzBox/callMonitor/call`, JSON.stringify({
          callee:       data.callee,
          caller:       data.caller,
          connectionId: data.connectionId,
        }));
        break;

      default:
        console.error(`Unhandled EventKind=${data.kind}`);
        break;
    }
  });

//  callMonitor.on('close', () => logger.info('Connection closed.'));
//  callMonitor.on('connect', () => logger.info('Connected to device.'));
  callMonitor.on('error', err => logger.error(err));

  callMonitor.connect();

  // #########################################################################
  // FritzBox TR-064 monitor
  const fritzbox = new Fritzbox.Fritzbox(tr064Options);

  await fritzbox.initTR064Device();

  interval = setInterval(async() => {
    let   service;
    let   data;
    const tele = {};

    service = fritzbox.services['urn:dslforum-org:service:DeviceInfo:1'];
    data    = await service.actions.GetInfo();
//    console.log('DeviceInfo.getInfo', data);
    tele.upTime = data.NewUpTime;

    service = fritzbox.services['urn:dslforum-org:service:WANCommonInterfaceConfig:1'];
    data    = await service.actions.GetCommonLinkProperties();
//    console.log('WANCommonInterfaceConfig.GetCommonLinkProperties', data);
// ???   tele.upstreamMaxBitRate   = data.NewLayer1UpstreamMaxBitRate;
// ???   tele.downstreamMaxBitRate = data.NewLayer1DownstreamMaxBitRate;
    tele.physicalLinkStatus   = data.NewPhysicalLinkStatus;

//    data = await service.actions.GetTotalBytesReceived());
//    console.log('WANCommonInterfaceConfig.', data);

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
//    console.log('WANCommonInterfaceConfig.X_AVM-DE_GetOnlineMonitor', data);
    tele.downstreamMaxBitRate = data.Newmax_ds;
    tele.upstreamMaxBitRate   = data.Newmax_us;
    tele.downstreamCurrent    = _.max(data.Newds_current_bps.split(','));
    tele.upstreamCurrent      = _.max(data.Newus_current_bps.split(','));

//    service = fritzbox.services['urn:dslforum-org:service:WANIPConnection:1'];
//    data = await service.actions.GetInfo();
//    console.log('WANIPConnection.GetInfo', data);
//    data = await service.actions.GetStatusInfo();
//    console.log('WANIPConnection.GetStatusInfo', data);

    service = fritzbox.services['urn:dslforum-org:service:LANEthernetInterfaceConfig:1'];
//    data = await service.actions.GetInfo();
//    console.log('LANEthernetInterfaceConfig.GetInfo', data);
//    data = await service.actions.GetStatistics();
//    console.log('LANEthernetInterfaceConfig.GetStatistics', data);

//    console.log('MQTT publish', tele);

    await mqttClient.publish(`FritzBox/tele/SENSOR`, JSON.stringify(tele));
  }, millisecond('20 seconds'));
})();
