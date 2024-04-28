# ##############################################################################
# Install docker cli binary only
# https://github.com/docker/cli/issues/2281#issuecomment-577745894
ARG DOCKER_VERSION=26-cli
FROM docker:${DOCKER_VERSION} AS docker-cli

# ##############################################################################
FROM debian:bookworm-slim
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV DEBIAN_FRONTEND noninteractive

RUN \
  apt-get update && \
  apt-get install -y \
    apt-utils && \
  apt-get install -y \
    locales \
    sudo \
    tzdata \
    unzip \
    vim \
    wget \
    xz-utils && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  sed -i -e 's/^# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && \
  locale-gen en_US.UTF-8

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8

COPY docker_container_profile /root/.profile

# ##############################################################################
# Set up email

RUN \
  apt-get install -y \
    mailutils \
    ssmtp

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ##############################################################################

RUN \
  apt-get install -y \
    rclone

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ##############################################################################
# Configure cron
# http://manpages.ubuntu.com/manpages/trusty/man8/cron.8.html

RUN \
  apt-get install -y \
    cron && \
  echo '23 0 * * * /backup.sh >/proc/1/fd/1 2>/proc/1/fd/2\n@reboot /backup.sh >/proc/1/fd/1 2>/proc/1/fd/2' | /usr/bin/crontab -

CMD ["/usr/sbin/cron", "-f"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
