#!/usr/bin/env node

import configFile from './configFile.js';
import logger     from './logger.js';
import {
  getSunTimes,
  getWeather,
}  from './wetter.js';

// read Weather data

(async() => {
  const config = await configFile.read();

  const sunTimes = await getSunTimes({
    suncalcLocation:     config.suncalcLocation,
  });

  const weather = await getWeather({
    openWeatherLocation: config.openWeatherLocation,
    suncalcLocation:     config.suncalcLocation,
  });

  logger.info({sunTimes, weather});
})();
