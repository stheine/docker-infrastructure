#!/bin/bash

# crontab
# * * * * * /home/stheine/docker/screenResolution.sh
# * * * * * sleep 15 ; /home/stheine/docker/screenResolution.sh
# * * * * * sleep 30 ; /home/stheine/docker/screenResolution.sh
# * * * * * sleep 45 ; /home/stheine/docker/screenResolution.sh

echo >> ~/.screenResolution.log

ID=$(/usr/bin/id -u 2>&1)

# echo "$(date) ${ID}" >> ~/.screenResolution.log

export XDG_RUNTIME_DIR="/run/user/${ID}"

currentRaw=$(wlr-randr --output HDMI-A-1 2>&1)

# echo "$(date) ${currentRaw}" >> ~/.screenResolution.log

current=$(echo "${currentRaw}" | grep current | awk '{print $1}')

# echo "$(date) ${current}" >> ~/.screenResolution.log

if [ "${current}" != '1024x600' ]; then
  echo "$(date) Reset screen resolution (currently ${current})" >> ~/.screenResolution.log

  wlr-randr --output HDMI-A-1 --mode 1024x600 >> ~/.screenResolution.log 2>&1
fi
