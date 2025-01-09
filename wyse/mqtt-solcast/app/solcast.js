import fsPromises from 'node:fs/promises';

import _          from 'lodash';
import axios      from 'axios';
import check      from 'check-types-2';
import dayjs      from 'dayjs';
import fsExtra    from 'fs-extra';
import {logger}   from '@stheine/helpers';
import ms         from 'ms';
import utc        from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

const dcLimit = 6200; // TODO config

export const analyzeForecasts = function(forecasts) {
  const now                  = dayjs.utc();
  const midnightTime         = now.clone().hour(24).minute(0).second(0);
  const tomorrowMidnightTime = now.clone().hour(48).minute(0).second(0);

  const hourlyForecasts = [];
  let   lastEstimateWh;
  let   lastStartDate;
  let   highPvHours     = 0;
  let   highPvWh        = 0;
  let   limitPvHours    = 0;
  let   limitPvWh       = 0;
  let   tomorrowPvWh    = 0;
  let   totalPvHours    = 0;
  let   totalPvWh       = 0;

  // Note, the pv_estimate is given in kWh. Multiply 1000 to get Wh.
  for(const forecast of forecasts) {
    const estimateWh = _.round(forecast.pv_estimate * 1000 / 2); // kWh to Wh, for 30min

    if(!estimateWh) {
      continue;
    }

    const periodEndDate   = dayjs(forecast.period_end);
    const periodStartDate = periodEndDate.subtract(30, 'minutes'); // period length is 30min

    if(periodStartDate < now) {
      continue;
    }

    // console.log(periodStartDate);

    if(periodStartDate.minute() === 0) {
      if(lastStartDate) {
        hourlyForecasts.push({
          estimateWh: lastEstimateWh,
          startDate:  lastStartDate,
          timeH:      Number(dayjs(lastStartDate).format('H')),
          timeUtcH:   Number(dayjs.utc(lastStartDate).format('H')),
        });
      }

      lastEstimateWh = estimateWh;
      lastStartDate  = periodStartDate;
    } else {
      const previousPeriodStartDate = periodStartDate.subtract(30, 'minutes');

      if(!lastStartDate) {
        lastEstimateWh = estimateWh;
        lastStartDate  = previousPeriodStartDate;
      } else if(lastStartDate.hour() !== previousPeriodStartDate.hour()) {
        hourlyForecasts.push({
          estimateWh: lastEstimateWh,
          startDate:  lastStartDate,
          timeH:      Number(dayjs(lastStartDate).format('H')),
          timeUtcH:   Number(dayjs.utc(lastStartDate).format('H')),
        });

        lastEstimateWh = estimateWh;
        lastStartDate  = previousPeriodStartDate;
      } else {
        lastEstimateWh += estimateWh;
      }
    }

    switch(true) {
      case periodEndDate < now:
        // Already passed
        break;

      case periodEndDate < midnightTime:
        // Today
        if(estimateWh) {
          totalPvHours += 0.5; // For 30min period
          totalPvWh    += estimateWh;
        }
        if(estimateWh > 1500) {
          highPvHours += 0.5; // For 30min period
          highPvWh    += estimateWh;
        }
        if(estimateWh > dcLimit / 2) {
          // Estimate is for 30 minute period
          limitPvHours += 0.5; // For 30min period
          limitPvWh    += estimateWh;
        }
        break;

      case periodEndDate < tomorrowMidnightTime:
        // Tomorrow
        tomorrowPvWh += estimateWh;
        break;

      default:
        // After tomorrow
        break;
    }
  }
  hourlyForecasts.push({
    estimateWh: lastEstimateWh,
    startDate:  lastStartDate,
    timeH:      Number(dayjs(lastStartDate).format('H')),
    timeUtcH:   Number(dayjs.utc(lastStartDate).format('H')),
  });

  // console.log('SolarForecast', {hourlyForecasts});

  return {
    highPvHours,
    highPvWh,
    hourlyForecasts,
    limitPvHours,
    limitPvWh,
    tomorrowPvWh,
    totalPvHours,
    totalPvWh,
  };
};

export const getSolcastForecasts = async function(config) {
  let cacheAge;
  let cachedSolcast;
  let newSolcast;

  try {
    await fsPromises.access('/var/solcast/solcast-cache.json');

    const stats = await fsPromises.stat('/var/solcast/solcast-cache.json');

    cacheAge = stats ? Date.now() - stats.mtime : null;

    if(cacheAge) {
      cachedSolcast = await fsExtra.readJSON('/var/solcast/solcast-cache.json');

      check.assert.object(cachedSolcast);
      check.assert.array(cachedSolcast.forecasts);
    }

    if(cacheAge && cacheAge < ms('3 hours')) { // 10 free requests per day
      // Return cached data
      // logger.info('Returned cached (<3h) solcast');

      return cachedSolcast.forecasts;
    }
  } catch{
    cacheAge = null;
  }

  try {
    // logger.info('Refresh solcast cache');

    const response = await axios.get(
      `https://api.solcast.com.au/rooftop_sites/${config.RESOURCE_ID}/forecasts`,
      {
        headers:        {Authorization: `Bearer ${config.API_KEY}`},
        json:           true,
        validateStatus: null,
      }
    );

    check.assert.nonEmptyObject(response);
    check.assert.equal(response.status, 200, `Unexpected response ${response.status} ${response.statusText}`);
    check.assert.equal(response.statusText, 'OK', `Unexpected response ${response.status} ${response.statusText}`);

    newSolcast = response.data;

    check.assert.object(newSolcast);
    check.assert.array(newSolcast.forecasts);

    await fsExtra.writeJson('/var/solcast/solcast-cache.json', newSolcast, {spaces: 2});

    logger.trace('Refreshed solcast cache');

    return newSolcast.forecasts;
  } catch(err) {
    // Failed to update the solcast data
    if(cacheAge && cacheAge < ms('6 hours')) {
      // Return cached data
      // logger.info('Returned cached (<6h) solcast');

      return cachedSolcast.forecasts;
    }

    throw new Error(`Failed to refresh solcast data and cache outdated: ${err.message}`);
  }
};
