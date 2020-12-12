FROM node:15-stretch

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
# Install pigpio from http://abyz.me.uk/rpi/pigpio/index.html

ARG PIGPIO_VERSION=78
RUN \
  apt-get install -y \
    gcc \
    make \
    musl-dev && \
  wget https://github.com/joan2937/pigpio/archive/v$PIGPIO_VERSION.zip && \
  unzip v$PIGPIO_VERSION && \
  cd pigpio-$PIGPIO_VERSION && \
  /bin/cat Makefile | sed 's/ldconfig//' > Makefile.tmp && \
  mv Makefile.tmp Makefile && \
  make && \
  make install

# ##############################################################################
# Install and run jalousie-io app

WORKDIR /root

RUN \
  apt-get install -y \
    git \
    python && \
  /sbin/ldconfig

COPY npmrc .npmrc
COPY vimrc .vimrc
RUN \
  apt-get install -y \
    curl && \
  npm install --global eslint-cli eslint_d && \
  mkdir -p .vim/autoload .vim/bundle && \
  curl -LSso .vim/autoload/pathogen.vim https://tpo.pe/pathogen.vim && \
  cd .vim/bundle && \
  git clone --depth=1 https://github.com/vim-syntastic/syntastic.git && \
  git config --global user.email stheine@arcor.de && \
  git config --global user.name 'Stefan Heine'
ENV TZ Europe/Berlin

COPY docker_container_profile /root/.profile

WORKDIR /jalousie-io


# RUN \
#   npm install

CMD ["/usr/local/bin/node", "/jalousie-io/lib/jalousie-io.js"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
# CMD ["/bin/bash", "-l"]

# EXPOSE 9124
