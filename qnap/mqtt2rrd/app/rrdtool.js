'use strict';

const execa = require('execa');

const {
  keys,
  values,
} = require('lodash');

module.exports = {
  async update(rrdFile, rrdUpdates) {
    const {stderr} = await execa('/opt/rrdtool/bin/rrdupdate', [
      rrdFile,
      '--template',
      keys(rrdUpdates).join(':'),
      `N:${values(rrdUpdates).join(':')}`,
    ]);

    if(stderr) {
      throw new Error(stderr);
    }
  },
};
