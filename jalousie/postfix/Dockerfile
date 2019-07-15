FROM arm32v6/alpine:3.10

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    tzdata && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

# ##############################################################################
# Configure and run postfix

RUN \
  apk add postfix cyrus-sasl-digestmd5 mailx rsyslog && \
  /usr/sbin/postconf -e 'inet_interfaces = all' && \
  /usr/sbin/postconf -e 'myhostname = pi3.heine7.de' && \
  /usr/sbin/postconf -e 'mynetworks = 172.0.0.0/8, 192.168.0.0/16, 127.0.0.0/8' && \
  /usr/sbin/postconf -e 'relayhost = [smtp.strato.de]:465' && \
  /usr/sbin/postconf -e 'sender_canonical_maps = hash:/etc/postfix/creds/sender_canonical' && \
  /usr/sbin/postconf -e 'smtp_generic_maps = hash:/etc/postfix/generic' && \
  /usr/sbin/postconf -e 'smtp_sasl_auth_enable = yes' && \
  /usr/sbin/postconf -e 'smtp_sasl_security_options = noplaintext noanonymous' && \
  /usr/sbin/postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/creds/sasl_password' && \
  /usr/sbin/postconf -e 'smtp_tls_security_level = encrypt' && \
  /usr/sbin/postconf -e 'smtp_tls_wrappermode = yes' && \
  /usr/sbin/postconf -e 'smtputf8_enable = no' && \
  mkdir /etc/postfix/creds && \
  echo "pirate@pi-docker	stefan@heine7.de" >> /etc/postfix/generic && \
  echo "root@pi-docker	stefan@heine7.de" >> /etc/postfix/generic && \
  echo "root@raspi-vito	technik@heine7.de" >> /etc/postfix/generic && \
  postmap /etc/postfix/generic

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

COPY start.sh /
CMD /start.sh

EXPOSE 25
VOLUME /postfix_creds

# echo -e "testing email\n\nsent on: $(date)" | mail -s "test cli email $(date)" stefan@heine7.de
