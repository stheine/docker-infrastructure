#!/usr/bin/env node

import https  from 'node:https';

import _      from 'lodash';
import axios  from 'axios';
import check  from 'check-types-2';
import {Cron} from 'croner';
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

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

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
  let url;

  try {
    url = `${baseUrl}/${comic}/`;

    const pageResponse = await axios.get(url, {httpsAgent});

    const page = pageResponse.data;

    const date = page
      .replace(/^[\S\s]*<span class="cur">/, '')
      .replace(/<\/span>[\S\s]*$/, '');

    check.assert.less(date.length, 20, `${comic} Failed to read date '${date}'`);

    const figure = page
      .replace(/^[\S\s]*?<figure class="comic">\s*/, '')
      .replace(/\s*<\/figure>[\S\s]*$/, '');
    const img = figure
      .replace(/\s*<cite.*<\/cite>/, '');

    url = img
      .replace(/<img id="comic-zoom" data-zoom-image="[^"]*" src="/, '')
      .replace(/" +data-width="[^"]*" data-height="[^"]*" alt="[^"]*" class="[^"]*" title="[^"]*" \/>/, '');

    check.assert.match(url, /^https:.*\.gif$/, `${comic} Failed to parse img url from '${figure}'`);

    const label = page
      .replace(/^[\S\s]*<meta property="og:title" content="/, '')
      .replace(/"\/>[\S\s]*$/, '');

    check.assert.less(date.length, 40, `${comic} Failed to read label '${label}'`);

    const imageResponse = await axios.get(url, {httpsAgent, responseType: 'arraybuffer'});
    const imageBuffer = Buffer.from(imageResponse.data, 'binary');
    const imageBase64 = imageBuffer.toString('base64');

    return {date, imageBase64, label};
  } catch(err) {
    logger.error(`Failed reading ${url}`, err.message);
  }
};

const readComics = async function() {
  const metas = [];

  for(const comic of comics) {
    const meta = await readComic(comic);

    if(meta) {
      metas.push(meta);
    }
  }

  return metas;
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
  const metas = await readComics();

  if(metas.length) {
    await mailComics(metas);
  }
};

(async() => {
  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

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
})();
