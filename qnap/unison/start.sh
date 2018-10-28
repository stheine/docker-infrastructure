#!/bin/bash

# Disabled syslog and tail for the errors:
# tail: unrecognized file system type 0x794c7630 for ‘/var/log/messages’.
# rsyslogd-2007: action 'action 17' suspended
#
## Start rsyslogd
#/usr/sbin/rsyslogd
#
#if [ $? != 0 ]; then echo "Failed to start rsyslog"; exit 1; fi
#
#sleep 1
## echo "rsyslog started"
#
## Tail the log to the console so it's displayed in the docker logs
#touch /var/log/messages
#tail -F /var/log/messages &

# Start sshd
cat /var/sshd_certs/ssh/id_rsa.pub > /root/.ssh/authorized_keys
cat /var/sshd_certs/ssh/mp3@redwood.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

/usr/sbin/sshd -D &

if [ $? != 0 ]; then echo "Failed to start sshd"; exit 1; fi

sleep 1
# echo "sshd started"

# Monitor the process
while kill -0 "`cat /var/run/sshd.pid`"; do
  sleep 5
done
