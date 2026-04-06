#!/usr/bin/env node

import {setTimeout as delay} from 'node:timers/promises';
import https  from 'node:https';
import os     from 'node:os';

import _      from 'lodash';
import axios  from 'axios';
import check  from 'check-types-2';
import {Cron} from 'croner';
import dayjs  from 'dayjs';
import mqtt   from 'mqtt';
import ms     from 'ms';
import {
  logger,
  sendMail,
} from '@stheine/helpers';

import configFile from './configFile.js';

const config = await configFile.read();

const {
  baseUrl,
  comics,
  cronHour,
  cronMinute,
} = config;

const httpsAgent = new https.Agent({
//  rejectUnauthorized: false,
});
let   mqttClient;
const hostname   = os.hostname();

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

  if(mqttClient) {
    await mqttClient.endAsync();
    mqttClient = undefined;
  }

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

const renderComic = function(meta) {
  const {date, imageBase64, label} = meta;

  return (
    `<div style='padding-bottom: 20px;'>` +
      `<div style='font-size: 120%; border-top: 1px solid;'>${label} - ${date}</div>` +
      `<img src='data:image/gif;base64,${imageBase64}' />` +
    `</div>`
  );
};

const renderComics = function(metas) {
  return metas.map(meta => renderComic(meta))
    .join('');
};

const readComic = async function(comic) {
  let   date;
  let   imageBase64;
  let   label;
  let   retry = 12 * 6;
  const pageUrl = `${baseUrl}/${comic}/`;

  do {
    let imageUrl;
    let page;

    // logger.debug(`${comic} Reading ${pageUrl}`);

    try {
      const pageResponse = await axios.get(pageUrl, {httpsAgent});

      page = pageResponse.data;

      date = page
        .replace(/^[\S\s]*<span class="cur">/, '')
        .replace(/<\/span>[\S\s]*$/, '');

      check.assert.less(date.length, 20, `${comic} Failed to read date '${date}'`);

      const day = date.replace(/^[A-Za-z]+\s+/, '');

      check.assert.number(Number(day), `${comic} Failed to parse day from date '${date}'`);

      check.assert.equal(Number(day), dayjs().date(), `${comic} Day mismatch '${date}'`);
    } catch(err) {
      if(err.message.includes('ECONNREFUSED') ||
        err.message.includes('status code 502') || // 502 Bad Gateway
        err.message.includes('status code 504') || // 504 Gateway Timeout
        err.message.includes('Day mismatch')
      ) {
        page = null;
        retry--;

        if(retry) {
          // logger.error(`Failed reading page ${pageUrl} - retrying`, err.message);
          await delay(ms('5m'));
        } else {
          logger.error(`Failed reading page ${pageUrl} - giving up`, err.message);
        }
      } else {
        retry = 0;

        logger.error(`Failed reading page ${pageUrl}`, err.message);
      }
    }

    if(page) {
      try {
        label = page
          .replace(/^[\S\s]*<meta property="og:title" content="/, '')
          .replace(/"\/>[\S\s]*$/, '');

        check.assert.less(label.length, 40, `${comic} Failed to read label '${label}'`);

        const figure = page
          .replace(/^[\S\s]*?<figure class="comic">\s*/, '')
          .replace(/\s*<\/figure>[\S\s]*$/, '');
        const img = figure
          .replace(/\s*<cite.*<\/cite>/, '');

        imageUrl = img
          .replace(/<img id="comic-zoom" data-zoom-image="[^"]*" src="/, '')
          .replace(/" +data-width="[^"]*" data-height="[^"]*" alt="[^"]*" class="[^"]*" title="[^"]*" \/>/, '');

        check.assert.match(imageUrl, /^https:.*\.(?:gif|jpg)$/, `${comic} Failed to parse imageUrl from '${figure}'`);

        const imageResponse = await axios.get(imageUrl, {httpsAgent, responseType: 'arraybuffer'});
        const imageBuffer   = Buffer.from(imageResponse.data, 'binary');

        imageBase64 = imageBuffer.toString('base64');

        retry = 0;
      } catch(err) {
        if(err.message.includes('ECONNREFUSED')) {
          retry--;

          if(retry) {
            // logger.error(`Failed reading image ${imageUrl} - retrying`, err.message);
            await delay(ms('5m'));
          } else {
            logger.error(`Failed reading image ${imageUrl} - giving up`, err.message);
          }
        } else {
          retry = 0;

          logger.error(`Failed reading image ${imageUrl}`, err.message);
        }
      }
    }
  } while(retry);

  return {date, imageBase64, label};
};

const mailComics = async function(metas) {
  await sendMail({
    to:      'stefan@heine7.de',
    subject: 'Comics',
    html:
      `<html>${renderComics(metas)}</html>`,
  });
};

const sendComics = async function() {
  const metas = _.compact(await Promise.all(comics.map(comic => readComic(comic))));

  if(metas.length) {
    await mailComics(metas);
  } else {
    await mqttClient.publishAsync(`mqtt-notify/notify`, JSON.stringify({
      priority: -1,
      sound:    'none',
      title:    'Comics',
      message:  'Failed to read any comic',
    }));
  }
};

// #########################################################################
// Startup
logger.info(`Startup --------------------------------------------------`);

// #########################################################################
// Init MQTT
mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

// Signal handler
process.on('SIGHUP', async() => {
  logger.info('Trigger by HUP');
  await sendComics();
});

// #########################################################################
// Schedule
//                    ┌──────────────────────────────────── second (optional)
//                    │ ┌────────────────────────────────── minute
//                    │ │             ┌──────────────────── hour
//                    │ │             │           ┌──────── day of month
//                    │ │             │           │ ┌────── month
//                    │ │             │           │ │ ┌──── day of week (0 is Sunday)
//                    S M             H           D M W
const job = new Cron(`0 ${cronMinute} ${cronHour} * * *`, {timezone: 'Europe/Berlin'}, sendComics);

_.noop('Cron job started', job);
