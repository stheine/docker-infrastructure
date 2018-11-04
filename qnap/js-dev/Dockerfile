FROM node:10-alpine

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

# ##############################################################################
# Configure vim

COPY vimrc /root/.vimrc
COPY vimrc_pathogen /root/.vimrc_pathogen
RUN \
  cat /root/.vimrc_pathogen >> /root/.vimrc

# ##############################################################################
# Install pathogen from https://github.com/tpope/vim-pathogen

RUN \
  apk add \
    curl \
    git

RUN \
  mkdir -p /root/.vim/autoload ~/.vim/bundle && \
  curl -LSso /root/.vim/autoload/pathogen.vim https://tpo.pe/pathogen.vim && \
  cd ~/.vim/bundle && \
  git clone --depth=1 https://github.com/vim-syntastic/syntastic.git

# ##############################################################################
# Install eslint

RUN \
  npm install --global \
    eslint \
    eslint-cli \
    eslint-config-es \
    npm 

WORKDIR /source

COPY docker_container_profile /root/.profile
CMD ["/bin/true"]

VOLUME /source/jalousie
