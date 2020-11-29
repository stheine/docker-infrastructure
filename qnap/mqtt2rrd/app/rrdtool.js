'use strict';

const execa = require('execa');

const logger = require('./logger');

const {
  keys,
  values,
} = require('lodash');

module.exports = {
  async update(rrdFile, rrdUpdates) {
    const cmd = '/opt/rrdtool/bin/rrdupdate';
    const params = [
      rrdFile,
      '--template',
      keys(rrdUpdates).join(':'),
      `N:${values(rrdUpdates).join(':')}`,
    ];

    // logger.info('rrdtool.update', {cmd, params});

    const {stderr, stdout} = await execa(cmd, params);

    // logger.info('rrdtool.update', {stderr, stdout});

    if(stderr) {
      throw new Error(stderr);
    }
  },
};
