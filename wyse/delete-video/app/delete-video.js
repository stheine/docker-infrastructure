#!/usr/bin/env node

import fsPromises from 'node:fs/promises';
import path       from 'node:path';

import cron       from 'croner';
import {logger}   from '@stheine/helpers';
import ms         from 'ms';

const baseDir = '/video/Nachrichten';

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

  // eslint-disable-next-line no-process-exit
  process.exit(0);
};

const deleteVideo = async function() {
  //   \"/root/exports/Sat-Rekorder/Nachrichten\" -type f -  mtime +2 -delete" >> /tmp/crontab.tmp &&
  const files = await fsPromises.readdir(baseDir);
  const now   = Date.now();

  for(const file of files) {
    const stat = await fsPromises.stat(path.join(baseDir, file));

    if(now - stat.mtimeMs > ms('2days')) {
      // logger.info('delete', {file, mtime: stat.mtime});
      if(file.endsWith('.ts')) {
        logger.info(`delete '${file}'`);
      }
      await fsPromises.unlink(path.join(baseDir, file));
    } else {
      // logger.info('keep', {file, mtime: stat.mtime});
    }
  }
};

process.on('SIGTERM', () => stopProcess());

(async() => {
  // #########################################################################
  // Startup
  logger.info(`Startup --------------------------------------------------`);

  // #########################################################################
  // Run on startup
  await deleteVideo();

  // #########################################################################
  // Schedule
  //    ┌─────────────── second (optional)
  //    │ ┌───────────── minute
  //    │ │  ┌────────── hour
  //    │ │  │ ┌──────── day of month
  //    │ │  │ │ ┌────── month
  //    │ │  │ │ │ ┌──── day of week (0 is Sunday)
  //    S M  H D M W
  cron(`0 0 18 * * *`, {timezone: 'Europe/Berlin'}, deleteVideo);
})();
