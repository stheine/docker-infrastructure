FROM armv7/armhf-ubuntu:xenial

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get install -y \
    dnsutils \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  locale-gen en_US.UTF-8

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

# ##############################################################################
# Configure and run postfix

RUN \
  apt-get install -y postfix mailutils rsyslog && \
  /usr/sbin/postconf -e 'compatibility_level = 2' && \
  /usr/sbin/postconf -e 'inet_interfaces = all' && \
  /usr/sbin/postconf -e 'inet_protocols = ipv4' && \
  /usr/sbin/postconf -e 'myhostname = qnap.heine7.de' && \
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
  postmap /etc/postfix/generic

COPY docker_container_profile /root/.profile

COPY start.sh /
CMD /start.sh
# CMD ["/bin/bash", "-l"]

EXPOSE 25
VOLUME /postfix_creds

# echo -e "testing email\n\nsent on: $(date)" | mailx -r technik@heine7.de -s "test cli email $(date)" stefan@heine7.de
