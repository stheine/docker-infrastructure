#!/bin/bash

cd /mnt/mybook_data/linux/docker

RESULT=`/usr/local/bin/docker-compose run --rm certbot /certbot/certbot-auto renew --webroot --webroot-path=/var/letsencrypt 2>/dev/null`

# echo "$RESULT"

if [ -n "`echo \"$RESULT\" | grep 'heine7\.de.*success'`" ]
then
  echo "certs updated"
  /usr/local/bin/docker-compose kill -s HUP dovecot
  /usr/local/bin/docker-compose kill -s HUP nginx
fi
