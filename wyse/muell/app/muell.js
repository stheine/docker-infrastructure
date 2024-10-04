#!/usr/bin/env node

/* eslint-disable newline-per-chained-call */

import fsPromises       from 'node:fs/promises';
import os               from 'node:os';

import _                from 'lodash';
import cron             from 'croner';
import dayjs            from 'dayjs';
import icsToJsonDefault from 'ics-to-json-extended';
import {logger}         from '@stheine/helpers';
import mqtt             from 'mqtt';
import ms               from 'ms';
import timezone         from 'dayjs/plugin/timezone.js';
import utc              from 'dayjs/plugin/utc.js';

const icsToJson = icsToJsonDefault.default;

dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.tz.setDefault(dayjs.tz.guess());

// ###########################################################################
// Reference
// https://github.com/MHohenberg/NextTrash
//
// https://www.awb-bb.de/start.html
// - Abfuhrtermine
// - Stadt/Gemeinde: Nufringen
// - [x] Biomüll
// - [x] Papier
// - [x] Restmüll
// - Zeitraum: <Jahr>
// - Herunterladen als ICS
// - Datei speichern unter /mnt/qnap_linux/data/muell/allestrassennufringen.ics

// TODO mehrere files von verschiedenen Jahren lesen und zusammenfuegen
// TODO Warnung (per email), wenn nur noch wenige zukuenftige leerungen im kalender sind -
// man soll das neue ics file laden

const icsFile       = '/data/allestrassennufringen.ics';
const reportHour    = 17;
const cleanHour     = 8;
const topicMorgen   = 'muell/leerung/morgen';
const topicNaechste = 'muell/leerung/naechste';
const topicKalender = 'muell/leerung/kalender';

// ###########################################################################
// Globals

let   healthInterval;
const hostname   = os.hostname();
let   mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.endAsync();
    mqttClient = undefined;
  }

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

const checkMuell = async function() {
  const icsData          = await fsPromises.readFile(icsFile, 'utf8');
  const leerungen        = icsToJson(icsData);
  const now              = dayjs.tz();
  const nowString        = now.format('YYYY-MM-DD HH:mm:ss');
  const tomorrow         = now.clone().date(now.date() + 1).hour(0).minute(0).second(0).millisecond(0);
  const tomorrowString   = tomorrow.format('YYYY-MM-DD HH:mm:ss');
  const leerungenMorgen  = _.filter(leerungen, leerung =>
    dayjs(leerung.startDate).format('YYYY-MM-DD HH:mm:ss') === tomorrowString);
  const leerungenZukunft = _.filter(leerungen, leerung =>
    dayjs(leerung.startDate).format('YYYY-MM-DD HH:mm:ss') > nowString);

  if(leerungenMorgen.length && now.hour() >= reportHour) {
    await mqttClient.publishAsync(topicMorgen, JSON.stringify(leerungenMorgen), {retain: true});
  } else {
    await mqttClient.publishAsync(topicMorgen, null, {retain: true});
  }

  const leerungenZukunftProSorte = _.uniqBy(leerungenZukunft, 'summary');

  // logger.info({leerungenZukunftProSorte});

  await mqttClient.publishAsync(topicNaechste, JSON.stringify(leerungenZukunftProSorte), {retain: true});

  if(leerungenZukunft.length < 10) {
    await mqttClient.publishAsync(topicKalender, JSON.stringify({TODO: 'Bitte Kalender aktualisieren!'}));
  }
};

process.on('SIGTERM', () => stopProcess());

(async() => {
  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  healthInterval = setInterval(async() => {
    await mqttClient.publishAsync(`muell/health/STATE`, 'OK');
  }, ms('1min'));

  // #########################################################################
  // Run on startup
  await checkMuell();

  // #########################################################################
  // Schedule
  //    ┌────────────────────────── second (optional)
  //    │ ┌──────────────────────── minute
  //    │ │             ┌────────── hour
  //    │ │             │ ┌──────── day of month
  //    │ │             │ │ ┌────── month
  //    │ │             │ │ │ ┌──── day of week (0 is Sunday)
  //    S M             H D M W
  cron(`0 0 ${reportHour} * * *`, {timezone: 'Europe/Berlin'}, checkMuell);

  // Clean
  cron(`0 0  ${cleanHour} * * *`, {timezone: 'Europe/Berlin'}, async() => {
    await mqttClient.publishAsync(topicMorgen, null, {retain: true});
  });
})();
