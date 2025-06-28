#!/usr/bin/env node

import os        from 'node:os';

import check     from 'check-types-2';
import dnsSocket from 'dns-socket';
import {logger}  from '@stheine/helpers';
import mqtt      from 'mqtt';
import ms        from 'ms';

// Konfiguration
const dnsServers = [
  '8.8.8.8',        // Google DNS
  '1.1.1.1',        // Cloudflare DNS
  '9.9.9.9',        // Quad9 DNS
  '208.67.222.222', // Open DNS
  '94.140.14.14',   // Adguard DNS
];

// ###########################################################################
// Globals

let   checkInterval;
let   dns;
let   healthInterval;
const hostname        = os.hostname();
let   mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(checkInterval) {
    clearInterval(checkInterval);
    checkInterval = undefined;
  }

  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  dns.destroy();
  dns = undefined;

  await mqttClient.endAsync();
  mqttClient = undefined;

  logger.info(`Shutdown -------------------------------------------------`);
};

process.on('SIGTERM', () => stopProcess());

const testDnsServer = function(server) {
  return new Promise(resolve => {
    dns.query({
      questions: [{
        type: 'A',
        name: 'google.com',
      }],
    }, 53, server, (err, response) => {
      try {
        check.assert.null(err, err?.message);

        check.assert.nonEmptyObject(response);
        check.assert.equal(response.type, 'response');
        check.assert.equal(response.rcode, 'NOERROR');
        check.assert.nonEmptyArray(response.answers);
        check.assert.nonEmptyObject(response.answers.at(0));
        check.assert.equal(response.answers.at(0).name, 'google.com');
        check.assert.equal(response.answers.at(0).type, 'A');
        check.assert.nonEmptyString(response.answers.at(0).data);

        // logger.debug('query success', response);

        return resolve(true);
      } catch(checkErr) {
        logger.debug('query failed', checkErr.message);

        return resolve(false);
      }
    });
  });
};

const checkDnsServers = async function() {
  const results = await Promise.all(dnsServers.map(server => testDnsServer(server)));
  const unavailableCount = results.filter(res => res === false).length;

  if(unavailableCount) {
    logger.debug(`Nicht verfügbare DNS-Server: ${unavailableCount} / ${dnsServers.length}`);
  }

  if(unavailableCount >= dnsServers.length - 1) {
    await mqttClient.publishAsync('dns/failed', `${unavailableCount} DNS-Server sind nicht erreichbar.`);

    logger.debug(`MQTT-Nachricht gesendet: ${unavailableCount} DNS-Server sind nicht erreichbar.`);
  }
};

// ###########################################################################
// Main

// #########################################################################
// Startup

logger.info(`Startup --------------------------------------------------`);

// #########################################################################
// DNS

dns = dnsSocket({maxRedirects: 0, retries: 0, timeout: ms('1s')});

// #########################################################################
// MQTT

mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

checkDnsServers();

checkInterval = setInterval(checkDnsServers, ms('1m'));

healthInterval = setInterval(async() => {
  await mqttClient.publishAsync('fritz/health/STATE', 'OK');
}, ms('1min'));

await mqttClient.publishAsync('fritz/health/STATE', 'OK');
