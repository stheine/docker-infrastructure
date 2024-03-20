#!/usr/bin/env node

/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable no-lonely-if */

import {setTimeout as delay} from 'node:timers/promises';
import os                    from 'node:os';

import _                     from 'lodash';
// import babar                 from 'babar';
import dayjs                 from 'dayjs';
import fsExtra               from 'fs-extra';
import isBetween             from 'dayjs/plugin/isBetween.js';
import {logger}              from '@stheine/helpers';
import mqtt                  from 'async-mqtt';
import ms                    from 'ms';
import timezone              from 'dayjs/plugin/timezone.js';
import utc                   from 'dayjs/plugin/utc.js';
// import {sendMail}         from '@stheine/helpers';

dayjs.extend(isBetween);
dayjs.extend(timezone);
dayjs.extend(utc);
dayjs.tz.setDefault(dayjs.tz.guess());

// ###########################################################################
// Constants

// const graphDisplayLimit = 100;
const hostname          = os.hostname();

// ###########################################################################
// Globals

let healthInterval;
let mqttClient;
let vitoBetriebsart;

// ###########################################################################
// Process handling

const stopProcess = async function() {
  if(healthInterval) {
    clearInterval(healthInterval);
    healthInterval = undefined;
  }

  if(mqttClient) {
    await mqttClient.end();
    mqttClient = undefined;
  }

  logger.info(`Shutdown -------------------------------------------------`);

  // eslint-disable-next-line no-process-exit
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
  let verbrauchSeitLetzterLeerung;

  // #########################################################################
  // Startup

  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Read static data

  const status = await fsExtra.readJson('/var/vito/vito.json');

  // #########################################################################
  // Signal handler (SIGHUP) to dump current state
  process.on('SIGHUP', async() => {
    logger.debug({
      betriebsartSpar,
      lastDrehzahl:            status.lastDrehzahl,
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
      } catch(err) {
        logger.error(`Failed to parse mqtt message for '${topic}': ${messageRaw}`, err.message);
        // ignore
      }

      switch(topic) {
        case 'mqtt-vito/ascheGeleert':
          if(!status.ascheGeleert) {
            status.ascheGeleert = [];
          }

          logger.info(`Asche geleert bei ${letzterBrennerVerbrauch} kg`);

          status.ascheGeleert.push(`${dayjs.format('YYYY-MM-DD')} ${letzterBrennerVerbrauch}`);
          break;

        case 'mqtt-vito/pelletsSpeicher':
          if(!status.pelletsSpeicher) {
            status.pelletsSpeicher = [];
          }

          logger.info(`Pellets Nachschub ${message} kg`);

          status.pelletsSpeicher.push(`${dayjs.format('YYYY-MM-DD')} ${message}`);
          break;

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
//          let   graphEstimates      = [];

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

//            graphEstimates.push([new Date(period_end_date).getHours() +
//              new Date(period_end_date).getMinutes() / 100, estimate]);

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

//          graphEstimates = _.reduceRight(graphEstimates, (result, estimate) => {
//            if(estimate[1] > graphDisplayLimit || result.length) {
//              result.unshift(estimate);
//            }
//
//            return result;
//          }, []);
//          graphEstimates = _.reduce(graphEstimates, (result, estimate) => {
//            if(estimate[1] > graphDisplayLimit || result.length) {
//              result.push(estimate);
//            }
//
//            return result;
//          }, []);

          sunnyEstimates = _.reduceRight(sunnyEstimates, (result, estimate) => {
            if(estimate || result.length) {
              result.unshift(estimate);
            }

            return result;
          }, []);

          sunnyHours = newSunnyHours;

//          if(graphEstimates.length > 3 && graphEstimates.length % 2 === 0) {
//            // The estimates graph x-labels look better with an odd number of entries
//            graphEstimates.push([_.last(graphEstimates)[0] + 0.3, 0]);
//
//            logger.debug(babar(graphEstimates, {
//              caption:    'Estimates',
//              color:      'ascii',
//              minX:       graphEstimates[0][0],
//              maxY:       5000,
//              width:      5 + graphEstimates.length * 3,
//              xFractions: 2,
//            }));
//          }

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
          const {
            dateTime,
            error01,
            brennerVerbrauch:   brennerVerbrauchString,
            hk1Betriebsart,
            hk1BetriebsartSpar: betriebsartSparString,
            drehzahlIst:        drehzahlString,
            tempAussen:         tempAussenString,
            tempKessel,
          } = message;

          betriebsartSpar = Boolean(Number(betriebsartSparString));
          tempAussen      = Number(tempAussenString);
          vitoBetriebsart = Number(hk1Betriebsart);

          const brennerVerbrauch = Number(brennerVerbrauchString);
          const drehzahl         = Number(drehzahlString);

          const now        = dayjs();
          const twoDaysAgo = dayjs().subtract(2, 'days');
          const stats      = {};

          // logger.info({brennerVerbrauch, dateTime, error01});

          // #######################################################################################
          // Check lambda - to detect the Brenner Beginn
          if(drehzahl && !status.lastDrehzahl) {
            logger.debug('Brenner Beginn');
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power2', '1'); // Fenster zu (falls es schon auf war)
            await delay(ms('20s'));
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power1', '1'); // Fenster auf
          } else if(!drehzahl && status.lastDrehzahl) {
            logger.debug('Brenner Ende');
            await mqttClient.publish('tasmota/fenstermotor-heizungskeller/cmnd/Power2', '1'); // Fenster auf
          }
          status.lastDrehzahl = drehzahl;

          // #######################################################################################
          // Check Kessel Temperatur - Überhitzung?
          if(tempKessel > 87 && // Codieradresse 06 erlaubt 85 Grad
            (!status.reportedTempKessel || dayjs(status.reportedTempKessel).isBefore(twoDaysAgo))
          ) {
            const notifyTitle   = `Heizung Kessel überhitzt (tempKessel = ${tempKessel}°C)`;
            const notifyMessage = `Heizung Kessel überhitzt (tempKessel = ${tempKessel}°C)`;

            await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
              sound:   'siren',
              html:    1,
              message: notifyMessage,
              title:   notifyTitle,
            }));

            status.reportedTempKessel = now;

//            try {
//              await sendMail({
//                to:      'stefan@heine7.de',
//                subject: notifyTitle,
//                html:    notifyMessage,
//              });
//            } catch(err) {
//              logger.error(`Failed to send error mail: ${err.message}`);
//            }
          } else {
            status.reportedTempKessel = null;
          }

          // #######################################################################################
          // Check neue Fehlermeldung
          // error01: F5 2020-10-05 07:49:20
          const [code, date, time] = error01.split(' ');
          const fehlerDateTime = [date, time].join(' ');

          // Check if this error/timestamp is already reported
          if(status.reportedFehlerDateTime !== fehlerDateTime) {
            await mqttClient.publish(`vito/tele/FEHLER`, JSON.stringify({code, dateTime: fehlerDateTime}));

            const notifyTitle   = `Heizung Störung (${code})`;
            const notifyMessage = `Störung ${code}: ${fehlerDateTime}`;

            await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
              sound:   'siren',
              html:    1,
              message: notifyMessage,
              title:   notifyTitle,
            }));

            status.reportedFehlerDateTime = fehlerDateTime;

