FROM nginx:alpine

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

# ##############################################################################
# Set up some basic tooling
RUN \
  apk add \
    busybox-extras \
    vim \
    wget

# ##############################################################################
# Run nginx.
# Configuration by volume in /etc/nginx/nginx.conf 
# Re-read configuration:
#   docker-compose kill -s HUP nginx

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]

# EXPOSE 80 443
# VOLUME /etc/letsencrypt /var/letsencrypt
