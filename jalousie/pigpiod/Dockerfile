FROM arm32v6/alpine:3.8

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

WORKDIR /source

# ##############################################################################
# Install pigpio from http://abyz.me.uk/rpi/pigpio/index.html

ARG PIGPIO_VERSION=69
RUN \
  apk add \
    gcc \
    make \
    musl-dev && \
  wget https://github.com/joan2937/pigpio/archive/V$PIGPIO_VERSION.zip && \
  unzip V$PIGPIO_VERSION.zip && \
  cd pigpio-$PIGPIO_VERSION && \
  /bin/cat Makefile | sed 's/ldconfig//' > Makefile.tmp && \
  mv Makefile.tmp Makefile && \
  make && \
  make install

# ##############################################################################
# Run pigpiod

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

COPY start.sh /
ENTRYPOINT ["/start.sh"]

EXPOSE 8888
