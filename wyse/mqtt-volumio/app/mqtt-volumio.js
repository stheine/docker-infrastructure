#!/usr/bin/env node

import os                    from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

                                       // DEBUG=* ./mqtt-volumio.js
                                       // https://socket.io/docs/v2/
import _      from 'lodash';
import io     from 'socket.io-client'; // https://socket.io/docs/v3/migrating-from-2-x-to-3-0/
import mqtt   from 'async-mqtt';
import ms     from 'ms';

import logger from './logger.js';

// ###########################################################################
// Globals

let   healthInterval;
const hostname   = os.hostname();
let   mqttClient;
let   volumio;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  if(volumio) {
    volumio.close();
    volumio = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const getQueue = async function() {
  return new Promise(resolve => {
    volumio.once('pushQueue', queue => resolve(queue));

    volumio.emit('getQueue');
  });
};

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init connections
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});
  volumio    = io('http://192.168.6.12:80', {transports: ['websocket']});

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch {
        // ignore
      }

      if(!topic.startsWith('volumio/cmnd/')) {
        logger.error(`Unhandled topic '${topic}'`, message);

        return;
      }

      const cmnd = topic.replace(/^volumio\/cmnd\//, '');

      // https://volumio.github.io/docs/API/WebSocket_APIs.html
      // seek N (N is the time in seconds that the playback will keep)
      // setRandom({"value":true|false})
      // setRepeat({"value":true|false})
      // getState
      //
      // search {value:'query'}
      //
      // mute
      // unmute
      // removeFromQueue {value: N}
      // addToQueue {uri:'uri'}
      // moveQueue {from:N,to:N2}

      // logger.debug('handle', {topic, cmnd, message});

      switch(cmnd) {
//        case 'playPause': {
//          volumio.once('pushState', async data => {
//            // logger.info('playPause:pushState', data);
//            const {status, trackType} = data;
//            let   newStatus;
//
//            switch(trackType) {
//              case 'webradio':
//                switch(status) {
//                  case 'pause':
//                    volumio.emit('stop');
//
//                    await delay(100);
//
//                    newStatus = 'play';
//                    break;
//
//                  case 'play':
//                    newStatus = 'stop';
//                    break;
//
//                  case 'stop':
//                    newStatus = 'play';
//                    break;
//
//                  default:
//                    logger.error(`Unhandled ${trackType} status='${status}'`);
//                    break;
//                }
//                break;
//
//              case 'mp3':
//              case 'Podcast':
//                switch(status) {
//                  case 'play':
//                    newStatus = 'pause';
//                    break;
//
//                  case 'pause':
//                  case 'stop':
//                    newStatus = 'play';
//                    break;
//
//                  default:
//                    logger.error(`Unhandled ${trackType} status='${status}'`);
//                    break;
//                }
//                break;
//
//              default:
//                logger.error(`Unhandled trackType='${trackType}'`);
//                break;
//            }
//
//            if(newStatus) {
//              logger.info('playPause:toggle', {status, newStatus});
//
//              volumio.emit(newStatus);
//            }
//          });
//
//          volumio.emit('getState');
//          break;
//        }

        case 'getBrowseSources': // ?
        case 'getQueue':
        case 'next':
        case 'pause':
        case 'play':
        case 'prev':
        case 'stop':
        case 'toggle':
          volumio.emit(cmnd);
          break;

        case 'seek':
        case 'volume': // 0-100, "+", "-"
          volumio.emit(cmnd, message);
          break;

        case 'browseLibrary':
          volumio.emit(cmnd, {
            navigation: {
              prev: {
                uri: '',
              },
              list: [
                {
                  service: 'mpd',
                  type: 'song',
                  title: 'track a',
                  artist: 'artist a',
                  album: 'album',
                  icon: 'music',
                  uri: 'uri',
                },
                {type: 'folder',  title: 'folder a', icon: 'folder-open-o', uri: 'uri'},
                {type: 'folder',  title: 'folder b', albumart: '//ip/image', uri: 'uri2'},
                {type: 'playlist',  title: 'playlist', icon: 'bars', uri: 'uri4'},
              ],
            },
          });
          break;

        case 'DLF': {
          let queue = await getQueue();
          let dlfKey = _.findKey(queue, {service: 'webradio', name: 'DLF'});

          if(dlfKey === undefined) {
            volumio.emit('addToQueue', {
              name: 'DLF',
              service: 'webradio',
              uri: 'https://st01.sslstream.dlf.de/dlf/01/high/aac/stream.aac',
            });

            queue = await getQueue();

            dlfKey = _.findKey(queue, {service: 'webradio', name: 'DLF'});
          }

          volumio.emit('play', {value: dlfKey});
          break;
        }

        default:
          logger.error(`Unhandled cmnd '${cmnd}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  await mqttClient.subscribe('volumio/cmnd/#');

  healthInterval = setInterval(async() => {
    await mqttClient.publish(`mqtt-volumio/health/STATE`, 'OK');
  }, ms('1min'));

  // #########################################################################
  // Register Volumio events
  volumio.on('connect_error', xxx => {
    logger.info('Connect error to volumio', xxx);
  });

  volumio.on('connect', () => {
    logger.debug('Connected to volumio');
  });

  volumio.on('disconnect', () => {
    // logger.info('Disconnected from volumio');
  });

  volumio.on('pushState', data => {
    mqttClient.publish('volumio/stat/pushState', JSON.stringify(data), {retain: true});

    // logger.info('pushState', data);
  });

  volumio.on('browseLibrary', data => {
    logger.info('browseLibrary', data);
  });

  volumio.on('pushBrowseFilters', data => {
    logger.info('pushBrowseFilters', data);
  });

  volumio.on('pushBrowseSources', data => {
    logger.info('pushBrowseSources', data);
  });

  volumio.on('pushQueue', data => {
    // logger.info('pushQueue', data);
  });
})();



// 3.1.0 only volumio.onAny((event, data) => {
//    logger.info('Unhandled', {event, data});
//  });
