# bionic = 18.04
FROM ubuntu:bionic

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
# Install build environment

RUN \
  apt-get install -y \
    autoconf \
    cmake \
    eclipse-cdt-autotools \
    g++ \
    gcc \
    git \
    libtool \
    make

# Update cmake to >= 3.8
WORKDIR /source
RUN \
  wget https://github.com/Kitware/CMake/releases/download/v3.13.3/cmake-3.13.3.tar.gz && \
  tar xf cmake-3.13.3.tar.gz && \
  cd cmake-3.13.3 && \
  cmake . && \
  make && \
  make install

RUN \
  apt-get install -y \
    uuid-dev \
    libexpat1-dev \
    libsqlite3-dev \
    libmysqlclient-dev \
    libmagic-dev \
    libexif-dev \
    libcurl4-openssl-dev \
    libavutil-dev \
    libavcodec-dev \
    libavformat-dev \
    libavdevice-dev \
    libavfilter-dev \
    libavresample-dev \
    libswscale-dev \
    libswresample-dev \
    libpostproc-dev

# ##############################################################################
# Install and run from https://github.com/gerbera/gerbera

WORKDIR /source
ARG CACHE_DATE=2019-01-28

# 1.3.2
#  wget https://github.com/gerbera/gerbera/archive/v1.3.2.zip && \
#  unzip v1.3.2.zip && \
#  mv gerbera-1.3.2 gerbera && \
# latest
#  git clone https://github.com/gerbera/gerbera.git && \

ARG GERBERA_VERSION=1.3.5
RUN \
  wget https://github.com/gerbera/gerbera/archive/v$GERBERA_VERSION.zip && \
  unzip v$GERBERA_VERSION.zip && \
  mv gerbera-$GERBERA_VERSION gerbera && \
  cat gerbera/scripts/install-pupnp18.sh | \
    sed \
      -e "s/make \&\&/make CFLAGS='-D_LARGE_FILE_SOURCE -D_FILE_OFFSET_BITS=64' LDFLAGS='-pthread -lpthread' \&\&/" \
      > /tmp/install-pupnp18.sh && \
  chmod 755 /tmp/install-pupnp18.sh && \
  mv /tmp/install-pupnp18.sh gerbera/scripts/install-pupnp18.sh && \
  mkdir build && \
  cd build && \
  bash ../gerbera/scripts/install-pupnp18.sh && \
  bash ../gerbera/scripts/install-taglib111.sh && \
  bash ../gerbera/scripts/install-duktape.sh && \
  cmake ../gerbera -DWITH_MAGIC=1 -DWITH_MYSQL=0 -DWITH_CURL=1 -DWITH_JS=1 -DWITH_TAGLIB=1 -DWITH_AVCODEC=1 -DWITH_EXIF=1 -DWITH_LASTFM=0 -DWITH_SYSTEMD=0 && \
  make -j4 && \
  sudo make install

WORKDIR /

COPY docker_container_profile /root/.profile
COPY config/ /etc/gerbera/config/

COPY gerbera.sh /
CMD /gerbera.sh
#CMD ["/bin/bash", "-l"]

EXPOSE 1030/udp 1900/udp 9000/tcp
VOLUME /gerbera_home /mnt/musik
