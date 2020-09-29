FROM nginx:1.19.2

# ##############################################################################
# Set up timezone

ENV TZ=Europe/Berlin
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ##############################################################################
# Set up some basic tooling
RUN \
  apt-get update && \
  apt-get install -y \
    vim

# ##############################################################################
# Run nginx.
# Configuration by volume in /etc/nginx/nginx.conf 
# Re-read configuration:
#   docker-compose kill -s HUP nginx

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

EXPOSE 80 443
VOLUME /etc/letsencrypt /var/letsencrypt
