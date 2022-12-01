#!/usr/bin/env node

/* eslint-disable camelcase */

import {setTimeout as delay} from 'timers/promises';
import fsPromises            from 'fs/promises';

import _                     from 'lodash';
import dayjs                 from 'dayjs';
import fsExtra               from 'fs-extra';
import isBetween             from 'dayjs/plugin/isBetween.js';
import mqtt                  from 'async-mqtt';
import ms                    from 'ms';
import utc                   from 'dayjs/plugin/utc.js';
import timezone              from 'dayjs/plugin/timezone.js';

import logger                from './logger.js';
import {sendMail}            from './mail.js';

dayjs.extend(isBetween);
dayjs.extend(timezone);
dayjs.extend(utc);
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
  let tempAussen              = null;
  let tempInnen               = null;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/vito/vito.json');

  let {/* lastLambdaO2, */ reportedFehlerDateTime, reportedLeerung, reportedSpeicher, reportedTempKessel, reportedZeit} = status;

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.7:1883');

  // #########################################################################
  // Register MQTT events

  mqttClient.on('connect',    ()  => logger.info('mqtt.connect'));
  mqttClient.on('reconnect',  ()  => logger.info('mqtt.reconnect'));
  mqttClient.on('close',      ()  => _.noop() /* logger.info('mqtt.close') */);
  mqttClient.on('disconnect', ()  => logger.info('mqtt.disconnect'));
  mqttClient.on('offline',    ()  => logger.info('mqtt.offline'));
  mqttClient.on('error',      err => logger.info('mqtt.error', err));
  mqttClient.on('end',        ()  => _.noop() /* logger.info('mqtt.end') */);

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
        case 'solcast/forecasts': {
          const solcastForecasts  = message;
          const now               = dayjs();
          const nowUtc            = dayjs.utc();
          const midnightTime      = nowUtc.clone().hour(24).minute(0).second(0);
          const todaySeven        = now.clone().hour(7).minute(0).second(0);
          const todayTwelve       = now.clone().hour(12).minute(0).second(0);
          const estimates         = [];
          const sunnyEstimates    = [];
          let   sunnyHours        = 0;
          let   sunnyHoursStartIn = null;

          if(tempAussen === null || tempInnen === null) {
            let retries = 60;

            do {
              retries--;

              let log = 'solcast/forecasts. ';

              if(tempAussen === null) {
                log += 'Waiting for tempAussen. ';
              }
              if(tempInnen === null) {
                log += 'Waiting for tempInnen. ';
              }
              if(tempAussen !== null && tempInnen !== null) {
                retries = 0;
              }
              if(retries) {
                logger.debug(log);

                await delay(ms('10s'));
              }
            } while(retries);

            if(tempAussen === null || tempInnen === null) {
              return;
            }
          }

          if(!now.isBetween(todaySeven, todayTwelve, 'minute')) {
            return;
          }

          for(const forecast of solcastForecasts) {
            const {period_end} = forecast;
            const period_end_date = Date.parse(period_end);

            if(period_end_date < nowUtc) {
              // Already passed
              continue;
            }
            if(period_end_date > midnightTime) {
              // Tomorrow
              continue;
            }

            let {pv_estimate90: estimate} = forecast;

            estimate = _.round(estimate * 1000); // kW to watt

            estimates.push(estimate);

            if(estimate > 3500) {
              // Estimate is for 30 minute period
              sunnyHours += 1 / 2;
              sunnyEstimates.push(estimate);

              if(sunnyHoursStartIn === null) {
                sunnyHoursStartIn = _.round((period_end_date - nowUtc) / 3600 / 1000, 1);
              }
            }
          }

          if(sunnyHours > 4 || tempAussen > 10 && sunnyHours > 2) {
            if(sunnyHoursStartIn < 1) {
              await mqttClient.publish('vito/cmnd/setHK1BetriebsartSpar', '1');

              logger.info(`Heizung (aussen: ${tempAussen}°C, innen: ${tempInnen}°C) Sparmodus wegen ` +
                `${sunnyHours} Stunden Sonne: ${sunnyEstimates.join(',')} beginnend in ` +
                `${sunnyHoursStartIn} Stunden`);

//            await sendMail({
//              to:      'stefan@heine7.de',
//              subject: `Heizung Sparmodus wegen ${sunnyHours} Stunden Sonne`,
//              html:    `Heizung Sparmodus wegen ${sunnyHours} Stunden Sonne<p>${sunnyEstimates.join(',')}`,
//            });
            } else {
              logger.info(`Heizung wartet auf Sparmodus wegen Sonne beginnend in ` +
                `${sunnyHoursStartIn} Stunden`);
            }
          } else if(sunnyHours > 0) {
            logger.info(`Heizung (aussen: ${tempAussen}°C, innen: ${tempInnen}°C) Normalmodus wegen ` +
              `${sunnyHours} Stunden Sonne: ${sunnyEstimates.join(',')}`);
          } else {
            logger.info(`Heizung (aussen: ${tempAussen}°C, innen: ${tempInnen}°C) Normalmodus wegen ` +
              `keine Sonne: ${estimates.join(',')}`);
          }
          break;
        }

        case 'vito/tele/SENSOR': {
          const {brennerVerbrauch: brennerVerbrauchString, dateTime, error01 /* , lambdaO2: lambdaO2String */} = message;

          ({tempAussen} = message);

          const {tempKessel} = message;
          const now = dayjs();
          const brennerVerbrauch = Number(brennerVerbrauchString);
//          const lambdaO2         = Number(lambdaO2String);
          const twoDaysAgo = dayjs().subtract(2, 'days');

          // logger.info({brennerVerbrauch, dateTime, error01});

          // #######################################################################################
//          // Check lambda - to detect the Brenner Beginn
//          if(lambdaO2 && !lastLambdaO2) {
//            await sendMail({
//              to:      'stefan@heine7.de',
//              subject: `Heizung Brenner Beginn`,
//              html:    `Heizung Brenner Beginn`,
//            });
//          }
//          lastLambdaO2 = lambdaO2;

          // #######################################################################################
          // Check Kessel Temperatur - Überhitzung?
          if(tempKessel > 80 &&
            (!reportedTempKessel || dayjs(reportedTempKessel).isBefore(twoDaysAgo))
          ) {
            try {
              await sendMail({
                to:      'stefan@heine7.de',
                subject: `Heizung Kessel überhitzt (tempKessel = ${tempKessel}°C)`,
                html:    `Heizung Kessel überhitzt (tempKessel = ${tempKessel}°C)`,
              });

              reportedTempKessel = now;
            } catch(err) {
              logger.error(`Failed to send error mail: ${err.message}`);
            }
          } else {
            reportedTempKessel = null;
          }

          // #######################################################################################
          // Check neue Fehlermeldung
          // error01: F5 2020-10-05 07:49:20
          const [code, date, time] = error01.split(' ');
          const fehlerDateTime = [date, time].join(' ');

          // Check if this error/timestamp is already reported
          if(reportedFehlerDateTime !== fehlerDateTime) {
            await mqttClient.publish(`vito/tele/FEHLER`, JSON.stringify({code, dateTime: fehlerDateTime}));

            try {
              await sendMail({
                to:      'stefan@heine7.de',
                subject: `Heizung Störung (${code})`,
                html:    `Störung ${code}: ${fehlerDateTime}`,
              });

              reportedFehlerDateTime = fehlerDateTime;
            } catch(err) {
              logger.error(`Failed to send error mail: ${err.message}`);
            }

            await fsPromises.appendFile('/var/vito/vitoStoerungen.log', `${code}: ${fehlerDateTime}\n`);
          }

          // #######################################################################################
          // Check Asche Verbrauch - Leerung noetig?
          if(brennerVerbrauch !== letzterBrennerVerbrauch) {
            letzterBrennerVerbrauch = brennerVerbrauch;

            const leerungenRaw = await fsPromises.readFile('/var/vito/_ascheGeleert.log', 'utf8');
            const leerungen     = leerungenRaw.split('\n');
            const letzteLeerung = _.last(_.compact(leerungen));
            const letzteLeerungVerbrauch = Number(letzteLeerung.split(' ')[1]);
            const verbrauchSeitLetzterLeerung = brennerVerbrauch - letzteLeerungVerbrauch;

            if(((verbrauchSeitLetzterLeerung > 500 && verbrauchSeitLetzterLeerung < 510) ||
              verbrauchSeitLetzterLeerung > 580) &&
              (!reportedLeerung || dayjs(reportedLeerung).isBefore(twoDaysAgo))
            ) {
              try {
                await sendMail({
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
                    `<br />` +
                    `<a href="https://heine7.de/vito/ascheGeleert.sh">Asche geleert</a>` +
                    `</p>`,
                });

                reportedLeerung = dayjs();
              } catch(err) {
                logger.error(`Failed to send error mail: ${err.message}`);
              }
            }

            // Check Asche Verbrauch - Speicher leer?
            const speicherRaw = await fsPromises.readFile('/var/vito/_pelletsSpeicher.log', 'utf8');
            const speicher    = _.compact(speicherRaw.split('\n'));
            const gesamt      = _.reduce(speicher, (summe, line) => {
              const fuellung    = Number(line.split(' ')[1]);
              const gesamtSumme = summe + fuellung;

              return gesamtSumme;
            }, 0);
            const vorrat = gesamt - brennerVerbrauch;

            logger.info('status', {verbrauchSeitLetzterLeerung, gesamt, brennerVerbrauch, vorrat});

            if((vorrat < 200 &&
                (!reportedSpeicher || dayjs(reportedSpeicher).isBefore(twoDaysAgo))
            ) ||
              vorrat < 30
            ) {
              try {
                await sendMail({
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

          // #######################################################################################
          // Uhrzeit Einstellung prüfen
          // dateTime: 2021-03-01 14:00:23
          const nowCompare = dayjs();
          const vitoDateTime = dayjs(dateTime);

          const diffSeconds = Math.abs(nowCompare.diff(vitoDateTime) / 1000);

          // logger.info(`systemZeit=${nowCompare}   vitoZeit=${vitoDateTime}   zeitDiff=${diffSeconds}`);

          if(diffSeconds > 600 &&
            (!reportedZeit || dayjs(reportedZeit).isBefore(twoDaysAgo))
          ) {
            logger.warn(`Uhrzeit geht falsch um ${diffSeconds} Sekunden.`);

            try {
              await sendMail({
                to:      'stefan@heine7.de',
                subject: 'Vito Uhrzeit falsch',
                html:
                  `Vito Uhrzeit geht falsch um ${diffSeconds} Sekunden.` +
                  `<p>` +
                  `vito: ${vitoDateTime}` +
                  `<br>` +
                  `system: ${nowCompare}`,
              });

              reportedZeit = dayjs();
            } catch(err) {
              logger.error(`Failed to send error mail: ${err.message}`);
            }
          }

          // #######################################################################################
          await fsExtra.writeJson('/var/vito/vito.json', {
//            lastLambdaO2,
            reportedFehlerDateTime,
            reportedLeerung,
            reportedSpeicher,
            reportedTempKessel,
            reportedZeit,
          }, {spaces: 2});
          break;
        }

        case 'Wohnzimmer/tele/SENSOR': {
          ({temperature: tempInnen} = message);

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

  await mqttClient.subscribe('solcast/forecasts');
  await mqttClient.subscribe('vito/tele/SENSOR');
  await mqttClient.subscribe('Wohnzimmer/tele/SENSOR');
})();
