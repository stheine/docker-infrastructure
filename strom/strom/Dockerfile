FROM node:8.9.3-alpine

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    g++ \
    gcc \
    git \
    linux-headers \
    make \
    python \
    tzdata \
    udev \
    vim \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

WORKDIR /source

# ##############################################################################
# Install rrdtool from https://github.com/oetiker/rrdtool-1.x

RUN \
  apk add \
    groff \
    libpng-dev \
    libxml2-dev \
    pango-dev \
    pcre-dev \
    perl-dev && \
  wget https://github.com/oetiker/rrdtool-1.x/releases/download/v1.7.0/rrdtool-1.7.0.tar.gz && \
  tar xf rrdtool-1.7.0.tar.gz && \
  cd rrdtool-1.7.0 && \
  ./configure --prefix=/opt/rrdtool && \
  /bin/cat src/Makefile | sed 's/^LIBS = $/LIBS = -lintl/' > src/Makefile.tmp && \
  mv src/Makefile.tmp src/Makefile && \
  make && \
  make install && \
  ln -s /opt/rrdtool/include/rrd.h /usr/include/ && \
  ln -s /opt/rrdtool/lib/librrd.so /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8 /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8.1.0 /usr/lib/

# ##############################################################################
# Install and run app

# This command is just to invalidate the cache and force docker to rebuild the app from here on
# docker-compose build --build-arg CACHE_DATE_JS="$(date)" strom
#ARG CACHE_DATE_JS=2018-04-18

# TODO

# ##############################################################################
# Setting for development environment
RUN \
  npm install --global \
    eslint-cli && \
  git config --global user.email "stheine@arcor.de" && \
  git config --global user.name "Stefan Heine" && \
  git config --global core.pager "more"

# ##############################################################################

# WORKDIR /

# RUN \
#   git clone https://github.com/Apollon77/smartmeter-obis.git

# WORKDIR /smartmeter-obis

# RUN \
#   npm install serialport --build-from-source --unsafe-perm && \
#   npm install

WORKDIR /strom

COPY create_rrd.sh package.json /strom/

RUN \
  npm install

COPY strom.js /strom/

COPY vimrc /root/.vimrc
COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

ENV PATH="/opt/rrdtool/bin:${PATH}"
RUN ln -s /opt/rrdtool/bin/rrdtool /usr/local/bin/
CMD ["/usr/local/bin/node", "/strom/strom.js"]

# EXPOSE 9083
VOLUME /var/strom
