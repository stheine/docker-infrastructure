FROM ubuntu:20.04

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
# Install certbot-auto from https://certbot.eff.org/ Nginx / Ubuntu 20.04

RUN \
  apt-get install -y \
    build-essential \
    libaugeas0 \
    libffi-dev \
    libssl-dev \
    python3 \
    python3-dev \
    python3-venv \
    rustc && \
  /usr/bin/python3 -m venv /opt/certbot/ && \
  /opt/certbot/bin/pip install --upgrade pip && \
  /opt/certbot/bin/pip install certbot certbot-nginx && \
  ln -s /opt/certbot/bin/certbot /usr/bin/certbot

COPY docker_container_profile /root/.profile

ENTRYPOINT ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/bin/echo", "Startup"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]

# docker-compose exec certbot /usr/bin/certbot renew --webroot --webroot-path=/var/letsencrypt
