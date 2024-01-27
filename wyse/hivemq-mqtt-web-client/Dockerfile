FROM nginx:1.23.3

# ##############################################################################
# Set up timezone

ENV TZ=Europe/Berlin
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ##############################################################################
# Set up some basic tooling
RUN \
  apt-get update && \
  apt-get install -y \
    unzip \
    vim \
    wget

# ##############################################################################
# Run nginx.
# Configuration by volume in /etc/nginx/nginx.conf
# Re-read configuration:
#   docker-compose kill -s HUP nginx

RUN \
  wget https://github.com/hivemq/hivemq-mqtt-web-client/archive/master.zip && \
  unzip master.zip && \
  mv hivemq-mqtt-web-client-master hivemq-mqtt-web-client && \
  rm master.zip

RUN \
  sed -i \
    -e 's%<input id="subscribeTopic" type="text" value="testtopic/#">%<input id="subscribeTopic" type="text" value="Zigbee/#">%' \
    -e 's%<input id="urlInput" type="text" value="broker.mqttdashboard.com">%<input id="urlInput" type="text" value="192.168.6.7">%' \
    -e 's%<input id="portInput" type="text" value="8000"/>%<input id="portInput" type="text" value="9001"/>%' \
    hivemq-mqtt-web-client/index.html

COPY docker_container_profile /root/.profile
