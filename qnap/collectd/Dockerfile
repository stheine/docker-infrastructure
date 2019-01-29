FROM armv7/armhf-ubuntu:xenial

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get install -y \
    dnsutils \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  locale-gen en_US.UTF-8

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

# ##############################################################################
# Configure and run collectd

RUN \
  apt-get install -y \
    libxslt1-dev \
    libxml2-dev \
    python-pip \
    zlib1g-dev

RUN \
  pip install \
    fritzcollectd

RUN \
  apt-get install -y \
    collectd

# ##############################################################################

RUN \
  apt-get install -y \
    man less procps telnet net-tools iputils-ping

COPY docker_container_profile /root/.profile
#CMD ["/bin/bash", "-l"]
CMD ["/usr/sbin/collectd", "-f"]

#EXPOSE 993
VOLUME /var/lib/collectd
