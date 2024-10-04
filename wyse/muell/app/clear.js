#!/usr/bin/env node

import os   from 'node:os';

import mqtt from 'mqtt';

const hostname    = os.hostname();
const topicMorgen = 'muell/leerung/morgen';
const mqttClient  = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

await mqttClient.publishAsync(topicMorgen, null, {retain: true});
await mqttClient.endAsync();
