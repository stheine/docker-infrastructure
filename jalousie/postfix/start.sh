#!/bin/bash

cp /postfix_creds/* /etc/postfix/creds/
/usr/sbin/postmap /etc/postfix/creds/sender_canonical
/usr/sbin/postmap /etc/postfix/creds/sasl_password
/usr/sbin/postfix set-permissions 2>/dev/null
/usr/bin/newaliases

# Start rsyslogd
/usr/sbin/rsyslogd

if [ $? != 0 ]; then echo "Failed to start rsyslog"; exit 1; fi

sleep 1
# echo "rsyslog started"

# Tail the log to the console so it's displayed in the docker logs
touch /var/log/maillog
tail -F /var/log/maillog &

# Start postfix
chown root /var/spool/postfix/pid
/usr/sbin/postfix start

if [ $? != 0 ]; then echo "Failed to start postfix"; exit 1; fi

sleep 1
# echo "postfix started"

# Monitor the process
while kill -0 "`cat /var/spool/postfix/pid/master.pid`"; do
  sleep 5
done