//            try {
//              await sendMail({
//                to:      'stefan@heine7.de',
//                subject: notifyTitle,
//                html:    notifyMessage,
//              });
//            } catch(err) {
//              logger.error(`Failed to send error mail: ${err.message}`);
//            }

            if(!status.stoerungen) {
              status.stoerungen = [];
            }

            status.stoerungen.push(`${code}: ${fehlerDateTime}\n`);
          }

          // #######################################################################################
          // Check Asche Verbrauch - Leerung noetig?
          if(brennerVerbrauch !== letzterBrennerVerbrauch) {
            letzterBrennerVerbrauch = brennerVerbrauch;

            const letzteLeerungVerbrauch = Number(status.ascheGeleert.at(-1).split(' ')[1]);

            verbrauchSeitLetzterLeerung = brennerVerbrauch - letzteLeerungVerbrauch;

            // Check Asche Verbrauch - Speicher leer?
            const gesamt      = _.reduce(status.pelletsSpeicher, (summe, line) => {
              const fuellung    = Number(line.split(' ')[1]);
              const gesamtSumme = summe + fuellung;

              return gesamtSumme;
            }, 0);
            const vorrat = gesamt - brennerVerbrauch;

            logger.info('status', {letzteLeerungVerbrauch, verbrauchSeitLetzterLeerung, gesamt, brennerVerbrauch, vorrat});

            stats.gesamt = gesamt;
            stats.vorrat = vorrat;

            if((vorrat < 200 &&
                (!status.reportedSpeicher || dayjs(status.reportedSpeicher).isBefore(twoDaysAgo))
            ) ||
              vorrat < 30
            ) {
              const notifyTitle   = 'Speicher bald leer';
              const notifyMessage =
                `<p>` +
                `Der Pelletsspeicher enhält nur noch etwa ${vorrat} kg.` +
                `<br />` +
                `Nachschub bestellen.` +
                `</p>`;
              const notifyUrl = 'https://heine7.de/vito/pelletsNachschub.sh';
              const notifyUrlTitle = 'Pellets Nachschub';

              await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
                sound:   'none',
                html:    1,
                message: notifyMessage,
                title:   notifyTitle,
                url:       notifyUrl,
                url_title: notifyUrlTitle,
              }));

              status.reportedSpeicher = dayjs();

