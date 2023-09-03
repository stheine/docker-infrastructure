#!/bin/bash

SUCCESS=false

echo "$(date +"%Y-%m-%d %H:%M:%S") renew.sh started"

until $(${SUCCESS}); do
  echo "$(date +"%Y-%m-%d %H:%M:%S") Calling certbot renew"

  RESULT=`/usr/bin/certbot renew --webroot --webroot-path=/var/letsencrypt 2>/tmp/certbot.error`
  RESULT_CODE=${?}

  echo "$(date +"%Y-%m-%d %H:%M:%S") certbot renew returned ${RESULT_CODE} ${RESULT}"

  if [ ${RESULT_CODE} = 0 ]; then
    if [ -n "`echo \"${RESULT}\" | grep 'heine7\.de.*success'`" ]; then
      echo "$(date +"%Y-%m-%d %H:%M:%S") certs updated"

      echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate updated\n\nCertificate updated\nTODO restart nginx and dovecot\n\ncd docker\ndocker-compose restart nginx dovecot" | /usr/sbin/sendmail -t
    else
      echo "$(date +"%Y-%m-%d %H:%M:%S") certs not updated: ${RESULT}"

      if [ -n "`echo \"${RESULT}\" | grep 'No renewals were attempted'`" ]; then
        # do nothing
        /bin/true
      else
        echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n${RESULT}\n" | /usr/sbin/sendmail -t
      fi
    fi

    SUCCESS=true
  else
    ERROR=`cat /tmp/certbot.error`

    echo "$(date +"%Y-%m-%d %H:%M:%S") certbot renew failed: ${RESULT_CODE} ${RESULT} ${ERROR}" >&2

    echo -e "From: technik@heine7.de\nTo: technik@heine7.de\nSubject: Certificate update check failed\n\n/usr/bin/certbot result=${RESULT_CODE} ${RESULT}\n${ERROR}\n$(ls -l /bin)\n\n$(ls -l /usr/bin/certbot)\n\n$(ls -l /var)" | /usr/sbin/sendmail -t

    sleep 10
  fi
done

echo "$(date +"%Y-%m-%d %H:%M:%S") renew.sh finished"
