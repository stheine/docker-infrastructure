#!/bin/sh

cd /mediawiki-images
mkdir -p /backup/images
tar --exclude-vcs -zcf /backup/images/`date +%Y-%m-%d`.tgz . || exit $?

find /backup/images -type f -mtime +5 -exec rm {} \;
