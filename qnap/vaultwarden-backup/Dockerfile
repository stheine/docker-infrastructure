FROM alpine:3.18

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8
ENV LC_ALL en_US.UTF-8
ENV TZ Europe/Berlin

RUN \
  apk update && \
  apk --no-cache add \
    bash \
    mandoc \
    man-pages

COPY docker_container_profile /root/.profile

# ##############################################################################
# Set up email

RUN \
  apk add \
    ssmtp

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ########################################################################################
# Install cron
RUN \
  apk add \
    cronie \
    sqlite
RUN \
  echo -e '@reboot /startup.sh >/proc/1/fd/1\n@reboot sleep 1 && /backup.sh >/proc/1/fd/1\n0 5 * * * /backup.sh >/proc/1/fd/1 2>/proc/1/fd/2' | /usr/bin/crontab -

# ########################################################################################
# Startup
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
CMD ["/usr/sbin/crond", "-n", "-m", "off"]
