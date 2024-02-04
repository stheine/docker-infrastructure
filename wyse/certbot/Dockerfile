FROM debian:bookworm-slim

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get install -y \
    locales \
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
# https://certbot.eff.org/instructions?ws=nginx&os=pip
# https://cryptography.io/en/latest/installation/

RUN \
  apt-get install -y \
    build-essential \
    cargo \
    libaugeas0 \
    libffi-dev \
    libssl-dev \
    pkg-config \
    python3 \
    python3-dev \
    python3-venv \
    rustc

RUN \
  python3 -m venv /opt/certbot/ && \
  /opt/certbot/bin/pip install --upgrade pip && \
  /opt/certbot/bin/pip install certbot certbot-nginx && \
  ln -s /opt/certbot/bin/certbot /usr/bin/certbot

# ##############################################################################
# Set up email

RUN \
  apt-get install -y \
    mailutils \
    ssmtp && \
  chfn -f 'certbot'

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ##############################################################################
# Configure cron
# http://manpages.ubuntu.com/manpages/trusty/man8/cron.8.html

RUN \
  apt-get install -y \
    cron && \
  echo '0 10 1,6,11,16,21,26,31 * * /renew.sh >/proc/1/fd/1 2>/proc/1/fd/2\n@reboot /renew.sh >/proc/1/fd/1 2>/proc/1/fd/2' | /usr/bin/crontab -

CMD ["/usr/sbin/cron", "-f"]
# CMD ["/bin/bash", "-l"]

COPY docker_container_profile /root/.profile
