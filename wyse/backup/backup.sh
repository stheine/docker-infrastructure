#!/bin/bash

function log() {
  echo "$(date +"%Y-%m-%d %H:%M:%S") $*" | tee -a /backup.log
}

function backup_dir () {
  dir="$1"

  log "Backup start: ${dir}"

  localDir="/backup/${dir}"
  tarFile="${localDir}/${dir}_$(date +%Y-%m-%d).tgz"
  remoteDir="pcloud:backup/${dir}"

  mkdir -p "${localDir}" \
    || { log "Failed to create ${localDir} directory"; return 1; }

  tar -zcf "${tarFile}" "${dir}" \
    || { log "Failed to tar '${dir}' into ${tarFile}"; return 1; }

  log "Backup finished: ${dir}"

  log "Backup encrypting: ${tarFile}"

  rm -f "${tarFile}.gpg" \
    || { log "Failed to remove encrypted file ${tarFile}.gpg"; return 1; }

  gpg --batch --symmetric --no-symkey-cache --passphrase-file /root/.config/rclone/pass "${tarFile}" \
    || { log "Failed to encrypt '${tarFile}"; return 1; }
  rm "${tarFile}" \
    || { log "Failed to remove '${tarFile}"; return 1; }

  log "Backup encrypted: ${tarFile}"

#  find "${localDir}" -type f -mtime +3 -exec rm {} \; \
#    || { log "Failed to remove old backups"; return 1; }
#
#  log "Removed local old backups in ${localDir}"

  log "Deleting remote old backups in ${remoteDir}"

  rclone mkdir "${remoteDir}" \
    || { log "Failed to create remote dir ${remoteDir}"; return 1; }

  rclone lsf --files-only --format tp "${remoteDir}" | sort | head -n -20 | cut -d';' -f 2 > /tmp/files_to_delete \
    || { log "Failed to get list of files to delete from ${remoteDir}"; return 1; }

  rclone delete --files-from-raw /tmp/files_to_delete "${remoteDir}" \
    || { log "Failed to delete old files from ${remoteDir}"; return 1; }

  log "Cloud Copy start for ${dir}"

  rclone copy "${localDir}" "${remoteDir}" \
    || { log "Failed to copy backups to ${remoteDir}"; return 1; }

  log "Cloud Copy finished for ${dir}"

  rm -rf ${localDir} \
    || { log "Failed to remove local backup ${dir}"; return 1; }
}

function rsync_dir() {
  dir="$1"

  log "Sync start: ${dir}"

  rclone sync "/data_rsync/${dir}" "pcloudEncrypted:${dir}" \
    || { log "Failed to sync directory ${dir}"; return 1; }
}

function backup() {
  log "Backup start"

  mkdir -p /backup \
    || { log "Failed to create /backup directory"; return 1; }

  # ==========================================================================================
  # Specials
  #   -----------------------------------------------------
  #   Paperless
  #   - trigger paperless document_exporter
  #     paperless:/export => docker:/paperless-export => backup:/data/paperless-export
  log "Start paperless document_exporter"

  /usr/local/bin/docker exec docker-paperless-1 document_exporter --delete --no-progress-bar --verbosity 0 /export \
    || { log "Failed to trigger paperless document_exporter"; return 1; }

  log "Finished paperless document_exporter"

  # ==========================================================================================
  # General backup of /data directories
  cd /data

  for dir in $(ls -1); do
    # Special handling
    # - Paperless, see above
    # - NextCloud
    # - Immich
    if [[ "${dir}" =~ ^(immich|nextcloud-backup|nextcloud-data|paperless|paperless-consume)$ ]]; then
      continue
    fi

    backup_dir "${dir}"
  done

  # ==========================================================================================
  # Sync of /data_rsync directories
  cd /data_rsync

  for dir in $(ls -1); do
    rsync_dir "${dir}"
  done
}

FUNCTION=$(declare -f backup)

log "Start"

backup || \
  {
    log "Failed to finalize backup (ret=$?)"
    exit 1
  }

log "Finished"
