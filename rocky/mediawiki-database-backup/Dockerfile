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
    procps \
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
# Configure cron & sshfs
# http://manpages.ubuntu.com/manpages/trusty/man8/cron.8.html

RUN \
  apt-get install -y \
    sshfs
RUN \
  mkdir /root/.ssh && \
  chmod 700 /root/.ssh && \
  mkdir /backup
RUN \
  echo '@reboot /startup.sh >/proc/1/fd/1\n0 0 * * * /usr/sbin/automysqlbackup' | /usr/bin/crontab -

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]
CMD ["/usr/sbin/cron", "-f"]
