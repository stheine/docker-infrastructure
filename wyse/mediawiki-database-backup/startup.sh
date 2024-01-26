#!/bin/sh

cat /var/sshd_certs/wyse > /root/.ssh/id_rsa
chmod 600 /root/.ssh/id_rsa

echo "$(date +'%Y-%m-%d %H:%M:%S') mediawiki-database-backup cron startup"
