FROM koenkk/zigbee2mqtt:latest

# ##############################################################################
# Extend the package with bash

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
ENV TZ Europe/Berlin

COPY docker_container_profile /root/.profile
