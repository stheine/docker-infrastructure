import {setTimeout as delay} from 'node:timers/promises';

import axios    from 'axios';
import {logger} from '@stheine/helpers';
import ms       from 'ms';

export default async function notify({config, data: notifyData}) {
  logger.debug('notify', notifyData);

  let retry = true;

  do {
    const response = await axios({
      method: 'post',
      url:    'https://api.pushover.net/1/messages.json',
      data: {
        sound:    'intermission',
        ...config,
        ...notifyData,
      },
      validateStatus: null,
    });

    const {status, statusText, data} = response;

    if(status === 200) {
      logger.debug('notify success', {status, statusText, data});

      retry = false;
    } else if(status >= 400 && status < 500) {
      logger.error('notify failed', {status, statusText, data});

      retry = false;
    } else {
      logger.warn('notify error, retrying', {status, statusText, data});

      await delay(ms('10s'));
    }
  } while(retry);
}
