#!/bin/bash

RESULT=`/bin/certbot renew --webroot --webroot-path=/var/letsencrypt 2>/dev/null`

# echo "$RESULT"

if [ -n "`echo \"$RESULT\" | grep 'heine7\.de.*success'`" ]; then
  echo "certs updated"

  echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate updated\n\nCertificate updated\nTODO restart nginx and dovecot\n" | /usr/sbin/sendmail -t
else
  echo "$RESULT"

#  if [ -n "`echo \"$RESULT\" | grep 'Cert not yet due for renewal'`" ]; then
  if [ -n "`echo \"$RESULT\" | grep 'No renewals were attempted'`" ]; then
    # do nothing
    /bin/true
  else
    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n$RESULT\n" | /usr/sbin/sendmail -t
  fi
fi
