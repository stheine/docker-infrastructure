#!/usr/bin/env node

/* eslint-disable camelcase */

import fsPromises            from 'node:fs/promises';
import os                    from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

import _                     from 'lodash';
import babar                 from 'babar';
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
// Constants

const graphDisplayLimit = 100;
const hostname          = os.hostname();

// ###########################################################################
// Globals

let mqttClient;
let vitoBetriebsart;

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
  let betriebsartSpar         = false;
  let letzterBrennerVerbrauch = 0;
  let sunnyHours              = 0;
  let tempAussen              = null;
  let tempInnen               = null;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/vito/vito.json');

  let {lastDrehzahl, reportedFehlerDateTime, reportedLeerung, reportedSpeicher, reportedTempKessel,
    reportedZeit} = status;

  // #########################################################################
  // Signal handler (SIGHUP) to dump current state
  process.on('SIGHUP', async() => {
    logger.debug({
      betriebsartSpar,
      lastDrehzahl,
      letzterBrennerVerbrauch,
      sunnyHours,
      tempAussen,
      tempInnen,
      vitoBetriebsart,
    });
  });

  // #########################################################################
  // Init MQTT
  mqttClient = await mqtt.connectAsync('tcp://192.168.6.5:1883', {clientId: hostname});

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
          const solcastForecasts    = message;
          const now                 = dayjs();
          const nowUtc              = dayjs.utc();
          const midnightTime        = nowUtc.clone().hour(24).minute(0).second(0);
          const todaySeven          = now.clone().hour(7).minute(0).second(0);
          const todayTwelve         = now.clone().hour(12).minute(0).second(0);
          let   estimates           = [];
          let   sunnyEstimates      = [];
          let   newSunnyHours       = 0;
          let   sunnyHoursStartIn   = null;
          let   graphEstimates      = [];
          let   graphSunnyEstimates = [];

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

            graphEstimates.push([(new Date(period_end_date)).getHours() +
              (new Date(period_end_date)).getMinutes() / 100, estimate]);

            if(estimate > 3500) {
              // Estimate is for 30 minute period
              newSunnyHours += 1 / 2;
              sunnyEstimates.push(estimate);

              if(sunnyHoursStartIn === null) {
                sunnyHoursStartIn = _.round((period_end_date - nowUtc) / 3600 / 1000, 1);
              }
            }
          }

          estimates = _.reduceRight(estimates, (result, estimate) => {
            if(estimate || result.length) {
              result.unshift(estimate);
            }

            return result;
          }, []);

          graphEstimates = _.reduceRight(graphEstimates, (result, estimate) => {
            if(estimate[1] > graphDisplayLimit || result.length) {
              result.unshift(estimate);
            }

            return result;
          }, []);
          graphEstimates = _.reduce(graphEstimates, (result, estimate) => {
            if(estimate[1] > graphDisplayLimit || result.length) {
              result.push(estimate);
            }

            return result;
          }, []);

          sunnyEstimates = _.reduceRight(sunnyEstimates, (result, estimate) => {
            if(estimate || result.length) {
              result.unshift(estimate);
            }

            return result;
          }, []);

          sunnyHours = newSunnyHours;

          if(graphEstimates.length > 3) {
            if(graphEstimates.length % 2 === 0) {
              // The estimates graph x-labels look better with an odd number of entries
              graphEstimates.push([_.last(graphEstimates)[0] + 0.3, 0]);
            }

//            logger.debug(babar(graphEstimates, {
//              caption:    'Estimates',
//              color:      'ascii',
//              minX:       graphEstimates[0][0],
//              maxY:       5000,
//              width:      5 + graphEstimates.length * 3,
//              xFractions: 2,
//            }));
          }

          if(vitoBetriebsart === 3) {
            if(sunnyHours >= 4 ||
              tempAussen >= 5  && sunnyHours >= 3 ||
              tempAussen >= 10 && sunnyHours >= 2 ||
              betriebsartSpar && sunnyHours
            ) {
              if(now.isBetween(todaySeven, todayTwelve, 'minute')) {
                if(sunnyHoursStartIn < 1) {
                  logger.info(`Heizung (aussen: ${_.round(tempAussen, 1)}°C, innen: ${tempInnen}°C) ` +
                    `Sparmodus wegen ${sunnyHours} Stunden Sonne`);

                  await mqttClient.publish('vito/cmnd/setHK1BetriebsartSpar', '1', {retain: true});
                } else {
                  logger.info(`Heizung wartet auf Sparmodus wegen Sonne beginnend in ` +
                    `${sunnyHoursStartIn} Stunden`);
                }
              }
            } else if(sunnyHours > 0) {
              // logger.info(`Heizung (aussen: ${_.round(tempAussen, 1)}°C, innen: ${tempInnen}°C) ` +
              //   `Normalmodus wegen ${sunnyHours} Stunden Sonne`);

              if(betriebsartSpar) {
                logger.info(`Heizung (aussen: ${_.round(tempAussen, 1)}°C, innen: ${tempInnen}°C) ` +
                  `zurück zum Normalmodus wegen ${sunnyHours} Stunden Sonne`);

                await mqttClient.publish('vito/cmnd/setHK1BetriebsartSpar', '0', {retain: true});
              }
            } else {
              // logger.info(`Heizung (aussen: ${_.round(tempAussen, 1)}°C, innen: ${tempInnen}°C) ` +
              //   `Normalmodus wegen wenig Sonne`);

              if(betriebsartSpar) {
                logger.info(`Heizung (aussen: ${_.round(tempAussen, 1)}°C, innen: ${tempInnen}°C) ` +
                  `zurück zum Normalmodus wegen ${sunnyHours} Stunden Sonne`);

                await mqttClient.publish('vito/cmnd/setHK1BetriebsartSpar', '0', {retain: true});
              }
            }
          }
          break;
        }

        case 'vito/tele/SENSOR': {
          const {dateTime, error01,
            brennerVerbrauch:   brennerVerbrauchString,
            hk1BetriebsartSpar: betriebsartSparString,
            drehzahlIst:        drehzahlString,
            tempAussen:         tempAussenString,
          } = message;

          betriebsartSpar = Boolean(Number(betriebsartSparString));
          tempAussen      = Number(tempAussenString);
          vitoBetriebsart = Number(message.hk1Betriebsart);

          const {tempKessel}     = message;
          const brennerVerbrauch = Number(brennerVerbrauchString);
          const drehzahl         = Number(drehzahlString);

          const now        = dayjs();
          const twoDaysAgo = dayjs().subtract(2, 'days');
          const stats      = {};

          // logger.info({brennerVerbrauch, dateTime, error01});

          // #######################################################################################
          // Check lambda - to detect the Brenner Beginn
          if(drehzahl && !lastDrehzahl) {
            logger.debug('Brenner Beginn');
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power2', '1'); // Fenster zu (falls es schon auf war)
            await delay(ms('20s'));
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power1', '1'); // Fenster auf
          } else if(!drehzahl && lastDrehzahl) {
            logger.debug('Brenner Ende');
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power2', '1'); // Fenster auf
          }
          lastDrehzahl = drehzahl;

          // #######################################################################################
          // Check Kessel Temperatur - Überhitzung?
          if(tempKessel > 87 && // Codieradresse 06 erlaubt 85 Grad
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

            // logger.info('status', {verbrauchSeitLetzterLeerung, gesamt, brennerVerbrauch, vorrat});

            stats.gesamt = gesamt;
            stats.vorrat = vorrat;

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
          // Publish to mqtt
          if(!_.isEmpty(stats)) {
            await mqttClient.publish('vito/tele/STATS', JSON.stringify(stats), {retain: true});
          }

          // #######################################################################################
          await fsExtra.writeJson('/var/vito/vito.json', {
            lastDrehzahl,
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

  await mqttClient.subscribe('vito/tele/SENSOR');
  await mqttClient.subscribe('Wohnzimmer/tele/SENSOR');
  await mqttClient.subscribe('solcast/forecasts');      // Subscribe the two SENSORs first
})();
