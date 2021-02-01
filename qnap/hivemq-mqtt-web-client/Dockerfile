FROM nginx:1.19.6

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
  sed -i -e 's/broker.mqttdashboard.com/192.168.6.7/' -e 's/8000/9001/' hivemq-mqtt-web-client/config.js 

COPY docker_container_profile /root/.profile
