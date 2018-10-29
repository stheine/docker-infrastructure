#!/bin/sh
# vclient exec script for vito data
# based on  http://openv.wikispaces.com/Datenauswertung+mit+RRDB

mkdir /var/lock/vito-getData.sh 2>/dev/null
if [ $? != 0 ]
then
  exit 1
fi

/vito/vclientLock.sh -f /vito/getVitoData.cmd -t /vito/getVitoData.tmpl -x /vito/_getVitoData.sh

rmdir /var/lock/vito-getData.sh
