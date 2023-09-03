FROM debian:bookworm-slim

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
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
  locale-gen en_US.UTF-8

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

# ##############################################################################
# Configure and run dovecot
# https://github.com/dovecot/core/tags

RUN \
  apt-get install -y \
    wget \
    autoconf \
    automake \
    libtool \
    pkg-config \
    gettext \
    pandoc \
    bison \
    flex \
    make \
    libssl-dev

WORKDIR /source

ARG DOVECOT_VERSION=2.3.20
RUN \
  wget https://github.com/dovecot/core/archive/$DOVECOT_VERSION.tar.gz && \
  tar xf $DOVECOT_VERSION.tar.gz
WORKDIR /source/core-$DOVECOT_VERSION
RUN \
  ./autogen.sh && \
  ./configure --enable-maintainer-mode --with-ssl=openssl && \
  make && \
  sudo make install
RUN \
  useradd -m -p vmail -s /bin/false vmail && \
  useradd -m -p dovecot -s /bin/false dovecot && \
  useradd -m -p dovenull -s /bin/false dovenull

COPY dovecot.conf passwd /usr/local/etc/dovecot/
COPY ssl-parameters.dat /var/lib/dovecot/ssl-parameters.dat

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/usr/local/sbin/dovecot", "-F"]

EXPOSE 993
