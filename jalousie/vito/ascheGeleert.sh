#!/bin/sh
# vclient script um die aktuellen Verbrauch als 'ascheGeleert' zu speichern.

cd /vito

VERBRAUCH_OUT=`/vito/vclientLock.sh -f ascheGeleert.cmd`
VERBRAUCH_KG=`echo $VERBRAUCH_OUT | awk '{ print $2 }' | sed -e 's/\.000000//'`

TODAY=`date --iso-8601`
echo "$TODAY $VERBRAUCH_KG" >> /var/vito/_ascheGeleert.log
