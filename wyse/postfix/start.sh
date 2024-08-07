#!/bin/bash

/usr/sbin/postmap /etc/postfix/creds/sender_canonical
/usr/sbin/postmap /etc/postfix/creds/sasl_password
/usr/sbin/postfix set-permissions 2>/dev/null
/usr/bin/newaliases

# Fix name resolution for postfix running in chroot jail.
cp /etc/resolv.conf /var/spool/postfix/etc/

# Start rsyslogd
/usr/sbin/rsyslogd

if [ $? != 0 ]; then echo "Failed to start rsyslog"; exit 1; fi

sleep 1
# echo "rsyslog started"

# Start postfix
chown root /var/spool/postfix/pid
/usr/sbin/postfix start

if [ $? != 0 ]; then echo "Failed to start postfix"; exit 1; fi

sleep 1
# echo "postfix started"

# Tail the log to the console so it's displayed in the docker logs
tail -F /var/log/mail.log &

# Monitor the process
while kill -0 "`cat /var/spool/postfix/pid/master.pid`"; do
  sleep 5
done
