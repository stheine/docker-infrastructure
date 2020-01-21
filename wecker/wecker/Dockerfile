FROM arm32v6/node:12.14-alpine

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

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Berlin

WORKDIR /source

# ##############################################################################
# Install and run wecker app

#WORKDIR /root
#
#RUN \
#  apt-get install -y \
#    alsa-utils \
#    input-utils \
#    libasound2-dev

COPY asound.conf /etc/

RUN \
  apk add \
    alsa-lib-dev \
    curl \
    g++ \
    gcc \
    git \
    linux-headers \
    make \
    musl-dev \
    python
# && \
#  /sbin/ldconfig

COPY vimrc .vimrc
#RUN \
#  npm install --global eslint-cli eslint_d npm && \
#  mkdir -p .vim/autoload .vim/bundle && \
#  curl -LSso .vim/autoload/pathogen.vim https://tpo.pe/pathogen.vim && \
#  cd .vim/bundle && \
#  git clone --depth=1 https://github.com/vim-syntastic/syntastic.git && \
#  git config --global user.email stheine@arcor.de && \
#  git config --global user.name 'Stefan Heine'

COPY docker_container_profile /root/.profile

WORKDIR /app

#CMD ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/local/bin/node", "/app/app.js"]
#CMD ["/bin/bash", "-l"]
