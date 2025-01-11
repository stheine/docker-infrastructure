#!/usr/bin/env node

/* eslint-disable newline-per-chained-call */

import fsPromises       from 'node:fs/promises';
import os               from 'node:os';
import path             from 'node:path';

import _                from 'lodash';
import {Cron}           from 'croner';
import dayjs            from 'dayjs';
import icsToJsonDefault from 'ics-to-json-extended';
import mqtt             from 'mqtt';
import ms               from 'ms';
import timezone         from 'dayjs/plugin/timezone.js';
import utc              from 'dayjs/plugin/utc.js';
import {
  logger,
  sendMail,
} from '@stheine/helpers';

const icsToJson = icsToJsonDefault.default;

dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.tz.setDefault(dayjs.tz.guess());

// ###########################################################################
// Reference
// https://github.com/MHohenberg/NextTrash

const notifyMessage = `<a href='https://www.awb-bb.de/start.html'>Abfallwirtschaft Böblingen</a>
<p />
<ul>
  <li>Abfuhrtermine</li>
  <li>Stadt/Gemeinde: Nufringen</li>
  <li>[x] Biomüll</li>
  <li>[x] Papier 120l/240l</li>
  <li>[x] Restmüll 120l/240l</li>
  <li>Zeitraum: &lt;Jahr&gt;</li>
  <li>Herunterladen als ICS</li>
  <li>Datei speichern unter /mnt/qnap_linux/data/muell/allestrassennufringen.&lt;Jahr&gt;.ics</li>
</ul>
`;

const icsFileDirectory = '/data';
const icsFilePattern   = /allestrassennufringen\..*\.ics/;
const reportHour       = 17;
const cleanHour        = 8;
const topicMorgen      = 'muell/leerung/morgen';
const topicNaechste    = 'muell/leerung/naechste';

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
  let leerungen = [];

  const files = await fsPromises.readdir(icsFileDirectory);

  for(const file of files) {
    if(icsFilePattern.test(file)) {
      // logger.trace(`Reading ${file}`);

      const icsData       = await fsPromises.readFile(path.join(icsFileDirectory, file), 'utf8');
      let   fileLeerungen = icsToJson(icsData);

      fileLeerungen = _.map(fileLeerungen, leerung => ({
        ...leerung,
        summary:    leerung.summary.replace(' 120l/240l', ''),
      }));

      leerungen = [...leerungen, ...fileLeerungen];
    }
  }

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
    try {
      await sendMail({
        to:      'stefan@heine7.de',
        subject: 'Müll-Kalender aktualisieren',
        html:    notifyMessage,
      });
    } catch(err) {
      logger.error(`Failed to send error mail: ${err.message}`);

      await mqttClient.publishAsync(`mqtt-notify/notify`, JSON.stringify({
        sound:   'none',
        html:    1,
        message: 'Bitte Kalender aktualisieren',
        title:   'Müll-Kalender aktualisieren',
      }));
    }
  }
};

process.on('SIGHUP', () => checkMuell());
process.on('SIGTERM', () => stopProcess());

(async() => {
  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // MQTT

  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

  // #########################################################################
  // Run on startup
  await checkMuell();

  // #########################################################################
  let job;

  // Schedule
  //    ┌────────────────────────── second (optional)
  //    │ ┌──────────────────────── minute
  //    │ │             ┌────────── hour
  //    │ │             │ ┌──────── day of month
  //    │ │             │ │ ┌────── month
  //    │ │             │ │ │ ┌──── day of week (0 is Sunday)
  //    S M             H D M W
  job = new Cron(`0 0 ${reportHour} * * *`, {timezone: 'Europe/Berlin'}, checkMuell);

  // Clean
  job = new Cron(`0 0  ${cleanHour} * * *`, {timezone: 'Europe/Berlin'}, async() => {
    await mqttClient.publishAsync(topicMorgen, null, {retain: true});
  });

  _.noop('Cron job started', job);

  healthInterval = setInterval(async() => {
    await mqttClient.publishAsync(`muell/health/STATE`, 'OK');
  }, ms('1min'));
  await mqttClient.publishAsync(`muell/health/STATE`, 'OK');
})();
