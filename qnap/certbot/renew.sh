#!/bin/bash

SUCCESS=0

until [ $SUCCESS ]; do
  RESULT=`/bin/certbot renew --webroot --webroot-path=/var/letsencrypt 2>/tmp/certbot.error`
  RESULT_CODE=${?}

  # echo "${RESULT_CODE} ${RESULT}"

  if [ ${RESULT_CODE} = 0 ]; then
    if [ -n "`echo \"${RESULT}\" | grep 'heine7\.de.*success'`" ]; then
      echo "certs updated"

      echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate updated\n\nCertificate updated\nTODO restart nginx and dovecot\n" | /usr/sbin/sendmail -t
    else
      echo "certs not updated: ${RESULT}"

      if [ -n "`echo \"${RESULT}\" | grep 'No renewals were attempted'`" ]; then
        # do nothing
        /bin/true
      else
        echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n${RESULT}\n" | /usr/sbin/sendmail -t
      fi
    fi

    SUCCESS=1
  else
    ERROR=`cat /tmp/certbot.error`

    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n/bin/certbot result=${RESULT_CODE} ${RESULT}\n${ERROR}\n$(ls -l /bin)\n\n$(ls -l /opt/certbot/bin)\n\n$(ls -l /var)" | /usr/sbin/sendmail -t

    sleep 10
  fi
done
