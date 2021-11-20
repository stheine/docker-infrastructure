#!/usr/bin/env node

/* eslint-disable new-cap */
/* eslint-disable no-console */

import Fritzbox     from 'tr-064-async';

import tr064Options from '/var/fritz/tr064Options.js';

(async() => {
  try {
    const fritzbox = new Fritzbox.Fritzbox(tr064Options);

    await fritzbox.initTR064Device();

    console.log('Successfully initialized device');

  //   console.log(fritzbox.services);

    for(const [urn] of Object.entries(fritzbox.services)) {
      switch(urn) {
        case 'urn:dslforum-org:service:DeviceInfo:1':
        case 'urn:dslforum-org:service:WANPPPConnection:1':
        case 'urn:dslforum-org:service:WANCommonInterfaceConfig:1':
        case 'urn:dslforum-org:service:LANEthernetInterfaceConfig:1':
        case 'urn:dslforum-org:service:WANIPConnection:1':
        case 'urn:dslforum-org:service:WANEthernetLinkConfig:1':
        case 'urn:dslforum-org:service:WANDSLLinkConfig:1':
        case 'urn:dslforum-org:service:WANDSLInterfaceConfig:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Speedtest:1':
        case 'urn:dslforum-org:service:LANHostConfigManagement:1':
        case 'urn:dslforum-org:service:DeviceConfig:1':
        case 'urn:dslforum-org:service:Layer3Forwarding:1':
        case 'urn:dslforum-org:service:LANConfigSecurity:1':
        case 'urn:dslforum-org:service:ManagementServer:1':
        case 'urn:dslforum-org:service:Time:1':
        case 'urn:dslforum-org:service:UserInterface:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Dect:1':
        case 'urn:dslforum-org:service:X_AVM-DE_HostFilter:1':
        case 'urn:dslforum-org:service:X_AVM-DE_OnTel:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Storage:1':
        case 'urn:dslforum-org:service:X_AVM-DE_WebDAVClient:1':
        case 'urn:dslforum-org:service:X_AVM-DE_UPnP:1':
        case 'urn:dslforum-org:service:X_AVM-DE_RemoteAccess:1':
        case 'urn:dslforum-org:service:X_AVM-DE_MyFritz:1':
        case 'urn:dslforum-org:service:X_VoIP:1':
        case 'urn:dslforum-org:service:X_AVM-DE_TAM:1':
        case 'urn:dslforum-org:service:X_AVM-DE_AppSetup:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Homeauto:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Homeplug:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Filelinks:1':
        case 'urn:dslforum-org:service:X_AVM-DE_Auth:1':
        case 'urn:dslforum-org:service:WLANConfiguration:1':
        case 'urn:dslforum-org:service:WLANConfiguration:2':
        case 'urn:dslforum-org:service:WLANConfiguration:3':
        case 'urn:dslforum-org:service:Hosts:1':
          break;

        case 'xxx':
          for(const [api, action] of Object.entries(fritzbox.services[urn].actionsInfo)) {
            console.log(`${api}()`, action);
          }
          break;

        default:
          console.error(`Unhandled url='${urn}'`);
          break;
      }
    }

    let service;

    /* eslint-disable max-len */
    // Verbindung:
    //     NewLayer1UpstreamMaxBitRate: '10496000',
    //     NewLayer1DownstreamMaxBitRate: '225280000',

    // Last:
    // x downstream:         Newds_current_bps:    '11733,327046,1384904,1395232,321999,54734,11509,12335,11637,11476,11831,11365,11734,11987,11680,12367,12236,11607,11784,11805',
    //   downstream_media:   Newmc_current_bps:    '    0,    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
    // x upstream:           Newus_current_bps:    '12184,18441,41371,45044,29056,21008,11760,12527,11848,11570,11916,11552,11842,12029,11757,13528,12994,11915,12054,12081',
    //   upstream_realtime:  Newprio_realtime_bps: '10933,10945,10933,12011,18090,15781,10966,11122,10900,10945,10933,10945,11056,11083,10933,10945,10962,10945,10945,11030',
    //   upstream_high:      Newprio_high_bps:     '    0, 6039,29313,29884,7038,944,23,0,0,0,0,0,11,14,0,0,11,0,0,43',
    //   upstream_normal:    Newprio_default_bps:  ' 1251, 1457,1125,3149,3928,4283,771,1405,948,625,983,607,775,932,824,2583,2021,970,1109,1008',
    //   upstream_low:       Newprio_low_bps:      '    0,    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0'
    /* eslint-enable max-len */

    service = fritzbox.services['urn:dslforum-org:service:DeviceInfo:1'];
//    console.log(await service.actions.GetInfo());

    service = fritzbox.services['urn:dslforum-org:service:WANCommonInterfaceConfig:1'];
//    console.log(await service.actions.GetCommonLinkProperties());
//    console.log(await service.actions.GetTotalBytesReceived());
//    console.log(await service.actions.GetTotalBytesSent());
//    console.log(await service.actions.GetAddonInfos());
    console.log(await service.actions['X_AVM-DE_GetOnlineMonitor']({NewSyncGroupIndex: 0}));

    service = fritzbox.services['urn:dslforum-org:service:WANIPConnection:1'];
//    console.log(await service.actions.GetInfo());
//    console.log(await service.actions.GetStatusInfo());

    service = fritzbox.services['urn:dslforum-org:service:LANEthernetInterfaceConfig:1'];
//    console.log(await service.actions.GetInfo());
//    console.log(await service.actions.GetStatistics());

//    for(const serviceName in fritzbox.services) {
//      console.log(`=== ${serviceName} ===`);
//      for(const actionName in fritzbox.services[serviceName].actionsInfo) {
//        console.log(`   # ${actionName}()`);
//        fritzbox.services[serviceName].actionsInfo[actionName].inArgs.forEach(arg => {
//          console.log(`     IN : ${arg}`);
//        });
//        fritzbox.services[serviceName].actionsInfo[actionName].outArgs.forEach(arg => {
//          console.log(`     OUT : ${arg}`);
//        });
//      }
//    }

  //  const wanip = fritzbox.services['urn:dslforum-org:service:WANIPConnection:1'];

  //  const info = await wanip.actions.GetInfo();

  //  console.log(info);
  } catch(err) {
    console.error(err);

    process.exit(1);
  }
})();
