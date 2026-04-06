#!/usr/bin/env node

/* eslint-disable newline-per-chained-call */

import os       from 'node:os';

import dayjs    from 'dayjs';
import mqtt     from 'mqtt';
import timezone from 'dayjs/plugin/timezone.js';
import utc      from 'dayjs/plugin/utc.js';

dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.tz.setDefault(dayjs.tz.guess());

const hostname    = os.hostname();
const topicMorgen = 'muell/leerung/morgen';
const mqttClient  = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

const now       = dayjs.tz();
const start     = now.clone().date(now.date() + 1).hour(0).minute(0).second(0).millisecond(0);
const startDate = start.format('YYYY-MM-DD HH:mm:ss');
const end       = now.clone().date(now.date() + 2).hour(0).minute(0).second(0).millisecond(0);
const endDate   = end.format('YYYY-MM-DD HH:mm:ss');

const leerungenMorgen = [{
  startDate,
  endDate,
  description: 'Restmüll nicht vergessen!',
  location:    'Nufringen',
  summary:     'Restmüll',
}];

await mqttClient.publishAsync(topicMorgen, JSON.stringify(leerungenMorgen), {retain: true});
await mqttClient.endAsync();
