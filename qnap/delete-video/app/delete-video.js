#!/usr/bin/env node

import fsPromises from 'fs/promises';
import path       from 'path';

import cron       from 'croner';
import ms         from 'ms';

import logger     from './logger.js';

const baseDir = '/video/Nachrichten';

// ###########################################################################
// Process handling

const stopProcess = async function() {
  logger.info(`Shutdown -------------------------------------------------`);

  process.exit(0);
};

const deleteVideo = async function() {
  //   \"/root/exports/Sat-Rekorder/Nachrichten\" -type f -  mtime +2 -delete" >> /tmp/crontab.tmp &&
  const files = await fsPromises.readdir(baseDir);
  const now   = Date.now();

  for(const file of files) {
    const stat = await fsPromises.stat(path.join(baseDir, file));

    if(now - stat.mtimeMs > ms('2days')) {
      logger.info('delete', {file, mtime: stat.mtime});
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
