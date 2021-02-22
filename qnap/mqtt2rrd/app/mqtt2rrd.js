#!/usr/bin/env node

'use strict';

/* eslint-disable no-console */

const fsExtra  = require('fs-extra');
const graphviz = require('graphviz');
const mqtt     = require('async-mqtt');

const logger   = require('./logger');
const rrdtool  = require('./rrdtool');

// ###########################################################################
// Globals

let mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
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
  // Handle shutdown
  process.on('SIGTERM', async() => {
    await stopProcess();
  });

  // #########################################################################
  // Init MQTT connection
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  const update = {};

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      const files    = [];
      let   message;

      try {
        message = JSON.parse(messageRaw);
      } catch(err) {
        // ignore
        // logger.debug('JSON.parse', {messageRaw, errMessage: err.message});
      }

      switch(topic) {
        case 'FritzBox/tele/SENSOR': {
          const file = '/var/fritz/fritz.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              upTime:            message.upTime,
              downstreamMax:     message.downstreamMaxBitRate,
              upstreamMax:       message.upstreamMaxBitRate,
              downstreamCurrent: message.downstreamCurrent,
              upstreamCurrent:   message.upstreamCurrent,
            },
          };
          break;
        }

        case 'FritzBox/speedtest/result': {
          const file = '/var/fritz/speedtest.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              upstreamTest:   Math.trunc(message.upload),
              downstreamTest: Math.trunc(message.download),
            },
          };
          break;
        }

        case 'Jalousie/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/jalousie/jalousie.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...message,
          };
          break;
        }

        case 'Regen/tele/SENSOR': {
          // logger.info(topic, message);
          if(message.level) {
            const file = '/var/jalousie/jalousie.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                rain: message.level,
              },
            };
          }
          break;
        }

        case 'Sonne/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/jalousie/jalousie.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              sunThreshold: message.level,
            },
          };
          break;
        }

        case 'strom/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/strom/strom.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              momentanLeistung:  message.momentanLeistung,
              gesamtEinspeisung: message.gesamtEinspeisung,
            },
          };
          break;
        }

        case 'tasmota/espstrom/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/strom/strom.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              gesamtLeistung:  message['SML  '].Total_in,
              zaehlerLeistung: message['SML  '].Power_curr,
            },
          };
          break;
        }

        case 'tasmota/espco2/tele/SENSOR': {
          // logger.info(topic, message);
          if(message.MHZ19B.CarbonDioxide) {
            const file = '/var/jalousie/co2.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                co2:      message.MHZ19B.CarbonDioxide,
                temp:     message.DHT11.Temperature,
                humidity: message.DHT11.Humidity,
              },
            };
          }
          break;
        }

        case 'tasmota/espfeinstaub/tele/SENSOR': {
          // logger.info(topic, message);
          if(message.SDS0X1 && message.SDS0X1['PM2.5'] && message.SDS0X1.PM10) {
            const file = '/var/jalousie/co2.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                feinstaub2_5: message.SDS0X1['PM2.5'],
                feinstaub10:  message.SDS0X1.PM10,
              },
            };
          }
          if(message.MHZ19B && message.MHZ19B.CarbonDioxide) {
            const file = '/var/jalousie/co2klein.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                co2: message.MHZ19B.CarbonDioxide,
                temp: message.MHZ19B.Temperature,
              },
            };
          }
          break;
        }

        case 'tasmota/solar/tele/SENSOR': {
          const file = '/var/strom/solar.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              power:             message.ENERGY.Power,
              total:             message.ENERGY.Total,
            },
          };
          break;
        }

        case 'Vito/tele/SENSOR': {
          let file;

          file = '/var/vito/vito.rrd';
          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              tempAussen:        message.tempAussen,
              tempKessel:        message.tempKessel,
              tempPufferOben:    message.tempPufferOben,
              tempPufferUnten:   message.tempPufferUnten,
              tempWarmwasser:    message.tempWarmwasser,
              tempFlamme:        message.tempFlamme,
              brennerStarts:     message.brennerStarts,
              brennerStunden:    message.brennerStunden,
              brennerVerbrauch:  message.brennerVerbrauch,
              kesselLeistung:    message.kesselLeistung,
              lambda:            message.lambda,
              statusZirkulation: message.statusZirkulation,
            },
          };

          file = '/var/vito/vito2d.rrd';
          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              tempAussen:        message.tempAussen,
              tempKessel:        message.tempKessel,
              tempPufferOben:    message.tempPufferOben,
              tempPufferUnten:   message.tempPufferUnten,
              tempWarmwasser:    message.tempWarmwasser,
              tempFlamme:        message.tempFlamme,
              brennerStarts:     message.brennerStarts,
              brennerStunden:    message.brennerStunden,
              brennerVerbrauch:  message.brennerVerbrauch,
              kesselLeistung:    message.kesselLeistung,
              lambda:            message.lambda,
              statusZirkulation: message.statusZirkulation,
            },
          };

          file = '/var/jalousie/jalousie.rrd';
          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              temperatureOutside: message.tempAussen,
            },
          };
          await fsExtra.writeFile('/var/vito/_brennerVerbrauch.dat', message.brennerVerbrauch);
          break;
        }

        case 'Wind/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/jalousie/jalousie.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              windThreshold: message.level,
            },
          };
          break;
        }

        case 'Wohnzimmer/tele/SENSOR': {
          // logger.info(topic, message);
          const file = '/var/jalousie/jalousie.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              humidity:       message.humidity,
              temperatureDht: message.temperature,
            },
          };
          break;
        }

        case 'Zigbee/LuftSensor Büro': {
          // logger.info(topic, message);
          const file = '/var/jalousie/jalousie.rrd';

          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              bueroHumidity:    message.humidity,
              bueroTemperature: message.temperature,
            },
          };
          break;
        }

        case 'Zigbee/bridge/networkmap/graphviz': {
          // Trigger by mosquitto_pub -h 192.168.6.7 -t Zigbee/bridge/networkmap -m graphviz
          await new Promise(resolve => {
            graphviz.parse(messageRaw, graph => {
              graph.render('png', async render => {
                await fsExtra.writeFile('/var/www/zigbee/map.png', render);

                logger.info('Updated map at https://heine7.de/zigbee/map.png');

                resolve();
              });
            });
          });
          break;
        }

        default:
          logger.error(`Unhandled topic '${topic}'`, message);
          break;
      }

      for(const file of files) {
        // logger.info(file, update[file]);

        await rrdtool.update(file, update[file]);
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  await mqttClient.subscribe('FritzBox/tele/SENSOR');
  await mqttClient.subscribe('FritzBox/speedtest/result');
  await mqttClient.subscribe('Jalousie/tele/SENSOR');
  await mqttClient.subscribe('Regen/tele/SENSOR');
  await mqttClient.subscribe('Sonne/tele/SENSOR');
  await mqttClient.subscribe('strom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espstrom/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espco2/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espco2klein/tele/SENSOR');
  await mqttClient.subscribe('tasmota/espfeinstaub/tele/SENSOR');
  await mqttClient.subscribe('tasmota/solar/tele/SENSOR');
  await mqttClient.subscribe('Vito/tele/SENSOR');
  await mqttClient.subscribe('Wind/tele/SENSOR');
  await mqttClient.subscribe('Wohnzimmer/tele/SENSOR');
  await mqttClient.subscribe('Zigbee/bridge/networkmap/graphviz');
  await mqttClient.subscribe('Zigbee/LuftSensor Büro');
})();
