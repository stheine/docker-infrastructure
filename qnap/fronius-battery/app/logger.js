'use strict';

/* eslint-disable no-console */

const dayjs = require('dayjs');

module.exports = {
  debug(msg, params) {
    if(arguments.length > 1) {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} DEBUG`, msg, params);
    } else {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} DEBUG`, msg);
    }
  },
  info(msg, params) {
    if(arguments.length > 1) {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg, params);
    } else {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} INFO`, msg);
    }
  },
  warn(msg, params) {
    if(arguments.length > 1) {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg, params);
    } else {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} WARN`, msg);
    }
  },
  error(msg, params) {
    if(arguments.length > 1) {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg, params);
    } else {
      console.log(`${dayjs().format('YYYY-MM-DD HH:mm:ss')} ERROR`, msg);
    }
  },
};
