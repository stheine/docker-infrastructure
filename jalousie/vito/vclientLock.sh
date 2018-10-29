#!/bin/sh

LOCKED=0
while [ $LOCKED = 0 ]
do
  mkdir /var/lock/vclientLock 2>/dev/null
  if [ $? = 0 ]
  then
    LOCKED=1
  else
    sleep 1
  fi
done

/usr/bin/vclient -h vcontrold:3002 $*

rmdir /var/lock/vclientLock
