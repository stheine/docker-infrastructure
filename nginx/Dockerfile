FROM nginx

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
# Configure and run nginx

COPY nginx.conf /etc/nginx/

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

EXPOSE 80 443
#VOLUME /etc/nginx/certs
