'use strict';

const _     = require('lodash');
const execa = require('execa');

module.exports = {
  async update(rrdFile, rrdUpdates) {
    const {stderr} = await execa('/opt/rrdtool/bin/rrdupdate', [
      rrdFile,
      '--template',
      _.keys(rrdUpdates).join(':'),
      `N:${_.values(rrdUpdates).join(':')}`,
    ]);

    if(stderr) {
      throw new Error(stderr);
    }
  },
};
