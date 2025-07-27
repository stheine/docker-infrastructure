Backup Strategie

- a300
  - BackInTime, /mnt/qnap_Backup/a300
    - /home/stheine
    - /home/stheine_ot
    - /mnt/qnap_Data/Docs
    - /mnt/qnap_linux
  - BackInTime (root), /mnt/qnap_Backup/a300
    - /etc

- otlaptop1 - TODO

- wyse
  - docker/backup
    - Setup
      - the gpg encryption key is in /mnt/qnap/linux/data/backup/pass
      - the rclone config is in /mnt/qnap/linux/data/backup/rclone.conf
    - General /data
      - loop all directories in /data
      - tar the content into /backup/<dir_timestamp.tgz>
      - encrypt into /backup/<dir_timestamp.tgz.gpg>
      - remove the tarfile
      - rclone all the encrypted files from /backup into pcloud:backup
    - General /data/ALL-data
      - /data/ALL-data mounts the /mnt/qnap/linux/data, having access to all
        container's data. run the same logic, except for some specials
    - Special
      - immich
        direct rclone to the pcloudEncrypted cloud storage
      - nextcloud
        direct rclone to the pcloudEncrypted cloud storage
      - paperless
        Call the paperless document_exporter to create a backup into paperless-export,
        then back up this directory
      - vaultwarden
        create a local backup into vaultwarden-backup, and copy -> Strato HiDrive
      - media_data_docs, /mnt/qnap/Data/Docs
      - media_fotos, /mnt/qnap/Fotos

      - mediawiki
        mediawiki-database-backup -> Strato HiDrive
        TODO in backup container aufnehmen


rclone einrichten fuer 'pcloudEncrypted'
- `docker compose exec backup /bin/bash`
- `rclone config`
- `n` New remote
- `pcloudEncrypted`
- `crypt`
- `pcloud:encrypted`
- `standard` Encrypt the filenames
- `true` Encrypt directory names
- `y` own password
- value from `~/data/backup/pass`
- `n` optional password blank
- `n` no advanced config
- `y` OK
- `q` quit