//              try {
//                await sendMail({
//                  to:      'stefan@heine7.de',
//                  subject: notifyTitle,
//                  html:    notifyMessage +
//                    `<p>` +
//                    `<a href='${notifyUrl}'>${notifyUrlTitle}</a>` +
//                    `</p>`,
//                });
//              } catch(err) {
//                logger.error(`Failed to send error mail: ${err.message}`);
//              }
            }
          }

          if((verbrauchSeitLetzterLeerung > 500 || verbrauchSeitLetzterLeerung > 580) &&
            (!status.reportedLeerung || dayjs(status.reportedLeerung).isBefore(twoDaysAgo)) &&
            !drehzahl
          ) {
            const notifyUrl      = 'https://heine7.de/vito/ascheGeleert.sh';
            const notifyUrlTitle = 'Asche geleert';
            const notifyTitle    = 'Asche leeren';
            const notifyMessage  = `<p>Verbrauch seit letzter Leerung: ${verbrauchSeitLetzterLeerung} kg</p>`;

            setTimeout(async() => {
              await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
                sound:     'none',
                html:      1,
                message:   notifyMessage,
                title:     notifyTitle,
                url:       notifyUrl,
                url_title: notifyUrlTitle,
              }));

              status.reportedLeerung = dayjs();

//              try {
//                await sendMail({
//                  to:      'stefan@heine7.de',
//                  subject: notifyTitle,
//                  html:    notifyMessage +
//                    `<p>` +
//                    `<a href="${notifyUrl}">${notifyUrlTitle}</a>` +
//                    `</p>`;
//                });
//
//              } catch(err) {
//                logger.error(`Failed to send error mail: ${err.message}`);
//              }
            }, ms('2hours'));
          }

          // #######################################################################################
          // Uhrzeit Einstellung prüfen
          // dateTime: 2021-03-01 14:00:23
          const nowCompare = dayjs();
          const vitoDateTime = dayjs(dateTime);

          const diffSeconds = Math.abs(nowCompare.diff(vitoDateTime) / 1000);

          // logger.info(`systemZeit=${nowCompare}   vitoZeit=${vitoDateTime}   zeitDiff=${diffSeconds}`);

          if(diffSeconds > 600 &&
            (!status.reportedZeit || dayjs(status.reportedZeit).isBefore(twoDaysAgo))
          ) {
            logger.warn(`Uhrzeit geht falsch um ${diffSeconds} Sekunden.`);

            const notifyTitle = 'Vito Uhrzeit falsch';
            const notifyMessage =
              `Vito Uhrzeit geht falsch um ${diffSeconds} Sekunden.` +
              `<p>` +
              `vito: ${vitoDateTime}` +
              `<br>` +
              `system: ${nowCompare}`;

            await mqttClient.publish(`mqtt-notify/notify`, JSON.stringify({
              sound:   'none',
              html:    1,
              message: notifyMessage,
              title:   notifyTitle,
            }));

            status.reportedZeit = dayjs();

//            try {
//              await sendMail({
//                to:      'stefan@heine7.de',
//                subject: notifyTitle,
//                html:    notifyMessage,
//              });
//            } catch(err) {
//              logger.error(`Failed to send error mail: ${err.message}`);
//            }
          }

          // #######################################################################################
          // Publish to mqtt
          if(!_.isEmpty(stats)) {
            await mqttClient.publish('vito/tele/STATS', JSON.stringify(stats), {retain: true});
          }

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

      // #######################################################################################
      await fsExtra.writeJson('/var/vito/vito.json', status, {spaces: 2});
    } catch(err) {
      logger.error(err);
      logger.error(`Error while handling '${topic}'`, err.message);
    }
  });

  await mqttClient.subscribe('vito/tele/SENSOR');
  await mqttClient.subscribe('Wohnzimmer/tele/SENSOR');

  await mqttClient.subscribe('mqtt-vito/ascheGeleert');    // Subscribe the two SENSORs first
  await mqttClient.subscribe('mqtt-vito/pelletsSpeicher'); // Subscribe the two SENSORs first
  await mqttClient.subscribe('solcast/forecasts');         // Subscribe the two SENSORs first

  healthInterval = setInterval(async() => {
    await mqttClient.publish(`mqtt-vito/health/STATE`, 'OK');
  }, ms('1min'));
})();
