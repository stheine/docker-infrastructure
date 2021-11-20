FROM arm32v6/node:14-alpine

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

# ##############################################################################
# Install and run strom app

WORKDIR /root

COPY npmrc .npmrc
COPY vimrc .vimrc
RUN \
  apk add \
    curl \
    git \
    g++ \
    linux-headers \
    make \
    python

# ##############################################################################
# Install and run strom app

WORKDIR /app

COPY docker_container_profile /root/.profile

# CMD ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/local/bin/node", "/app/watchdog.js"]
# CMD ["/bin/bash", "-l"]
