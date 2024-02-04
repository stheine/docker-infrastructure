#!/bin/bash

if [ ! -f /backup/stratoHiDrive.flag ]; then
  sshfs \
    -o StrictHostKeyChecking=no \
    -o reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,dev,suid \
    stheine@sftp.hidrive.strato.com:/users/stheine/backup/vaultwarden-backup \
    /backup

  if [ -f /backup/stratoHiDrive.flag ]; then
    echo "$(date +"%Y-%m-%d %H:%M:%S") mounted Strato HiDrive" | tee -a /backup/backup.out
  else
    echo "$(date +"%Y-%m-%d %H:%M:%S") Failed to mounted Strato HiDrive" | tee -a /backup/backup.out

    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: vaultwarden-backup Strato HiDrive mount missing\n\nStrato HiDrive mount missing\n" | /usr/sbin/sendmail -t

    exit 1
  fi
fi

# Create the Backup directory

WEEKDAY=$(date "+%a")
BACKUP_DIR="/backup/${WEEKDAY}"

echo "$(date +"%Y-%m-%d %H:%M:%S") Backup starting into ${BACKUP_DIR}" | tee -a /backup/backup.out

mkdir -p ${BACKUP_DIR}

# Clean remainders of an earlier backup

rm -rf ${BACKUP_DIR}/*

# Force truncating the database write-ahead log file into the database file
# https://www.sqlite.org/pragma.html#pragma_wal_checkpoint

/usr/bin/sqlite3 /data/db.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null

# Create a database dump into the backup dir

/usr/bin/sqlite3 /data/db.sqlite3 ".backup ${BACKUP_DIR}/vaultwarden-backup.sqlite"

# Copy all the files from the data directory into the backup dir

cp -R /data ${BACKUP_DIR}

echo "$(date +"%Y-%m-%d %H:%M:%S") Backup finished" | tee -a /backup/backup.out
