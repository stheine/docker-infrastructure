#!/bin/bash

# echo "starting start.sh"
# ls -l /var/run
rm -f /run/pigpio.pid
/usr/local/bin/pigpiod -g
# echo "pigpiod terminated with $?"
