// import _      from 'lodash';
import axios   from 'axios';
import check   from 'check-types-2';
import ms      from 'ms';
import suncalc from 'suncalc';

import logger  from './logger.js';

export const getSunTimes = async function({suncalcLocation}) {
  // Calculate sunrise & sunset
  const sunTimes = suncalc.getTimes(new Date(), suncalcLocation.latitude, suncalcLocation.longitude);

  return sunTimes;
};

// https://openweathermap.org/api/one-call-api
export const getWeather = async function({openWeatherLocation, suncalcLocation}) {
  check.assert.object(openWeatherLocation, 'openWeatherLocation missing');
  check.assert.object(suncalcLocation, 'suncalcLocation missing');

  // Getting data from OpenWeatherMap and extract the relevant information.
  const host  = 'api.openweathermap.org';
  const base  = '/data/2.5';
  const appId = `&APPID=${openWeatherLocation.appId}`;

  try {
    const url = `https://${host}${base}/onecall?` +
      `&lat=${suncalcLocation.latitude}` +
      `&lon=${suncalcLocation.longitude}` +
      `&exclude=minutely,daily` +
      `&lang=de` +
      `&units=metric` +
      `${appId}`;
    const result = await await axios.get(url, {timeout: ms('2 seconds')});

    check.assert.object(result, `result not an object`);
    check.assert.equal(result.status, 200, `Unexpected status=${result.status}`);

    const {data} = result;
//    const {current, hourly} = data;
//    const next2Hours  = hourly.slice(0, 2);
//    const next10Hours = hourly.slice(0, 10);
//    const forecast2MaxClouds  = _.max(_.map(next2Hours, 'clouds'));
//    const forecast2MaxTemp    = _.max(_.map(next2Hours, 'temp'));
//    const forecast10MaxWind   = _.max(_.map(next10Hours, 'wind_speed'));
//    const forecast10MinTemp   = _.min(_.map(next10Hours, 'temp'));
//
//    const wetter = {
//      clouds:             current.clouds,
//      main:               current.weather[0].main,
//      description:        current.weather[0].description,
//      forecast2MaxClouds,
//      forecast2MaxTemp,
//      forecast10MaxWind,
//      forecast10MinTemp,
//    };

    return data;
  } catch(err) {
    logger.error(`Weather: Failed to get '${err.message}'`);
  }
};
