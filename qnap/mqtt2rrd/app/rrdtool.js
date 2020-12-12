'use strict';

const AsyncLock = require('async-lock');
const execa     = require('execa');
const {
  keys,
  values,
} = require('lodash');

const logger    = require('./logger');

const lock = new AsyncLock();

module.exports = {
  async update(rrdFile, rrdUpdates) {
    await lock.acquire(rrdFile, async() => {
      const cmd = '/opt/rrdtool/bin/rrdupdate';
      const params = [
        rrdFile,
        '--template',
        keys(rrdUpdates).join(':'),
        `N:${values(rrdUpdates).join(':')}`,
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
          logger.error('rrdtool.update() execa error:', err.message);
        }
      }
    });
  },
};
