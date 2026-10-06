# Backup Strategie

- x300
  - BackInTime, /mnt/qnap_Backup/x300
    - /home/stheine
    - /home/stheine_ot
    - /mnt/qnap_Data/Docs
    - /mnt/qnap_linux
  - BackInTime (root), /mnt/qnap_Backup/x300
    - /etc

- otlaptop1 - TODO

- rocky
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


rclone einrichten fuer 'pcloud' - this is the base for pcloudEncrypted and contains the credentials
- `docker compose exec backup /bin/bash`
- `rclone config`
- `n` New remote
- name: `pcloud`
- storage: `pcloud`
- client_id: `<blank>`
- client_secret: `<blank>`
- advanced: `n` no advanced config
- auto config: `n`
- ON THE LOCAL SYSTEM, execute: `rclone authorize "pcloud"`
- maybe add the parameter: `--no-check-certificate`
- COPY THE RESULTING TOKEN
- config_token: `<paste>`
- complete: `y` OK
- quit: `q` quit

rclone einrichten fuer 'pcloudEncrypted'
- `docker compose exec backup /bin/bash`
- `rclone config`
- `n` New remote
- name: `pcloudEncrypted`
- storage: `crypt`
- remote: `pcloud:encrypted`
- filename_encryption: `standard` Encrypt the filenames
- directory_name_encryption: `true` Encrypt directory names
- password: `y` own password
- password: 2x value from `~/data/backup/pass`
- salt: `n` optional password blank
- advanced: `n` no advanced config
- complete: `y` OK
- quit: `q` quit

# Test pCloud access:

```
rclone lsf --files-only --format tp pcloud:backup/homer
```

# Re-authorize pCloud access:

```
rclone config reconnect pcloud:
```

# Restore

- open https://my.pcloud.com
- navigate to /backup/<folder>
- download the file to restore
- `gpg --batch --decrypt --no-symkey-cache --passphrase-file /mnt/qnap/linux/data/backup/pass <file.gpg> > <file>`

## Paperless

add `--data-only`, if only the database was newly created, but all the files remained.

```
docker exec rocky-paperless-1 document_importer /export
```
