#!/usr/bin/env node

/* eslint-disable new-cap */

import _                        from 'lodash';
import {CallMonitor, EventKind} from 'fritz-callmonitor';
import {execa}                  from 'execa';
import Fritzbox                 from 'tr-064-async';
import mqtt                     from 'async-mqtt';
import ms                       from 'ms';

import logger                   from './logger.js';
import {refresh, resolve}       from './phonebookUtils.js';
import tr064Options             from '/var/fritz/tr064Options.js';

// ###########################################################################
// Globals

let callMonitor;
let mqttClient;
let phonebookInterval;
let stateInterval;
let speedtestInterval;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  clearInterval(phonebookInterval);
  clearInterval(stateInterval);
  clearInterval(speedtestInterval);

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

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Call monitor
  callMonitor = new CallMonitor('fritz.box', 1012);

  callMonitor.on('phone', async data => {
//    logger.info('Incoming callMonitor event, raw', data);

    let payload;
    let topic;

    // Gets called on every phone event
    switch(data.kind) {
      case EventKind.Call: { // 0
        const {callee, caller, connectionId, extension} = data;
        const calleeName = resolve({logger, phonebook, number: callee});

        logger.info(`call${calleeName ? ` '${calleeName}'` : ''} (${callee})`);

        topic = 'FritzBox/callMonitor/call';
        payload = {
          callee,
          calleeName,
          caller,
          connectionId,
          extension,
        };
        break;
      }

      case EventKind.Ring: { // 1
        const {callee, caller, connectionId} = data;
        const callerName = resolve({logger, phonebook, number: caller});

        logger.info(`ring ${callerName} (${caller})`);

        topic = 'FritzBox/callMonitor/ring';
        payload = {
          callee,
          callerName,
          caller,
          connectionId,
        };

        if(mqttClient) {
          await mqttClient.publish('control-ui/cmnd/dialog', JSON.stringify({
            header: 'Telefon',
            data:   [callerName || caller],
          }));
        }
        break;
      }

      case EventKind.PickUp: { // 2
        const {phoneNumber: callee, connectionId, extension} = data;
        const calleeName = resolve({logger, phonebook, number: callee});

        logger.info(`pickUp${calleeName ? ` '${calleeName}'` : ''} (${callee})`);

        topic = 'FritzBox/callMonitor/pickUp';
        payload = {
          callee,
          calleeName,
          connectionId,
          extension,
        };
        break;
      }

      case EventKind.HangUp: { // 4
        const {callDuration, connectionId} = data;

        logger.info(`hangUp ${callDuration}s`);

        topic = 'FritzBox/callMonitor/hangUp';
        payload = {
          callDuration,
          connectionId,
        };
        break;
      }

      default:
        logger.error(`Unhandled EventKind=${data.kind}`);

        return;
    }

    // logger.info('Publish to mqtt', {topic, payload});

    if(mqttClient) {
      await mqttClient.publish(topic, JSON.stringify(payload));
    }
  });

  callMonitor.on('close', () => logger.info('Connection closed.'));
  callMonitor.on('connect', () => logger.info('Connected to device.'));
  callMonitor.on('error', err => logger.error(err));

  callMonitor.connect();

  // #########################################################################
  // FritzBox TR-064 monitor
  const fritzbox = new Fritzbox.Fritzbox(tr064Options);

  await fritzbox.initTR064Device();

  phonebook = await refresh({fritzbox, logger});
  phonebookInterval = setInterval(async() => {
    const refreshResult = await refresh({fritzbox, logger});

    if(refreshResult) {
      phonebook = refreshResult;
    }
  }, ms('1 hour'));

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

//    data = await service.actions.GetTotalBytesReceived();
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

    if(mqttClient) {
      await mqttClient.publish(`FritzBox/tele/SENSOR`, JSON.stringify(tele));
    }
  }, ms('20 seconds'));

  // #########################################################################
  // Speedtest
  const speedtest = async function() {
    let download;
    let upload;
    let retries = 3;
    let stdout;

    do {
      try {
        ({stdout} = await execa('/usr/local/bin/SpeedTest', [
          '--test-server',
          'voiptest.starface.de:8080',
          '--output',
          'json',
        ]));

        // logger.debug(stdout);
        const results = JSON.parse(stdout);

        ({download, upload} = results);

        logger.info('speedtest', {
          download: _.round(download / 1024 / 1024),
          upload:   _.round(upload   / 1024 / 1024),
        });
      } catch(err) {
        logger.error(err.message);
      }

      retries--;
    } while(retries && (!download || !upload));

    if(mqttClient) {
      await mqttClient.publish(`FritzBox/speedtest/result`, stdout);
    }
  };

  speedtestInterval = setInterval(speedtest, ms('6 hours'));

  speedtest();
})();
