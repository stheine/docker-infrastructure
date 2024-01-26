#!/bin/bash

if [ ! -f /backup/stratoHiDrive.flag ]; then
  sshfs \
    -o StrictHostKeyChecking=no \
    -o reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,dev,suid \
    stheine@sftp.hidrive.strato.com:/users/stheine/backup/mediawiki-database-backup \
    /backup

  if [ -f /backup/stratoHiDrive.flag ]; then
    echo "$(date +"%Y-%m-%d %H:%M:%S") mounted Strato HiDrive" | tee -a /backup/backup.out
  else
    echo "$(date +"%Y-%m-%d %H:%M:%S") Failed to mounted Strato HiDrive" | tee -a /backup/backup.out
  fi
fi
