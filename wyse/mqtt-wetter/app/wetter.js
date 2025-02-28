import _        from 'lodash';
import axios    from 'axios';
import check    from 'check-types-2';
import {logger} from '@stheine/helpers';
import ms       from 'ms';
import suncalc  from 'suncalc';

const degToRad = function(degrees) {
  return degrees * (Math.PI / 180);
};

export const getMaxSun = async function({suncalcLocation}) {
  // Calculate the timestamp of the max sun impact to the house
  const orientationRad = degToRad(suncalcLocation.orientation);

  // console.log({orientationRad});

  const date = new Date();
  let   prevAzimuth = -1;
  let   maxSunTimestamp;
  let   maxFound = false;

  for(const hours of _.range(10, 15)) {
    for(const minutes of _.range(0, 59)) {
      maxSunTimestamp = date.setUTCHours(hours, minutes, 0, 0);

      const sunPosition = suncalc.getPosition(date, suncalcLocation.latitude, suncalcLocation.longitude);
      const {azimuth} = sunPosition;

      // console.log({...sunPosition, hours, minutes});

      if(orientationRad > prevAzimuth && orientationRad < azimuth) {
        maxFound = true;
        break;
      }

      prevAzimuth = azimuth;
    }

    if(maxFound) {
      break;
    }
  }

  return new Date(maxSunTimestamp);
};

export const getSunTimes = async function({suncalcLocation}) {
  const today    = new Date();
  const tomorrow = new Date(new Date().setDate(today.getDate() + 1));

  // Calculate sunrise & sunset
  const sunTimesToday    = suncalc.getTimes(today,    suncalcLocation.latitude, suncalcLocation.longitude);
  const sunTimesTomorrow = suncalc.getTimes(tomorrow, suncalcLocation.latitude, suncalcLocation.longitude);

  return {
    ...sunTimesToday,
    sunriseTomorrow: sunTimesTomorrow.sunrise,
    sunsetTomorrow:  sunTimesTomorrow.sunset,
  };
};

// https://openweathermap.org/api/one-call-api
export const getWeather = async function({openWeatherLocation, suncalcLocation}) {
  check.assert.object(openWeatherLocation, 'openWeatherLocation missing');
  check.assert.object(suncalcLocation, 'suncalcLocation missing');

  // Getting data from OpenWeatherMap and extract the relevant information.
  const host  = 'api.openweathermap.org';
  const base  = '/data/3.0';
  const appId = `&appid=${openWeatherLocation.appId}`;

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
    const {hourly} = data;
    const next2Hours  = hourly.slice(0, 2);
    const next10Hours = hourly.slice(0, 10);
    const forecast2MaxClouds  = _.max(_.map(next2Hours, 'clouds'));
    const forecast2MaxTemp    = _.max(_.map(next2Hours, 'temp'));
    const forecast10MaxWind   = _.max(_.map(next10Hours, 'wind_speed'));
    const forecast10MinTemp   = _.min(_.map(next10Hours, 'temp'));

    return {
      ...data,
      forecast2MaxClouds,
      forecast2MaxTemp,
      forecast10MaxWind,
      forecast10MinTemp,
    };
  } catch(err) {
    logger.error(`Weather: Failed to get '${err.message}'`);
  }
};
