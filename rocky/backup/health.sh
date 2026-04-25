#!/bin/sh

sleep 1

status=$(cat /var/run/backup.status)

/usr/bin/mosquitto_pub -h 192.168.6.5 -t "backup/health/STATE" -m "${status}"
