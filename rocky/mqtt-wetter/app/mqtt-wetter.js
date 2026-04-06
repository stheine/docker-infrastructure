#!/usr/bin/env node
import os         from 'node:os';

import _          from 'lodash';
import axios      from 'axios';
import check      from 'check-types-2';
import {Cron}     from 'croner';
import {logger}   from '@stheine/helpers';
import mqtt       from 'mqtt';
import ms         from 'ms';

import configFile from './configFile.js';
import {
  getMaxSun,
  getSunTimes,
  getWeather,
} from './wetter.js';

// ###########################################################################
// Globals

let   config;
let   healthInterval;
const hostname   = os.hostname();
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

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const handleWeatherDWD = async function() {
  const {eveningStartsHour, morningEndsHour, dwdStationId, suncalcLocation} = config;

  // Timestamp calculation, local time to UTC
  // - now hours
  const date = new Date();

//  const nowUTCHour = date.getUTCHours();

  // - evening starts
  date.setHours(eveningStartsHour);

  const eveningStartsUTCHour = date.getUTCHours();

  // morning ends
  date.setHours(morningEndsHour);

  const morningEndsUTCHour = date.getUTCHours();

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


//  logger.debug('Timestamps', {
//    local:       {eveningStartsHour, morningEndsHour},
//    utc:         {nowUTCHour, eveningStartsUTCHour, morningEndsUTCHour},
//    nextMorning,
//    nextEvening,
//  });

  // Get weather data
  let results;

  try {
    results = await Promise.all([
      (async() => {
        // Current
        const host = 'api.open-meteo.com';
        const base = '/v1/dwd-icon';
        const url  = `https://${host}${base}` +
          `?latitude=${encodeURIComponent(suncalcLocation.latitude)}` +
          `&longitude=${encodeURIComponent(suncalcLocation.longitude)}` +
          `&current_weather=true`;
        const result = await await axios.get(url, {timeout: ms('2 seconds')});

        check.assert.object(result, `result not an object`);
        check.assert.object(result.data, `result.data not an object`);
        check.assert.object(result.data.current_weather, `result.data.current_weather not an object`);
        check.assert.equal(result.status, 200, `Unexpected status=${result.status}`);

        return result.data.current_weather;
      })(),
      (async() => {
        // Forecast
        const host = 'app-prod-ws.warnwetter.de';
        const base = '/v30/stationOverviewExtended';
        const url  = `https://${host}${base}?stationIds=${encodeURIComponent(dwdStationId)}`;
        const result = await await axios.get(url, {timeout: ms('2 seconds')});

        check.assert.object(result, `result not an object`);
        check.assert.object(result.data, `result.data not an object`);
        check.assert.object(result.data[dwdStationId], `result.data[dwdStationId] not an object`);
        check.assert.equal(result.status, 200, `Unexpected status=${result.status}`);

        return result.data[dwdStationId];
      })(),
    ]);
  } catch(err) {
    logger.error(`Weather: Failed to get weather data, '${err.message}'`);

    return;
  }

  const current  = results[0];
  const forecast = results[1];

  // K2920
  //   forecast1
  //     stationId                      "K2920"
  //     start                          1678402800000
  //     timeStep                       3600000
  //     temperature                    […]
  //     temperatureStd                 […]
  //     windSpeed                      null
  //     windDirection                  null
  //     windGust                       null
  //     icon                           […]
  //     precipitationTotal             […]
  //     dewPoint2m                     […]
  //     surfacePressure                […]
  //     humidity                       […]
  //     isDay                          […]
  //     precipitationProbablity        null
  //     precipitationProbablityIndex   null
  //   forecast2                        {…}
  //   forecastStart                    null
  //   days
  //     0                              {…}
  //     ...
  //     9                              {…}
  //   warnings                         […]
  //   threeHourSummaries               null

//  let dayHourly;
//  let nightHourly;

  if(nextEvening < nextMorning) {
    // Day. rest of today and coming night.
//     dayHourly   = weather.hourly.filter(set => set.dt * 1000 < nextEvening);
//     nightHourly = weather.hourly.filter(set => set.dt * 1000 >= nextEvening && set.dt * 1000 < nextMorning);
  } else {
    // nextEvening > nextMorning
    // Night. rest of night and coming day.

// // TODO ????
// //    const tomorrowEvening = new Date(nextEvening);
// //
// //    if(tomorrowEvening.getUTCHours() > morningEndsUTCHour) {
// //      // night. evening. coming day is tomorrow.
// //      tomorrowEvening.setUTCDate(tomorrowEvening.getUTCDate() + 1);
// //    }
// //    tomorrowEvening.setUTCHours(eveningStartsUTCHour);
// //    tomorrowEvening.setUTCMinutes(0);
// //    dayHourly   = weather.hourly.filter(set => set.dt * 1000 >= nextMorning && set.dt * 1000 < tomorrowEvening);
//
//     dayHourly   = weather.hourly.filter(set => set.dt * 1000 >= nextMorning && set.dt * 1000 < nextEvening);
//     nightHourly = weather.hourly.filter(set => set.dt * 1000 < nextMorning);
  }

//  const dayMaxTemp   = Math.max(...dayHourly.map(set => set.temp));
//  const dayMinTemp   = Math.min(...dayHourly.map(set => set.temp));
//  const dayMaxWind   = Math.max(...dayHourly.map(set => set.wind_speed));
//  const nightMaxTemp = Math.max(...nightHourly.map(set => set.temp));
//  const nightMinTemp = Math.min(...nightHourly.map(set => set.temp));
//  const nightMaxWind = Math.max(...nightHourly.map(set => set.wind_speed));

  // console.log(Night.map(set => new Date(set.dt * 1000).toISOString()));
  // console.log({DayMaxWind, DayMinTemp, DayMaxTemp, NightMaxWind, NightMinTemp, NightMaxTemp});

//  logger.debug('Day', {
//    first: new Date(dayHourly.at(0).dt  * 1000).toISOString(),
//    last:  new Date(dayHourly.at(-1).dt * 1000).toISOString(),
//    temp:  _.map(dayHourly, 'temp'),
//  });
//  logger.debug('Night', {
//    first: new Date(nightHourly.at(0).dt  * 1000).toISOString(),
//    last:  new Date(nightHourly.at(-1).dt * 1000).toISOString(),
//    temp:  _.map(nightHourly, 'temp'),
//  });

  await mqttClient.publishAsync('wetter/dwd/INFO', JSON.stringify({
    current,
    forecast,
//    dayMaxWind,
//    dayMinTemp,
//    dayMaxTemp,
    eveningStartsHour,
    morningEndsHour,
//    nightMaxWind,
//    nightMinTemp,
//    nightMaxTemp,
  }), {retain: true});
};

