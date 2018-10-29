#!/bin/sh
# vclient script to check for errors

mkdir /var/lock/checkError.sh 2>/dev/null
if [ $? != 0 ]
then
  exit 1
fi



# Letzten Fehlereintrag prüfen

LAST_ERROR_RAW=`echo "$1" | grep -v -e '^$' -e ':'`
# F5 20 15 10 06 02 13 30 40
CODE=`echo "$LAST_ERROR_RAW" | awk '{ print $1 }'`
if [ -n "$CODE" ]
then
  if [ $CODE != "00" ]
  then
    DATE=`echo "$LAST_ERROR_RAW" | awk '{ print $2$3"-"$4"-"$5" "$7":"$8":"$9 }'`
    touch --date="$DATE" /var/vito/_lastError.time

    if [ /var/vito/_lastError.reported -ot /var/vito/_lastError.time ]
    then
      STOERUNG=`echo "$LAST_ERROR_RAW" | awk '{ print $1 }'`
#      echo "Störung $STOERUNG: $DATE"
      /usr/sbin/sendmail -t <<-EOF
From: vito <technik@heine7.de>
To: stefan@heine7.de
Subject: Heizung Störung ($STOERUNG)
Content-Type: text/html; charset=UTF-8

Störung $STOERUNG: $DATE
EOF

      echo "$STOERUNG: $DATE" >> /var/vito/vitoStoerungen.log

      touch /var/vito/_lastError.reported
    #else
    #  echo "Already reported"
    fi
  fi
else
  /usr/sbin/sendmail -t <<-EOF
From: vito <technik@heine7.de>
To: stefan@heine7.de
Subject: Vito nicht erreichbar
Content-Type: text/html; charset=UTF-8

Vito nicht erreichbar
EOF
fi



# Check Asche Verbrauch

VERBRAUCH_KG=`echo "$2" | sed -e 's/\.000000//'`
LETZTE_LEERUNG_KG=`cat /var/vito/_ascheGeleert.log | tail -1 | awk '{print $2}'`
VERBRAUCH_SEITDEM=`expr $VERBRAUCH_KG - $LETZTE_LEERUNG_KG`
if ([ "$VERBRAUCH_SEITDEM" -gt 500 ] && [ "$VERBRAUCH_SEITDEM" -lt 510 ]) || \
    [ "$VERBRAUCH_SEITDEM" -gt 580 ]
then
  touch --date="`date --iso-8601`" /var/vito/_lastAsche.now
  if [ /var/vito/_lastAsche.reportedPlus2 -ot /var/vito/_lastAsche.now ]
  then
    /usr/sbin/sendmail -t <<-EOF
From: vito <technik@heine7.de>
To: stefan@heine7.de
Subject: Asche leeren
Content-Type: text/html; charset=UTF-8

<p>
Verbrauch seit letzter Leerung: $VERBRAUCH_SEITDEM kg
<br />
Asche leeren.
</p>
<p>
<a href='https://heine7.de/vito/ascheGeleert.sh'>Asche geleert</a>
</p>
EOF
    touch --date="`date --iso-8601 --date '2 days'`" /var/vito/_lastAsche.reportedPlus2
  fi
fi



# Uhrzeit Einstellung prüfen

vitoZeit=`echo "$3" | awk -F ' ' '{print $1$2"-"$3"-"$4" "$6":"$7":"$8}'`
vitoZeitSeconds=`date --date "$vitoZeit" +%s`
systemZeit=`date +'%Y-%m-%d %H:%M:%S'`
systemZeitSeconds=`date +%s`
zeitDiff=`expr $systemZeitSeconds - $vitoZeitSeconds`
if ([ $zeitDiff -lt -60 ] || [ $zeitDiff -gt 60 ])
then
  touch --date="`date --iso-8601`" /var/vito/_uhrzeitFalsch.now
  if ([ ! -f /var/vito/_uhrzeitFalsch.reportedPlus2 ] || [ /var/vito/_uhrzeitFalsch.reportedPlus2 -ot /var/vito/_uhrzeitFalsch.now ])
  then
    /usr/sbin/sendmail -t <<-EOF
From: vito <technik@heine7.de>
To: stefan@heine7.de
Subject: Vito Uhrzeit falsch
Content-Type: text/html; charset=UTF-8

Vito Uhrzeit geht falsch um $zeitDiff Sekunden<p>vito: $vitoZeit<br>system: $systemZeit
EOF
    touch --date="`date --iso-8601 --date '2 days'`" /var/vito/_uhrzeitFalsch.reportedPlus2
  fi
else
  if [ -f /var/vito/_uhrzeitFalsch.now ]
  then
    rm /var/vito/_uhrzeitFalsch.now
  fi
  if [ -f /var/vito/_uhrzeitFalsch.reportedPlus2 ]
  then
    rm /var/vito/_uhrzeitFalsch.reportedPlus2
  fi
fi



rmdir /var/lock/checkError.sh
