#!/usr/bin/env node

import fsPromises       from 'node:fs/promises';
import path             from 'node:path';

import _                from 'lodash';
import cron             from 'croner';
import dayjs            from 'dayjs';
import icsToJsonDefault from 'ics-to-json-extended';
import mqtt             from 'async-mqtt';

import logger           from './logger.js';

const icsToJson = icsToJsonDefault.default;

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
// TODO Warnung (per email), wenn nur noch wenige zukuenftige leerungen im kalender sind - man soll das neue ics file laden

const icsFile       = '/data/allestrassennufringen.ics';
const reportHour    = 17;
const cleanHour     = 8;
const topicMorgen   = 'muell/leerung/morgen';
const topicNaechste = 'muell/leerung/naechste';
const topicKalender = 'muell/leerung/kalender';

// ###########################################################################
// Globals

let mqttClient

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

  await mqttClient.end();
  mqttClient = undefined;

  process.exit(0);
};

const checkMuell = async function() {
  const icsData          = await fsPromises.readFile(icsFile, 'utf8');
  const leerungen        = icsToJson(icsData);
  const now              = dayjs();
  const nowISO           = now.toISOString();
  const tomorrow         = now.clone().hour(24).minute(0).second(0).millisecond(0);
  const tomorrowISO      = tomorrow.toISOString();
  const leerungenMorgen  = _.filter(leerungen, leerung => dayjs(leerung.startDate).toISOString() === tomorrowISO);
  const leerungenZukunft = _.filter(leerungen, leerung => dayjs(leerung.startDate).toISOString() > nowISO);

  logger.info(leerungenMorgen);

  if(leerungenMorgen.length && now.hour() >= reportHour) {
    await mqttClient.publish(topicMorgen, JSON.stringify(leerungenMorgen), {retain: true});
  } else {
    await mqttClient.publish(topicMorgen, null, {retain: true});
  }

  const leerungenZukunftProSorte = _.uniqBy(leerungenZukunft, 'summary');

  logger.info(leerungenZukunftProSorte);

  await mqttClient.publish(topicNaechste, JSON.stringify(leerungenZukunftProSorte), {retain: true});

  if(leerungenZukunft.length < 10) {
    await mqttClient.publish(topicKalender, JSON.stringify({TODO: 'Bitte Kalender aktualisieren!'}));
  }
};

process.on('SIGTERM', () => stopProcess());

(async() => {
  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

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
    await mqttClient.publish(topicMorgen, null, {retain: true});
  });
})();
