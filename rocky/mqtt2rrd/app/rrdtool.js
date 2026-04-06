import {setTimeout as delay} from 'node:timers/promises';

import _         from 'lodash';
import AsyncLock from 'async-lock';
import {execa}   from 'execa';
import {logger}  from '@stheine/helpers';
import ms        from 'ms';

const lock    = new AsyncLock();
const retries = 20;

export default async function rrdUpdate(rrdFile, rrdUpdates) {
  await lock.acquire(rrdFile, async() => {
    const cmd = '/opt/rrdtool/bin/rrdupdate';
    const params = [
      rrdFile,
      '--template',
      _.keys(rrdUpdates).join(':'),
      `N:${_.values(rrdUpdates).join(':')}`,
    ];

//    if(rrdFile === '/var/wasser/wasser.rrd') {
//      logger.info('rrdtool.update', {cmd, params});
//    }

    let retry = retries;

    do {
      try {
        const {stderr, stdout} = await execa(cmd, params);

        if(stderr) {
          logger.info('rrdtool.update', {stderr, stdout});

          throw new Error(stderr);
        }

        if(retry !== retries) {
          // logger.debug(`rrdtool.update() success after retries (${retry})`, rrdFile);
        }

        retry = 0;
      } catch(err) {
        if(err.message.includes('ERROR: could not lock RRD')) {
          retry--;

          if(retry) {
            // logger.warn('rrdtool.update() could not lock RRD, retrying', rrdFile);

            await delay(ms('100ms'));
          } else {
            logger.error('rrdtool.update() could not lock RRD', rrdFile);
          }
        } else {
          logger.error(`rrdtool.update() execa error: ` +
            `${err.message.replace(/RRDtool|Usage| {17}/m, '').replaceAll('\n', '')}`, {rrdFile, rrdUpdates});
          retry = 0;
        }
      }
    } while(retry);
  });
}
