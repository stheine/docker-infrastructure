FROM node:20-bookworm-slim

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get upgrade -y && \
  apt-get install -y \
    apt-utils && \
  apt-get install -y \
    dnsutils \
    locales \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen && \
  dpkg-reconfigure locales && \
  /sbin/ldconfig

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Berlin

# ##############################################################################
# Configure root account

WORKDIR /root

COPY docker_container_profile .profile
COPY npmrc .npmrc
COPY vimrc .vimrc

# ##############################################################################
# Run app

WORKDIR /app

# CMD ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/local/bin/node", "/app/lib/jalousie-backend.js"]
