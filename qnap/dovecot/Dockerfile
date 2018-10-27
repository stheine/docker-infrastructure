FROM armv7/armhf-ubuntu:xenial

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

RUN \
  apt-get install -y \
    autoconf \
    automake \
    gettext \
    libssl-dev \
    libtool \
    pandoc \
    pkg-config

WORKDIR /source

RUN \
  wget https://github.com/dovecot/core/archive/2.3.3.tar.gz && \
  tar xf 2.3.3.tar.gz && \
  cd core-2.3.3 && \
  ./autogen.sh && \
  ./configure --enable-maintainer-mode --with-ssl=openssl && \
  make && \
  sudo make install && \
  useradd -m -p vmail -s /bin/false vmail && \
  useradd -m -p dovecot -s /bin/false dovecot && \
  useradd -m -p dovenull -s /bin/false dovenull

COPY dovecot.conf passwd /usr/local/etc/dovecot/
COPY ssl-parameters.dat /var/lib/dovecot/ssl-parameters.dat

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/usr/local/sbin/dovecot", "-F"]

EXPOSE 993
VOLUME /usr/local/etc/dovecot/certs /home/vmail
