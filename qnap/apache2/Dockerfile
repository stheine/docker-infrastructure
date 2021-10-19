FROM httpd:2.4-alpine

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

WORKDIR /source

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
    perl-dev \
    ttf-dejavu && \
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
# Install mosquitto client to publish MQTT messages
RUN \
  apk add \
    inotify-tools \
    mosquitto-clients

# ##############################################################################
# Configure and run apache2

RUN \
  apk add \
    coreutils

WORKDIR $HTTPD_PREFIX

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

RUN \
  mkdir /usr/local/apache2/lock/ && \
  chown www-data:www-data /usr/local/apache2/lock/

EXPOSE 80
VOLUME /var/jalousie /var/strom /var/vito /var/www /var/www_auth
