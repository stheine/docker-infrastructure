#!/usr/bin/env node

import _           from 'lodash';
import fsExtra     from 'fs-extra';
import dayjs       from 'dayjs';
import mqtt        from 'async-mqtt';
import nodemailer  from 'nodemailer';
import utc         from 'dayjs/plugin/utc.js';
import timezone    from 'dayjs/plugin/timezone.js';

import logger      from './logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(dayjs.tz.guess());

// ###########################################################################
// Globals

let mqttClient;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

process.on('SIGTERM', () => stopProcess());

(async() => {
  // Globals
  let letzterBrennerVerbrauch = 0;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/vito/vito.json');

  let {reportedFehlerDateTime, reportedLeerung, reportedSpeicher, reportedZeit} = status;

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => logger.info('mqtt.close'));
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => logger.info('mqtt.end'));

  mqttClient.on('message', async(topic, messageBuffer) => {
    const messageRaw = messageBuffer.toString();

    try {
      let message;

      try {
        message = JSON.parse(messageRaw);
      } catch(errParse) {
        logger.error(`Failed to parse mqtt message for '${topic}': ${messageRaw}`, errParse.message);
        // ignore
      }

      switch(topic) {
        case 'vito/tele/SENSOR': {
          const {brennerVerbrauch, dateTime, error01} = message;
          const twoDaysAgo = dayjs().subtract(2, 'days');

          // logger.info({brennerVerbrauch, dateTime, error01});

          // Check neue Fehlermeldung
          // error01: F5 2020-10-05 07:49:20
          const [code, date, time] = error01.split(' ');
          const fehlerDateTime = [date, time].join(' ');

          // Check if this error/timestamp is already reported
          if(reportedFehlerDateTime !== fehlerDateTime) {
            await mqttClient.publish(`vito/tele/FEHLER`, JSON.stringify({code, dateTime: fehlerDateTime}));

            try {
              const transport = nodemailer.createTransport({
                host:   'postfix',
                port:   25,
                secure: false,
                tls:    {rejectUnauthorized: false},
              });

              await transport.sendMail({
                to:      'stefan@heine7.de',
                subject: `Heizung Störung (${code})`,
                html:    `Störung ${code}: ${fehlerDateTime}`,
              });

              reportedFehlerDateTime = fehlerDateTime;
            } catch(err) {
              logger.error(`Failed to send error mail: ${err.message}`);
            }
          }

          if(Number(brennerVerbrauch) !== letzterBrennerVerbrauch) {
            letzterBrennerVerbrauch = Number(brennerVerbrauch);

            // Check Asche Verbrauch - Leerung noetig?
            // brennerVerbrauch: 30290
            const leerungenRaw = await fsExtra.readFile('/var/vito/_ascheGeleert.log', 'utf8');
            const leerungen     = leerungenRaw.split('\n');
            const letzteLeerung = _.last(_.compact(leerungen));
            const letzteLeerungVerbrauch = letzteLeerung.split(' ')[1];
            const verbrauchSeitLetzterLeerung = Number(brennerVerbrauch) - Number(letzteLeerungVerbrauch);

            logger.info({verbrauchSeitLetzterLeerung});

            if(((verbrauchSeitLetzterLeerung > 500 && verbrauchSeitLetzterLeerung < 510) ||
              verbrauchSeitLetzterLeerung > 580) &&
              (!reportedLeerung || dayjs(reportedLeerung).isBefore(twoDaysAgo))
            ) {
              try {
                const transport = nodemailer.createTransport({
                  host:   'postfix',
                  port:   25,
                  secure: false,
                  tls:    {rejectUnauthorized: false},
                });

                await transport.sendMail({
                  to:      'stefan@heine7.de',
                  subject: 'Asche leeren',
                  html:
                    `<p>` +
                    `Verbrauch seit letzter Leerung: ${verbrauchSeitLetzterLeerung} kg` +
                    `<br />` +
                    `Asche leeren.` +
                    `</p>` +
                    `<p>` +
                    `<form method="post" action="https://heine7.de/vito/ascheGeleert.sh">` +
                    `<input type="submit" value="Asche geleert" />` +
                    `</form>` +
                    `</p>`,
                });

                reportedLeerung = dayjs();
              } catch(err) {
                logger.error(`Failed to send error mail: ${err.message}`);
              }
            }

            // Check Asche Verbrauch - Speicher leer?
            // brennerVerbrauch: 30290
            const speicherRaw = await fsExtra.readFile('/var/vito/_pelletsSpeicher.log', 'utf8');
            const speicher    = _.compact(speicherRaw.split('\n'));
            const gesamt      = _.reduce(speicher, (summe, line) => {
              const fuellung    = Number(line.split(' ')[1]);
              const gesamtSumme = summe + fuellung;

              return gesamtSumme;
            }, 0);
            const vorrat = gesamt - Number(brennerVerbrauch);

            logger.info({gesamt, brennerVerbrauch, vorrat});

            if((vorrat < 200 &&
                (!reportedSpeicher || dayjs(reportedSpeicher).isBefore(twoDaysAgo))
            ) ||
              vorrat < 30
            ) {
              try {
                const transport = nodemailer.createTransport({
                  host:   'postfix',
                  port:   25,
                  secure: false,
                  tls:    {rejectUnauthorized: false},
                });

                await transport.sendMail({
                  to:      'stefan@heine7.de',
                  subject: 'Speicher bald leer',
                  html:
                    `<p>` +
                    `Der Pelletsspeicher enhält nur noch etwa ${vorrat} kg.` +
                    `<br />` +
                    `Nachschub bestellen.` +
                    `</p>` +
                    `<p>` +
                    `<a href='https://heine7.de/vito/pelletsNachschub.sh'>Pellets Nachschub</a>` +
                    `</p>`,
                });

                reportedSpeicher = dayjs();
              } catch(err) {
                logger.error(`Failed to send error mail: ${err.message}`);
              }
            }
          }

          // Uhrzeit Einstellung prüfen
          // dateTime: 2021-03-01 14:00:23
          const now = dayjs();
          const vitoDateTime = dayjs(dateTime);

          const diffSeconds = Math.abs(now.diff(vitoDateTime) / 1000);

          // logger.info(`systemZeit=${now}   vitoZeit=${vitoDateTime}   zeitDiff=${diffSeconds}`);

          if(diffSeconds > 60 &&
            (!reportedZeit || dayjs(reportedZeit).isBefore(twoDaysAgo))
          ) {
            try {
              const transport = nodemailer.createTransport({
                host:   'postfix',
                port:   25,
                secure: false,
                tls:    {rejectUnauthorized: false},
              });

              await transport.sendMail({
                to:      'stefan@heine7.de',
                subject: 'Vito Uhrzeit falsch',
                html:
                  `Vito Uhrzeit geht falsch um ${diffSeconds} Sekunden.` +
                  `<p>` +
                  `vito: ${vitoDateTime}` +
                  `<br>` +
                  `system: ${now}`,
              });

              reportedZeit = dayjs();
            } catch(err) {
              logger.error(`Failed to send error mail: ${err.message}`);
            }
          }

          await fsExtra.writeJson('/var/vito/vito.json', {
            reportedFehlerDateTime,
            reportedLeerung,
            reportedSpeicher,
            reportedZeit
          }, {spaces: 2});
          break;
        }

        default:
          logger.error(`Unhandled topic '${topic}'`, messageRaw);
          break;
      }
    } catch(err) {
      logger.error(`Error while handling '${topic}'`, err.message);
    }
  });

  await mqttClient.subscribe('vito/tele/SENSOR');
})();
