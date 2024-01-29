#!/bin/sh

cat /var/sshd_certs/qnap > /root/.ssh/id_rsa
chmod 600 /root/.ssh/id_rsa

echo "$(date +'%Y-%m-%d %H:%M:%S') vaultwarden-backup cron startup"
