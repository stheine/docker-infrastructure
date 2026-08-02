/* eslint-disable camelcase */
/* eslint-disable max-len */

// https://data-api.tibber.com/docs/auth/
// https://github.com/evcc-io/evcc/issues/30468

// get homeId via https://data-api.tibber.com/v1/homes
// get vehicleId via https://data-api.tibber.com/v1/homes/${homeId}/devices

import axios      from 'axios';
import {logger}   from '@stheine/helpers';

import statusFile from './statusFile.js';

const tokenUrl = 'https://thewall.tibber.com/connect/token';

const refreshAccessToken = async function({config, status}) {
  const {tibberDataApiClientId, tibberDataApiClientSecret} = config;
  let   {accessToken, refreshToken} = status;

  // logger.debug('getTibberVehicle(), refresh access token');

  const postData = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     tibberDataApiClientId,
    client_secret: tibberDataApiClientSecret,
  });

  const response = await axios({
    url:            tokenUrl,
    method:         'POST',
    data:           postData,
    validateStatus: null,
  });

  const {data, status: statusCode, statusText} = response;

  // logger.debug('getTibberVehicle(), refresh access token', data);

  switch(statusCode) {
    case 200:
      logger.debug('getTibberVehicle(), refreshed access token');

      accessToken  = data.access_token;
      refreshToken = data.refresh_token;

      await statusFile.write({accessToken, refreshToken});

      // TODO expires_in #seconds - store and check when reading access_token

      // TODO nicht in separaten files, sondern in json config file (helpers?)
      break;

    default:
      logger.debug(`getTibberVehicle(), refresh access token, unexpected`, {tokenUrl, postData});

      // Getting the initial access_token and refresh_code
      logger.debug(`https://thewall.tibber.com/connect/authorize` +
        `?response_type=code` +
        `&client_id=${tibberDataApiClientId}` +
        `&redirect_uri=${encodeURIComponent('http://localhost/')}` +
        `&scope=${
          [
            'openid',
            'profile',
            'email',
            'offline_access',
            'data-api-user-read',
            'data-api-homes-read',
            'data-api-vehicles-read',
          ].join('%20')}` +
        `&state=strom`);
      logger.debug(`Paste this URL into browser and approve access. From the resulting URL, cut the CODE.`);
      logger.debug(`curl -s -X POST https://thewall.tibber.com/connect/token ` +
        `--data-urlencode "grant_type=authorization_code" ` +
        `--data-urlencode "code=CODE" ` +
        `--data-urlencode "redirect_uri=http://localhost/" ` +
        `--data-urlencode "client_id=${tibberDataApiClientId}" ` +
        `--data-urlencode "client_secret=${tibberDataApiClientSecret}"`);
      logger.debug(`Then update the data/strom/strom.json access_token and refresh_token`);
      throw new Error(`getTibberVehicle(), refresh access token, unexpected ` +
        `status=${statusCode} statusText=${statusText} data=${JSON.stringify(data)}`);
  }

  return accessToken;
};

export default async function getTibberVehicle({config, status}) {
  const {homeId, vehicleId} = config;
  let   {accessToken} = status;

  const api = `https://data-api.tibber.com/v1/homes/${homeId}/devices/${vehicleId}`;

  // TODO now=$(date +%s)

  // TODO read cached accessToken, if not expired yet
  // TODO if [[ -f '$DIR/access_token' && -f '$DIR/access_expiry' ]]; then
  // TODO  exp=$(cat '$DIR/access_expiry')
  // TODO  if (( exp - now > 120 )); then TOK=$(cat '$DIR/access_token'); fi
  // TODO fi

  if(!accessToken) {
    accessToken = await refreshAccessToken({config, status});
  }

  let retry = 2;
  let vehicleData;

  do {
    // logger.debug('getTibberVehicle(), calling', accessToken);

    const response = await axios({
      url:    api,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      validateStatus: null,
    });

    const {data, status: statusCode, statusText} = response;

    switch(statusCode) {
      case 200:
        // logger.info('getTibberVehicle(), success', data);

        vehicleData = {
          lastSeen:                      data?.status?.lastSeen,
          name:                          data?.info?.name,
          vinNumber:                     data?.attributes?.find(att => att?.id === 'vinNumber')?.value,
          isOnline:                      data?.attributes?.find(att => att?.id === 'isOnline')?.value,
          'storage.stateOfCharge':       data?.capabilities?.find(att => att?.id === 'storage.stateOfCharge')?.value,
          'storage.targetStateOfCharge': data?.capabilities?.find(att => att?.id === 'storage.targetStateOfCharge')?.value,
          'range.remaining':             data?.capabilities?.find(att => att?.id === 'range.remaining')?.value,
          'connector.status':            data?.capabilities?.find(att => att?.id === 'connector.status')?.value,
          'charging.status':             data?.capabilities?.find(att => att?.id === 'charging.status')?.value,
        };

        retry = 0;
        break;

      case 401:
        if(retry) {
          accessToken = await refreshAccessToken({config, status});
        } else {
          throw new Error('getTibberVehicle(), authentication error, but no more retries');
        }
        retry--;
        break;

      // case 429:
      // TODO
      // Handling 429
      // Check Retry-After. If present, wait that duration (seconds or HTTP-date) plus a small random jitter (0–250 ms). If missing, use full‑jitter exponential backoff (see Retry & backoff). Cap total attempts to e.g. 5, then surface the error.
        // break;

      default:
        throw new Error(`getTibberVehicle(), unexpected ` +
          `status=${statusCode} statusText=${statusText} data=${JSON.stringify(data)}`);
    }
  } while(retry);

  if(vehicleData) {
    return vehicleData;
  }
}
