#!/bin/bash

/usr/sbin/postmap /etc/postfix/config/sender_canonical
/usr/sbin/postmap /etc/postfix/config/sasl_password
/usr/sbin/postfix set-permissions 2>/dev/null
/usr/bin/newaliases

# Fix name resolution for postfix running in chroot jail.
cp /etc/resolv.conf /var/spool/postfix/etc/

# Start postfix
chown root /var/spool/postfix/pid
/usr/sbin/postfix start-fg
