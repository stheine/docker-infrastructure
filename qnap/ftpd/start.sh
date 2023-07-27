#!/bin/bash

# shellcheck disable=SC2181

# Read config
password=$(cat /etc/ftpd/password)

# Set account password
echo "foto:${password}" | /usr/sbin/chpasswd

# Start ftpd
touch /var/log/vsftpd.log
/usr/sbin/vsftpd /etc/vsftpd/vsftpd.conf &

if [ $? != 0 ]; then
  echo "$(date +"%Y-%m-%d %H:%M:%S") Failed to start ftpd"
  exit 1
fi

daemon_pid=$!

trap '{
  echo "$(date +"%Y-%m-%d %H:%M:%S") ftpd terminated"

  kill ${daemon_pid}
  kill ${tail_pid}
}' EXIT

echo "$(date +"%Y-%m-%d %H:%M:%S") ftpd started"

tail -f /var/log/vsftpd.log &

tail_pid=$!

# Monitor the process
while kill -0 ${daemon_pid}; do
  sleep 1
done
