#!/usr/bin/env node

'use strict';

                                            // DEBUG=* ./mqtt-volumio.js
                                            // https://socket.io/docs/v2/
const io     = require('socket.io-client'); // https://socket.io/docs/v3/migrating-from-2-x-to-3-0/
const mqtt   = require('async-mqtt');

const logger = require('./logger');

// ###########################################################################
// Globals

let mqttClient;
let volumio;

// ###########################################################################
// Process handling

const stopProcess = async function() {
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

(async() => {
  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init connections
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');
  volumio    = io('http://192.168.6.10:3000', {transports: ['websocket']});

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => logger.info('mqtt.close'));
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => logger.info('mqtt.end'));

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

      switch(cmnd) {
        case 'getBrowseSources': // ?
        case 'getQueue':
        case 'next':
        case 'pause':
        case 'play':
        case 'prev':
        case 'stop':
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
                {service: 'mpd', type: 'song',  title: 'track a', artist: 'artist a', album: 'album', icon: 'music', uri: 'uri'},
                {type: 'folder',  title: 'folder a', icon: 'folder-open-o', uri: 'uri'},
                {type: 'folder',  title: 'folder b', albumart: '//ip/image', uri: 'uri2'},
                {type: 'playlist',  title: 'playlist', icon: 'bars', uri: 'uri4'},
              ],
            },
          });
          break;

        default:
          logger.error(`Unhandled cmnd '${cmnd}'`, message);
          break;
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  await mqttClient.subscribe('volumio/cmnd/#');

  // #########################################################################
  // Register Volumio events
  volumio.on('connect_error', xxx => {
    logger.info('Connect error to volumio', xxx);
  });

  volumio.on('connect', () => {
    logger.debug('Connected to volumio');
  });

  volumio.on('disconnect', () => {
    logger.info('Disconnected from volumio');
  });

  volumio.on('pushState', data => {
    mqttClient.publish('volumio/stat/pushState', JSON.stringify(data), {retain: true});

    logger.info('pushState', data);
  });

//  volumio.on('browseLibrary', data => {
//    logger.info('browseLibrary', data);
//  });

  volumio.on('pushBrowseSources', data => {
    logger.info('pushBrowseSources', data);
  });

  volumio.on('pushQueue', data => {
    logger.info('pushQueue', data);
  });
})();



// 3.1.0 only volumio.onAny((event, data) => {
//    logger.info('Unhandled', {event, data});
//  });

