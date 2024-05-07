#!/bin/sh

mkdir -p /backup

echo "$(date +"%Y-%m-%d %H:%M:%S") Backup start" | tee -a /backup.log

/usr/local/bin/docker exec docker-paperless-1 document_exporter /export

cd /data

for dir in $(ls -1); do
  echo "$(date +"%Y-%m-%d %H:%M:%S") Backup start: ${dir}" | tee -a /backup.log

  tarFile=/backup/${dir}_$(date +%Y-%m-%d).tgz

  tar -zcf ${tarFile} ${dir} || exit $?

  echo "$(date +"%Y-%m-%d %H:%M:%S") Backup finished: ${dir}" | tee -a /backup.log

  gpg --batch --symmetric --no-symkey-cache --passphrase-file /root/.config/rclone/pass ${tarFile}
  rm ${tarFile}

  echo "$(date +"%Y-%m-%d %H:%M:%S") Backup encrypted: ${dir}" | tee -a /backup.log
done

echo "$(date +"%Y-%m-%d %H:%M:%S") Cloud Copy start" | tee -a /backup.log

find /backup -type f -mtime +5 -exec rm {} \;

rclone copy /backup pcloud:backup

echo "$(date +"%Y-%m-%d %H:%M:%S") Cloud Copy finished" | tee -a /backup.log
