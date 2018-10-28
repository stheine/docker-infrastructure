FROM armv7/armhf-debian:jessie

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
# Install and configure sshd

WORKDIR /

RUN \
  apt-get install -y \
    openssh-server \
    rsyslog && \
  mkdir mkdir /var/run/sshd && \
  mkdir /root/.ssh && \
  chmod 700 /root/.ssh

COPY environment /root/.ssh/
COPY sshd_config /etc/ssh/
COPY start.sh /

# ##############################################################################
# Install unison stable from https://github.com/bcpierce00/unison
# unison and ucaml must be built on the same version on server and client.
# on the remote is unison 2.48.4 with ocaml 4.05.
# ocaml 4.05 is currently available only in the testing channel.

RUN \
  cd /etc/apt/apt.conf.d/ && \
  echo 'APT::Default-Release "jessie";' > 99defaultrelease && \
  cd /etc/apt/sources.list.d/ && \
  echo 'deb http://ftp.de.debian.org/debian testing main contrib non-free' > testing.list && \
  gpg --list-keys && \
  gpg --keyserver pgpkeys.mit.edu --recv-key 8B48AD6246925553 && \
  gpg -a --export 8B48AD6246925553 | sudo apt-key add - && \
  gpg --keyserver pgpkeys.mit.edu --recv-key 7638D0442B90D010 && \
  gpg -a --export 7638D0442B90D010 | sudo apt-key add - && \
  gpg --keyserver pgpkeys.mit.edu --recv-key 04EE7237B7D453EC && \
  gpg -a --export 04EE7237B7D453EC | sudo apt-key add - && \
  apt-get update && \
  apt-get -t testing install -y ocaml && \
  apt-get install -y emacs make

WORKDIR /source

RUN \
  wget https://github.com/bcpierce00/unison/archive/2.48.4.tar.gz && \
  tar xf 2.48.4.tar.gz && \
  cd unison-2.48.4/src && \
  make UISTYLE=text && \
  cp unison unison-fsmonitor /usr/local/bin && \
  apt-get remove -y \
    emacs \
    make \
    ocaml && \
  cd /source && \
  rm 2.48.4.tar.gz

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

CMD ["/start.sh"]

EXPOSE 1499
VOLUME /var/musik /var/sshd_certs /root/.unison
