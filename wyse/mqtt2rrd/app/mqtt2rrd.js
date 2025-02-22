#!/usr/bin/env node

/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable unicorn/no-useless-spread */

import fsPromises from 'node:fs/promises';
import os         from 'node:os';

import graphviz   from 'graphviz';
import {logger}   from '@stheine/helpers';
import mqtt       from 'mqtt';
import ms         from 'ms';

import rrdUpdate  from './rrdtool.js';

// ###########################################################################
// Globals

let   healthInterval;
const hostname        = os.hostname();
let   mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.endAsync();
    mqttClient = undefined;
  }

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
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  const update = {};

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      const files    = [];
      let   message;

      try {
        message = JSON.parse(messageRaw);
      } catch{
        // ignore
        // logger.debug('JSON.parse', {messageRaw, errMessage: err.message});
      }

      switch(topic) {
        case 'esp32-wasser/zaehlerstand/json': {
          if(message.value && message.error === 'no error') {
            const file = '/var/wasser/wasser.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                zaehlerstand: message.value,
              },
            };
          // } else {
          //   logger.error('wasser', {topic, message, messageRaw});
          }
          break;
        }

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

        case 'Fronius/solar/tele/SENSOR': {
          const file = '/var/fronius/fronius.rrd';

          const {battery, inverter, meter, solar} = message;
          const updates = {};

          if(battery) {
            if(battery.solarWh) {
              updates.solarWh = battery.solarWh;
            }
            if(battery.storageChargeWh) {
              updates.storageChargeWh = battery.storageChargeWh;
            }
            if(battery.storageDisChargeWh) {
              updates.storageDisChargeWh = battery.storageDisChargeWh;
            }
            if(battery.powerIncoming && battery.powerOutgoing) {
              logger.warn('battery.powerIncoming && powerOutgoing', battery);
            } else {
              updates.battery = battery.powerIncoming || -battery.powerOutgoing;
            }
            if(battery.stateOfCharge < 0 || battery.stateOfCharge > 1) {
              logger.warn('battery.stateOfCharge', battery);
            } else {
              updates.batteryPct = battery.stateOfCharge * 100;
            }
          }
          if(inverter) {
            updates.inverter = inverter.powerOutgoing || -inverter.powerIncoming;
            updates.tmpCab   = inverter.tmpCab;
          }
          if(meter) {
            if(meter.powerIncoming && meter.powerOutgoing) {
              logger.warn('meter.powerIncoming && powerOutgoing', meter);
            } else {
              updates.meter = meter.powerIncoming || -meter.powerOutgoing;
            }
          }
          if(solar) {
            if(solar.powerOutgoing < 0 || solar.powerOutgoing > 10000) {
              logger.warn(`UngültigeSolarDachLeistung ${solar.powerOutgoing}`, message);
            } else {
              updates.solar = solar.powerOutgoing;
            }
          }

          files.push(file);
          update[file] = {
            ...update[file],
            ...updates,
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

        case 'JalousieBackend/tele/SENSOR': {
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
          const set  = {};

          if(message.momentanLeistung) {
            set.momentanLeistung = message.momentanLeistung;
          }
          if(message.gesamtEinspeisung) {
            set.gesamtEinspeisung = message.gesamtEinspeisung;
          }
          if(message.verbrauchHaus) {
            set.verbrauchHaus = message.verbrauchHaus;
          }

          files.push(file);
          update[file] = {
            ...update[file],
            ...set,
          };
          break;
        }

        case 'tasmota/espstrom/tele/SENSOR': {
          // logger.info(topic, message);
          if(message.SML.Verbrauch < 0 || message.SML.Verbrauch > 50000) {
            logger.warn(`Ungültiger Zählerverbrauch ${message.SML.Verbrauch}`, message);
          } else if(message.SML.Leistung < -10000 || message.SML.Leistung > 14000) {
            logger.warn(`Ungültige Zählerleistung ${message.SML.Leistung}`, message);
          } else {
            const file = '/var/strom/strom.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                zaehlerEinspeisung: message.SML.Einspeisung,
                zaehlerVerbrauch:   message.SML.Verbrauch,
                zaehlerLeistung:    message.SML.Leistung,
              },
            };
          }
          break;
        }

        case 'tasmota/espco2/tele/SENSOR': {
          // logger.info(topic, message);
          if(message.MHZ19B.CarbonDioxide) {
            const file = '/var/jalousie/co2.rrd';

            files.push(file);
            if(message.DHT11) {
              update[file] = {
                ...update[file],
                ...{
                  co2:      message.MHZ19B.CarbonDioxide,
                  temp:     message.DHT11.Temperature,
                  humidity: message.DHT11.Humidity,
                },
              };
            } else if(message.AM2301) {
              update[file] = {
                ...update[file],
                ...{
                  co2:      message.MHZ19B.CarbonDioxide,
                  temp:     message.AM2301.Temperature,
                  humidity: message.AM2301.Humidity,
                },
              };
            }
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

        case 'tasmota/heizstab/tele/SENSOR': {
          const file = '/var/vito/heizstab.rrd';

          const updates = {
            heizstabPower:  message.ENERGY.Power,
            heizstabToday:  message.ENERGY.Today,
          };

          files.push(file);
          update[file] = {
            ...update[file],
            ...updates,
          };
          break;
        }

        case 'tasmota/heizstab/tele/STATE': {
          const file = '/var/vito/heizstab.rrd';

          const updates = {
            heizstabSwitch: message.POWER === 'ON' ? 1 : 0,
          };

          files.push(file);
          update[file] = {
            ...update[file],
            ...updates,
          };
          break;
        }

        case 'vito/tele/SENSOR': {
          let file;

          file = '/var/vito/vito.rrd';
          files.push(file);
          update[file] = {
            ...update[file],
            ...{
              tempAussen:          message.tempAussen,
              tempKessel:          message.tempKessel,
              tempPufferOben:      message.tempPufferOben,
              tempPufferUnten:     message.tempPufferUnten,
              tempWarmwasser:      message.tempWarmwasser,
              tempFlamme:          message.tempFlamme,
              brennerStarts:       message.brennerStarts,
              brennerStunden:      message.brennerStunden,
              brennerVerbrauch:    message.brennerVerbrauch,
              kesselLeistung:      message.kesselLeistung,
              lambda:              message.lambdaO2,
              heizkreisPumpe:      message.heizkreisPumpe,
              zirkulationsPumpe:   message.zirkulationsPumpe,
              speicherladePumpe:   message.speicherladePumpe,
              primaerluftklappe:   message.primaerluftklappe,
              sekundaerluftklappe: message.sekundaerluftklappe,
              drehzahl:            message.drehzahlIst,
              betriebsart:         message.hk1Betriebsart,
              betriebsartSpar:     message.hk1BetriebsartSpar,
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
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/chargingStatus/chargePower_kW': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                chargePowerKw: message,
              },
            };
          }
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/batteryStatus/cruisingRangeElectric_km': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                cruisingRangeKm: message,
              },
            };
          }
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/batteryStatus/currentSOC_pct': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                batterySoc: message,
              },
            };
          }
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMax_K': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                tempBatteryMaxK: message,
              },
            };
          }
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMin_K': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                tempBatteryMinK: message,
              },
            };
          }
          break;
        }

        case 'vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/odometerStatus/odometer': {
          // logger.info(topic, message);
          if(message) {
            const file = '/var/auto/auto.rrd';

            files.push(file);
            update[file] = {
              ...update[file],
              ...{
                odometer: message,
              },
            };
          }
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
          if(message.humidity && message.temperature) {
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
          }
          break;
        }

        case 'Zigbee/bridge/response/networkmap': {
          // Trigger by mosquitto_pub -h 192.168.6.5 -t Zigbee/bridge/request/networkmap -m graphviz
          await new Promise(resolve => {
            graphviz.parse(message?.data?.value, graph => {
              graph.render('png', async render => {
                await fsPromises.writeFile('/var/www/zigbee/map.png', render);

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

        await rrdUpdate(file, update[file]);
      }
    } catch(err) {
      logger.error(`Failed mqtt handling for '${topic}': ${messageRaw}`, err);
    }
  });

  await mqttClient.subscribeAsync('esp32-wasser/zaehlerstand/json');
  await mqttClient.subscribeAsync('FritzBox/tele/SENSOR');
  await mqttClient.subscribeAsync('FritzBox/speedtest/result');
  await mqttClient.subscribeAsync('Fronius/solar/tele/SENSOR');
  await mqttClient.subscribeAsync('JalousieBackend/tele/SENSOR');
  await mqttClient.subscribeAsync('Regen/tele/SENSOR');
  await mqttClient.subscribeAsync('Sonne/tele/SENSOR');
  await mqttClient.subscribeAsync('strom/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/espstrom/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/espco2/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/espco2klein/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/espfeinstaub/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/heizstab/tele/SENSOR');
  await mqttClient.subscribeAsync('tasmota/heizstab/tele/STATE');
  await mqttClient.subscribeAsync('vito/tele/SENSOR');
  await mqttClient.subscribeAsync('Wind/tele/SENSOR');
  await mqttClient.subscribeAsync('Wohnzimmer/tele/SENSOR');
  await mqttClient.subscribeAsync('Zigbee/bridge/response/networkmap');
  await mqttClient.subscribeAsync('Zigbee/LuftSensor Büro');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/chargingStatus/chargePower_kW');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/batteryStatus/cruisingRangeElectric_km');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/charging/batteryStatus/currentSOC_pct');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMax_K');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/temperatureBatteryStatus/temperatureHvBatteryMin_K');
  await mqttClient.subscribeAsync('vwsfriend/vehicles/WVWZZZE1ZPP505932/domains/measurements/odometerStatus/odometer');

  healthInterval = setInterval(async() => {
    await mqttClient.publishAsync(`mqtt2rrd/health/STATE`, 'OK');
  }, ms('1min'));

  await mqttClient.publishAsync(`mqtt2rrd/health/STATE`, 'OK');
})();
