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
# Install certbot-auto from https://certbot.eff.org/

WORKDIR /certbot

# This command is just to invalidate the cache and force docker to rebuild the app from here on
# docker-compose build --build-arg CACHE_DATE_JS="$(date)" certbot
ARG CACHE_DATE_JS=2019-10-13

RUN \
  wget https://dl.eff.org/certbot-auto && \
  chmod a+x certbot-auto && \
  apt-get update && \
  apt-get install -y \
    gcc \
    libffi-dev \
    libssl-dev \
    python \
    python-dev \
    virtualenv && \
  ./certbot-auto --no-bootstrap ; \
  /bin/true

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/certbot/certbot-auto", "renew", "--webroot", "--webroot-path=/var/letsencrypt"]

VOLUME /etc/letsencrypt /var/letsencrypt
