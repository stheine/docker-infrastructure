import _         from 'lodash';
import AsyncLock from 'async-lock';
import {execa}   from 'execa';

import logger    from './logger.js';

const lock = new AsyncLock();

export default async function rrdUpdate(rrdFile, rrdUpdates) {
  await lock.acquire(rrdFile, async() => {
    const cmd = '/opt/rrdtool/bin/rrdupdate';
    const params = [
      rrdFile,
      '--template',
      _.keys(rrdUpdates).join(':'),
      `N:${_.values(rrdUpdates).join(':')}`,
    ];

    // logger.info('rrdtool.update', {cmd, params});

    try {
      const {stderr, stdout} = await execa(cmd, params);

      if(stderr) {
        logger.info('rrdtool.update', {stderr, stdout});

        throw new Error(stderr);
      }
    } catch(err) {
      if(err.message.includes('ERROR: could not lock RRD')) {
        logger.error('rrdtool.update() could not lock RRD', rrdFile);
      } else {
        logger.error('rrdtool.update() execa error:', err.message.replace(/^(RRDtool|Usage| {17}).*$/gm, '').replace(/\n/g, ''));
      }
    }
  });
}
