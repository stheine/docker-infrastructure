#!/bin/bash

function log() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") $*" | tee -a /backup.log
}

# Create the Backup directory

WEEKDAY=$(date "+%a")
BACKUP_DIR="/backup/${WEEKDAY}"

log "Backup starting into ${BACKUP_DIR}"

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

log "Backup finished"


# Copy the backup to the Strato HiDrive

mkdir -p /backup-strato

if [ ! -f /backup-strato/stratoHiDrive.flag ]; then
  sshfs \
    -o StrictHostKeyChecking=no \
    -o reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,dev,suid \
    stheine@sftp.hidrive.strato.com:/users/stheine/backup/vaultwarden-backup \
    /backup-strato

  if [ -f /backup-strato/stratoHiDrive.flag ]; then
    log "Mounted Strato HiDrive"
  else
    log "Failed to mounted Strato HiDrive"

    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: vaultwarden-backup Strato HiDrive mount missing\n\nStrato HiDrive mount missing\n" | /usr/sbin/sendmail -t

    exit 1
  fi
fi

log "Copy backup to Strato HiDrive"

rsync -a /backup /backup-strato

log "Copy finished"
