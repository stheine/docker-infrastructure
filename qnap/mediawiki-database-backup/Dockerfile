FROM debian:stretch-slim

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get upgrade -y && \
  apt-get install -y \
    dnsutils \
    locales \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen && \
  dpkg-reconfigure locales

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

# ##############################################################################
# Install automysqlbackup

RUN \
  apt-get install -y automysqlbackup

# ##############################################################################
# Set up email

RUN \
  apt-get install -y \
    mailutils \
    ssmtp && \
  chfn -f 'mediawiki-database-backup'

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ##############################################################################
# Configure cron
# http://manpages.ubuntu.com/manpages/trusty/man8/cron.8.html

RUN \
  echo '0 0 * * * /usr/sbin/automysqlbackup' | /usr/bin/crontab -

COPY postbackup.sh /

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]
CMD ["/usr/sbin/cron", "-f"]
