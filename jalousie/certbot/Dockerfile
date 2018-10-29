FROM arm32v6/alpine:3.6

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone
RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

WORKDIR /certbot

# ##############################################################################
# Install certbot-auto from https://certbot.eff.org/

# This command is just to invalidate the cache and force docker to rebuild the app from here on
# docker-compose build --build-arg CACHE_DATE_JS="$(date)" certbot
ARG CACHE_DATE_JS=2018-09-07

RUN \
  wget https://dl.eff.org/certbot-auto && \
  chmod a+x certbot-auto && \
  apk update && \
  apk add \
    augeas \
    gcc \
    libffi \
    libffi-dev \
    musl-dev \
    openssl-dev \
    python2 \
    python2-dev \
    py-virtualenv && \
  ./certbot-auto --no-bootstrap ; \
  /bin/true

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/certbot/certbot-auto", "renew", "--webroot", "--webroot-path=/var/letsencrypt"]

VOLUME /etc/letsencrypt /var/letsencrypt
