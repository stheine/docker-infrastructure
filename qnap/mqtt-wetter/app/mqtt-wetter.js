#!/usr/bin/env node

import _          from 'lodash';
import mqtt       from 'async-mqtt';
import ms         from 'ms';

import configFile from './configFile.js';
import logger     from './logger.js';
import {
  getSunTimes,
  getWeather,
} from './wetter.js';

// ###########################################################################
// Globals

let config;
let mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const handleWeather = async function() {
  const {eveningStartsHour, morningEndsHour, openWeatherLocation, suncalcLocation} = config;

  // Timestamp calculation, local time to UTC
  const date = new Date();

  date.setHours(eveningStartsHour);

  const eveningStartsUTCHour = date.getUTCHours();

  date.setHours(morningEndsHour);

  const morningEndsUTCHour = date.getUTCHours();

  logger.debug('Timestamps', {
    local: {eveningStartsHour, morningEndsHour},
    utc: {eveningStartsUTCHour, morningEndsUTCHour},
  });

  // Get weather data
  const weather = await getWeather({openWeatherLocation, suncalcLocation});

  // hourly ---------
  //   clouds: 0
  //   dew_point: -0.53
  //   dt: 1676397600
  //   feels_like: 3.4
  //   humidity: 75
  //   pop: 0
  //   pressure: 1033
  //   temp: 3.4
  //   uvi: 0
  //   visibility: 10000
  //   weather: Array [ {
  //     description: "Klarer Himmel"
  //     icon: "01n"
  //     id: 800
  //     main: "Clear"
  //   } ]
  //   wind_deg: 158
  //   wind_gust: 1.05
  //   wind_speed: 1.01

  // Aggregate weather forecast data
  const nextEvening = new Date();
  const nextMorning = new Date();

  if(nextEvening.getUTCHours() > eveningStartsUTCHour) {
    // after evening starts, before midnight. next evening is tomorrow.
    nextEvening.setUTCDate(nextEvening.getUTCDate() + 1);
  }
  nextEvening.setUTCHours(eveningStartsUTCHour);
  nextEvening.setUTCMinutes(0);

  if(nextMorning.getUTCHours() > morningEndsUTCHour) {
    // after morning ends. next morning is tomorrow.
    nextMorning.setUTCDate(nextMorning.getUTCDate() + 1);
  }
  nextMorning.setUTCHours(morningEndsUTCHour);
  nextMorning.setUTCMinutes(0);

  logger.debug({nextMorning, nextEvening});

  let dayHourly;
  let nightHourly;

  if(nextEvening < nextMorning) {
    // Day. rest of today and coming night.
    dayHourly   = weather.hourly.filter(set => set.dt * 1000 < nextEvening);
    nightHourly = weather.hourly.filter(set => set.dt * 1000 >= nextEvening && set.dt * 1000 < nextMorning);
  } else {
    // nextEvening > nextMorning
    // Night. rest of night and coming day.

// TODO ????
//    const tomorrowEvening = new Date(nextEvening);
//
//    if(tomorrowEvening.getUTCHours() > morningEndsUTCHour) {
//      // night. evening. coming day is tomorrow.
//      tomorrowEvening.setUTCDate(tomorrowEvening.getUTCDate() + 1);
//    }
//    tomorrowEvening.setUTCHours(eveningStartsUTCHour);
//    tomorrowEvening.setUTCMinutes(0);
//    dayHourly   = weather.hourly.filter(set => set.dt * 1000 >= nextMorning && set.dt * 1000 < tomorrowEvening);

    dayHourly   = weather.hourly.filter(set => set.dt * 1000 >= nextMorning && set.dt * 1000 < nextEvening);
    nightHourly = weather.hourly.filter(set => set.dt * 1000 < nextMorning);
  }

  const dayMaxTemp   = Math.max(...dayHourly.map(set => set.temp));
  const dayMinTemp   = Math.min(...dayHourly.map(set => set.temp));
  const dayMaxWind   = Math.max(...dayHourly.map(set => set.wind_speed));
  const nightMaxTemp = Math.max(...nightHourly.map(set => set.temp));
  const nightMinTemp = Math.min(...nightHourly.map(set => set.temp));
  const nightMaxWind = Math.max(...nightHourly.map(set => set.wind_speed));

  // console.log(Night.map(set => new Date(set.dt * 1000).toISOString()));
  // console.log({DayMaxWind, DayMinTemp, DayMaxTemp, NightMaxWind, NightMinTemp, NightMaxTemp});

  logger.debug('Day', {
    first: new Date(dayHourly.at(0).dt  * 1000).toISOString(),
    last:  new Date(dayHourly.at(-1).dt * 1000).toISOString(),
    temp:  _.map(dayHourly, 'temp'),
  });
  logger.debug('Night', {
    first: new Date(nightHourly.at(0).dt  * 1000).toISOString(),
    last:  new Date(nightHourly.at(-1).dt * 1000).toISOString(),
    temp:  _.map(nightHourly, 'temp'),
  });

  await mqttClient.publish('wetter/INFO', JSON.stringify({
    ...weather,
    dayMaxWind,
    dayMinTemp,
    dayMaxTemp,
    nightMaxWind,
    nightMinTemp,
    nightMaxTemp,
  }), {retain: true});
};

const handleSunTimes = async function() {
  const sunTimes = await getSunTimes({suncalcLocation: config.suncalcLocation});

  await mqttClient.publish('sunTimes/INFO', JSON.stringify(sunTimes), {retain: true});
};

(async() => {
  // #########################################################################
  // Config
  config = await configFile.read();

  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

  setInterval(handleWeather, ms('1 hour'));

  setInterval(handleSunTimes, ms('4 hours'));

  handleWeather(); // on startup
})();
