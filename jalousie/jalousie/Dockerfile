FROM node:8-alpine
# Note pigpio npm fails to install on node:10

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata \
    vim \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

WORKDIR /source

# ##############################################################################
# Install pigpio from http://abyz.me.uk/rpi/pigpio/index.html

ARG PIGPIO_VERSION=69
RUN \
  apk add \
    gcc \
    make \
    musl-dev && \
  wget https://github.com/joan2937/pigpio/archive/V$PIGPIO_VERSION.zip && \
  unzip V$PIGPIO_VERSION && \
  cd pigpio-$PIGPIO_VERSION && \
  /bin/cat Makefile | sed 's/ldconfig//' > Makefile.tmp && \
  mv Makefile.tmp Makefile && \
  make && \
  make install

# ##############################################################################
# Install rrdtool from https://github.com/oetiker/rrdtool-1.x

ARG RRDTOOL_VERSION=1.7.2
RUN \
  apk add \
    g++ \
    groff \
    libpng-dev \
    libxml2-dev \
    make \
    pango-dev \
    pcre-dev \
    perl-dev && \
  wget https://github.com/oetiker/rrdtool-1.x/releases/download/v$RRDTOOL_VERSION/rrdtool-$RRDTOOL_VERSION.tar.gz && \
  tar xf rrdtool-$RRDTOOL_VERSION.tar.gz && \
  cd rrdtool-$RRDTOOL_VERSION && \
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
# Install and run jalousie app

RUN \
  apk add \
    git \
    python

# This command is just to invalidate the cache and force docker to rebuild the app from here on
# docker-compose build --build-arg CACHE_DATE="$(date)" jalousie
ARG CACHE_DATE=2018-01-20

#  git clone https://github.com/stheine/jalousie.git && \
#  cd /jalousie && \

WORKDIR /jalousie

COPY jalousie/package.json /jalousie/

RUN \
  npm install

COPY vimrc /root/.vimrc

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/usr/local/bin/node", "/jalousie/lib/jalousie.js"]

EXPOSE 9124
VOLUME /var/jalousie /var/strom /var/vito

COPY jalousie/ /jalousie/
