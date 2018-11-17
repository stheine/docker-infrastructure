#!/bin/bash

cd /root/docker/

RESULT=`/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose run --rm certbot /certbot/certbot-auto renew --webroot --webroot-path=/var/letsencrypt 2>/dev/null`

# echo "$RESULT"

if [ -n "`echo \"$RESULT\" | grep 'heine7\.de.*success'`" ]
then
  echo "certs updated"
  /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose kill -s HUP dovecot
  /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose kill -s HUP nginx
else
  echo "$RESULT"
fi
