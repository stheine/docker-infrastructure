#!/usr/bin/env node

import https from 'node:https';

import axios from 'axios';
import cron  from 'croner';
import {
  logger,
  sendMail,
} from '@stheine/helpers';

import {
  baseUrl,
  comics,
  cronHour,
  cronMinute,
} from '/var/comics/config.js';

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

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
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  const pageResponse = await axios.get(`${baseUrl}/${comic}/`, {httpsAgent});

  const page = pageResponse.data;

  const date = page
    .replace(/^[\S\s]*<span class="cur">/, '')
    .replace(/<\/span>[\S\s]*$/, '');

  const figure = page
    .replace(/^[\S\s]*<figure class="comic">\s*/, '')
    .replace(/\s*<\/figure>[\S\s]*$/, '');
  const img = figure
    .replace(/\s*<cite.*<\/cite>/, '');
  const src = img
    .replace(/<img id="comic-zoom" data-zoom-image="[^"]*" src="/, '')
    .replace(/" +data-width="[^"]*" data-height="[^"]*" alt="" class="[^"]*" title="[^"]*" \/>/, '');

  const label = page
    .replace(/^[\S\s]*<meta property="og:title" content="/, '')
    .replace(/"\/>[\S\s]*$/, '');

  const imageResponse = await axios.get(src, {httpsAgent, responseType: 'arraybuffer'});
  const imageBuffer = Buffer.from(imageResponse.data, 'binary');
  const imageBase64 = imageBuffer.toString('base64');

  return {date, imageBase64, label};
};

const readComics = async function() {
  const metas = [];

  for(const comic of comics) {
    const meta = await readComic(comic);

    // console.log(image);
    // console.log(imageBase64);

    metas.push(meta);
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

  await mailComics(metas);
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
  //    ┌──────────────────────────────────── second (optional)
  //    │ ┌────────────────────────────────── minute
  //    │ │             ┌──────────────────── hour
  //    │ │             │           ┌──────── day of month
  //    │ │             │           │ ┌────── month
  //    │ │             │           │ │ ┌──── day of week (0 is Sunday)
  //    S M             H           D M W
  cron(`0 ${cronMinute} ${cronHour} * * *`, {timezone: 'Europe/Berlin'}, sendComics);
})();
