import fsPromises from 'node:fs/promises';

import axios      from 'axios';
import check      from 'check-types-2';
import fsExtra    from 'fs-extra';
import ms         from 'ms';

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

    if(cacheAge && cacheAge < ms('25 minutes')) {
      // Return cached data
      return cachedSolcast.forecasts;
    }
  } catch {
    cacheAge = null;
  }

  try {
    // logger.info('Refresh solcast cache');

    const response = await axios.get(
      `https://api.solcast.com.au/rooftop_sites/${config.RESOURCE_ID}/forecasts?hours=36`,
      {
        headers: {Authorization: `Bearer ${config.API_KEY}`},
        json:    true,
      },
    );

    newSolcast = response.data;

    check.assert.object(newSolcast);
    check.assert.array(newSolcast.forecasts);

    await fsExtra.writeJson('/var/solcast/solcast-cache.json', newSolcast, {spaces: 2});

    return newSolcast.forecasts;
  } catch(err) {
    // Failed to update the solcast data
    if(cacheAge && cacheAge < ms('90 minutes')) {
      // Return cached data
      return cachedSolcast.forecasts;
    }

    throw new Error(`Failed to refresh solcast data and cache outdated: ${err.message}`);
  }
};
