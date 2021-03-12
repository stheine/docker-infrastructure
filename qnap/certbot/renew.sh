#!/bin/bash

# Note on sendmail
# The version in /usr/sbin/sendmail uses the qnap build-in mail mechanism, while
# the version in /share/linux/tools/busybox/sendmail uses the postfix running on port 53.

cd /root/docker/

RESULT=`/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose exec certbot /usr/bin/certbot renew --webroot --webroot-path=/var/letsencrypt 2>/dev/null`

# echo "$RESULT"

if [ -n "`echo \"$RESULT\" | grep 'heine7\.de.*success'`" ]; then
  echo "certs updated"
  /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose kill -s HUP dovecot
  /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker-compose kill -s HUP nginx

  echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate updated\n\nCertificate updated\n" | /share/linux/tools/busybox/sendmail -t
else
  echo "$RESULT"

#  if [ -n "`echo \"$RESULT\" | grep 'Cert not yet due for renewal'`" ]; then
  if [ -n "`echo \"$RESULT\" | grep 'No renewals were attempted'`" ]; then
    // do nothing
  else
    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n$RESULT\n" | /share/linux/tools/busybox/sendmail -t
  fi
fi
