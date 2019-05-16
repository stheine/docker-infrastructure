FROM node:10-stretch

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
# Install parsoid

WORKDIR /app

RUN \
  adduser --system --uid 1002 --disabled-password --shell /bin/bash parsoid && \
  git clone \
    --branch master \
    --single-branch \
    --depth 1 \
    --quiet \
    https://gerrit.wikimedia.org/r/p/mediawiki/services/parsoid && \
  cd parsoid && \
  npm install

COPY run-parsoid.sh /

WORKDIR /app/parsoid

EXPOSE 8000

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]
CMD ["/run-parsoid.sh"]
