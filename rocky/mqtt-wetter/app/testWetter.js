#!/usr/bin/env node

import configFile from './configFile.js';
import {logger}   from '@stheine/helpers';
import {
  getMaxSun,
  getSunTimes,
  getWeather,
}  from './wetter.js';

// read Weather data

(async() => {
  const config = await configFile.read();

  const maxSun = await getMaxSun({
    suncalcLocation:     config.suncalcLocation,
  });

  const sunTimes = await getSunTimes({
    suncalcLocation:     config.suncalcLocation,
  });

  const weather = await getWeather({
    openWeatherLocation: config.openWeatherLocation,
    suncalcLocation:     config.suncalcLocation,
  });

  logger.info({maxSun, sunTimes, weather});
  logger.info(typeof maxSun);
  logger.info(typeof sunTimes.solarNoon);
})();
