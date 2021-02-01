FROM node:12-stretch

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
  dpkg-reconfigure locales && \
  /sbin/ldconfig

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

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
ARG RRDTOOL_VERSION=1.7.2
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
# Install graphwiz

RUN \
  apt-get install -y \
    graphviz

# ##############################################################################
# Install and run mqtt2rrd app

WORKDIR /root

RUN \
  apt-get install -y \
    curl \
    git && \
# \
#    python && \
  /sbin/ldconfig

COPY vimrc .vimrc
RUN \
  npm install --global eslint-cli eslint_d && \
  mkdir -p .vim/autoload .vim/bundle && \
  curl -LSso .vim/autoload/pathogen.vim https://tpo.pe/pathogen.vim && \
  cd .vim/bundle && \
  git clone --depth=1 https://github.com/vim-syntastic/syntastic.git && \
  git config --global user.email stheine@arcor.de && \
  git config --global user.name 'Stefan Heine'
ENV TZ Europe/Berlin

COPY docker_container_profile /root/.profile

WORKDIR /app

# RUN \
#   npm install

CMD ["/usr/local/bin/node", "/app/mqtt2rrd.js"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
# CMD ["/bin/bash", "-l"]
