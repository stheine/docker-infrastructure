FROM node:15-buster

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
# Install and run mqtt-volumio app

WORKDIR /root

RUN \
  apt-get install -y \
    curl \
    git && \
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

# ONBUILD \
#   npm install

CMD ["/usr/local/bin/node", "/app/mqtt-volumio.js"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
