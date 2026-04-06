FROM httpd:2.4-bookworm

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get upgrade -y && \
  apt-get install -y \
    dnsutils \
    locales \
    tzdata \
    vim \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen && \
  dpkg-reconfigure locales && \
  /sbin/ldconfig && \
  echo "LC_ALL=en_US.UTF-8" >> /etc/environment && \
  echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen && \
  echo "LANG=en_US.UTF-8" > /etc/locale.conf && \
  /usr/sbin/locale-gen en_US.UTF-8

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Berlin

WORKDIR /source

# ##############################################################################
# Install rrdtool from https://github.com/oetiker/rrdtool-1.x

RUN \
  apt-get install -y \
    g++ \
    groff \
    libpango1.0-dev \
    libpng-dev \
    libxml2-dev \
    make
ARG RRDTOOL_VERSION=1.9.0
RUN \
  wget https://github.com/oetiker/rrdtool-1.x/releases/download/v$RRDTOOL_VERSION/rrdtool-$RRDTOOL_VERSION.tar.gz && \
  tar xf rrdtool-$RRDTOOL_VERSION.tar.gz && \
  cd rrdtool-$RRDTOOL_VERSION && \
  ./configure --prefix=/opt/rrdtool && \
  make && \
  make install && \
  ln -s /opt/rrdtool/include/rrd.h /usr/include/ && \
  ln -s /opt/rrdtool/lib/librrd.so /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8 /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8.1.0 /usr/lib/

ENV PATH="/opt/rrdtool/bin:${PATH}"

# ##############################################################################
# Install mosquitto client to publish MQTT messages
RUN \
  apt-get install -y \
    inotify-tools \
    mosquitto-clients

# ##############################################################################
# Configure and run apache2

WORKDIR $HTTPD_PREFIX

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

RUN \
  mkdir /usr/local/apache2/lock/ && \
  chown www-data:www-data /usr/local/apache2/lock/

EXPOSE 80
VOLUME /var/jalousie /var/strom /var/vito /var/www /var/www_auth