const handleWeather = async function() {
  try {
    const {eveningStartsHour, morningEndsHour, openWeatherLocation, suncalcLocation} = config;

    // Timestamp calculation, local time to UTC
    const date = new Date();

    date.setHours(eveningStartsHour);

    const eveningStartsUTCHour = date.getUTCHours();

    date.setHours(morningEndsHour);

    const morningEndsUTCHour = date.getUTCHours();

  //  logger.debug('Timestamps', {
  //    local: {eveningStartsHour, morningEndsHour},
  //    utc: {eveningStartsUTCHour, morningEndsUTCHour},
  //  });

    // Get weather data
    const weather = await getWeather({openWeatherLocation, suncalcLocation});

    check.assert.nonEmptyArray(weather?.hourly, `weather format unexpected: ${JSON.stringify(weather, null, 2)}`);

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

  //  logger.debug({nextMorning, nextEvening});

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

  //  logger.debug('Day', {
  //    first: new Date(dayHourly.at(0).dt  * 1000).toISOString(),
  //    last:  new Date(dayHourly.at(-1).dt * 1000).toISOString(),
  //    temp:  _.map(dayHourly, 'temp'),
  //  });
  //  logger.debug('Night', {
  //    first: new Date(nightHourly.at(0).dt  * 1000).toISOString(),
  //    last:  new Date(nightHourly.at(-1).dt * 1000).toISOString(),
  //    temp:  _.map(nightHourly, 'temp'),
  //  });

    await mqttClient.publishAsync('wetter/openweather/INFO', JSON.stringify({
      ...weather,
      dayMaxWind,
      dayMinTemp,
      dayMaxTemp,
      eveningStartsHour,
      morningEndsHour,
      nightMaxWind,
      nightMinTemp,
      nightMaxTemp,
    }), {retain: true});
  } catch(err) {
    logger.warn('Failed to get weather data', err.message);
  }
};

const handleMaxSun = async function() {
  const maxSun = await getMaxSun({suncalcLocation: config.suncalcLocation});

  await mqttClient.publishAsync('maxSun/INFO', JSON.stringify(maxSun), {retain: true});
};

const handleSunTimes = async function() {
  const sunTimes = await getSunTimes({suncalcLocation: config.suncalcLocation});

  await mqttClient.publishAsync('sunTimes/INFO', JSON.stringify(sunTimes), {retain: true});
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
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

  // #########################################################################
  let job;

  // Schedule
  //              ┌────────────── second (optional)
  //              │ ┌──────────── minute
  //              │ │ ┌────────── hour
  //              │ │ │ ┌──────── day of month
  //              │ │ │ │ ┌────── month
  //              │ │ │ │ │ ┌──── day of week (0 is Sunday)
  //              S M H D M W
  job = new Cron(`0 0 0 * * *`, {timezone: 'Europe/Berlin'}, async() => {
    await handleMaxSun();
    await handleSunTimes();
  });
  job = new Cron(`0 0 0 * * *`, {timezone: 'UTC'}, async() => {
    await handleMaxSun();
    await handleSunTimes();
  });

  _.noop('Cron job started', job);

  await handleMaxSun(); // on startup
  await handleSunTimes(); // on startup

  setInterval(handleWeather, ms('1 hour'));
  await handleWeather(); // on startup

  setInterval(handleWeatherDWD, ms('1 hour'));
  await handleWeatherDWD(); // on startup

  healthInterval = setInterval(async() => {
    await mqttClient.publishAsync(`mqtt-wetter/health/STATE`, 'OK');
  }, ms('1min'));
  await mqttClient.publishAsync(`mqtt-wetter/health/STATE`, 'OK'); // on startup
})();
