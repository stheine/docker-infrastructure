FROM debian:stretch

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get upgrade -y && \
  apt-get install -y \
    dnsutils \
    locales \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen && \
  dpkg-reconfigure locales

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

# ##############################################################################
# Install sshd

WORKDIR /

RUN \
  apt-get install -y \
    openssh-server \
    rsyslog && \
  mkdir mkdir /var/run/sshd && \
  mkdir /root/.ssh && \
  chmod 700 /root/.ssh

# ##############################################################################
# Install unison
# https://github.com/bcpierce00/unison

RUN \
  apt-get install -y unison

# ##############################################################################
# Configure and startup

COPY environment /root/.ssh/
COPY sshd_config /etc/ssh/
COPY start.sh /

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/start.sh"]

EXPOSE 1499
VOLUME /var/musik /var/sshd_certs /root/.unison
