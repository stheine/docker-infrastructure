FROM debian:bookworm-slim

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get upgrade -y
RUN \
  apt-get install -y \
    dnsutils \
    locales \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils
RUN \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen && \
  dpkg-reconfigure locales

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Berlin

# ##############################################################################
# Configure and run postfix

RUN \
  sed -i 's/^root:x:0:0:root:/root:x:0:0::/' /etc/passwd

RUN \
  apt-get install -y postfix mailutils
RUN \
  /usr/sbin/postconf -e 'compatibility_level = 3.6' && \
  /usr/sbin/postconf -e 'maillog_file = /dev/stdout' && \
  /usr/sbin/postconf -e 'smtp_tls_security_level = encrypt' && \
  /usr/sbin/postconf -e 'smtp_tls_wrappermode = yes' && \
  /usr/sbin/postconf -e 'smtp_sasl_auth_enable = yes' && \
  /usr/sbin/postconf -e 'smtp_sasl_security_options = noanonymous' && \
  /usr/sbin/postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/config/sasl_password' && \
  /usr/sbin/postconf -e 'relayhost = [smtp.strato.de]:465' && \
  /usr/sbin/postconf -e 'mydomain = heine7.de' && \
  /usr/sbin/postconf -e 'myhostname = wyse.fritz.box' && \
  /usr/sbin/postconf -e 'mydestination = $myhostname, wyse, localhost.localdomain, localhost' && \
  /usr/sbin/postconf -e 'myorigin = $mydomain' && \
  /usr/sbin/postconf -e 'mynetworks = 172.0.0.0/8, 192.168.0.0/16, 127.0.0.0/8' && \
  /usr/sbin/postconf -e 'sender_canonical_maps = hash:/etc/postfix/config/sender_canonical' && \
  /usr/sbin/postconf -e 'smtp_header_checks = regexp:/etc/postfix/config/header_check' && \
  /usr/sbin/postconf -e 'inet_interfaces = all' && \
  /usr/sbin/postconf -e 'inet_protocols = all'

COPY docker_container_profile /root/.profile

COPY start.sh /
CMD /start.sh
# CMD ["/bin/bash", "-l"]

# echo -e "testing email\n\nsent on: $(date)" | mailx -r technik@heine7.de -s "test cli email $(date)" stefan@heine7.de

# echo -e "Subject: sendmail test\n\ntest" | sendmail -v stefan@heine7.de
