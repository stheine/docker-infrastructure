FROM arm32v6/alpine:3.6

# ##############################################################################
# Install all the base packages needed for the following installs
# Set up timezone

RUN \
  apk update && \
  apk add \
    bash \
    ca-certificates \
    tzdata \
    wget && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

WORKDIR /source

# ##############################################################################
# Install vcontrold from https://github.com/openv/vcontrold

RUN \
  apk add \
    cmake \
    gcc \
    libxml2-dev \
    linux-headers \
    make \
    musl-dev && \
  wget https://github.com/openv/vcontrold/releases/download/v0.98.4/vcontrold_0.98.4.orig.tar.gz && \
  tar xf vcontrold_0.98.4.orig.tar.gz && \
  cd vcontrold-0.98.4 && \
  mkdir build && \
  cd build && \
  cmake -DMANPAGES=OFF .. && \
  make && \
  make install

# ##############################################################################
# Install rrdtool from https://github.com/oetiker/rrdtool-1.x

RUN \
  apk add \
    g++ \
    groff \
    libpng-dev \
    libxml2-dev \
    make \
    pango-dev \
    pcre-dev \
    perl-dev && \
  wget https://github.com/oetiker/rrdtool-1.x/releases/download/v1.7.0/rrdtool-1.7.0.tar.gz && \
  tar xf rrdtool-1.7.0.tar.gz && \
  cd rrdtool-1.7.0 && \
  ./configure --prefix=/opt/rrdtool && \
  /bin/cat src/Makefile | sed 's/^LIBS = $/LIBS = -lintl/' > src/Makefile.tmp && \
  mv src/Makefile.tmp src/Makefile && \
  make && \
  make install && \
  ln -s /opt/rrdtool/include/rrd.h /usr/include/ && \
  ln -s /opt/rrdtool/lib/librrd.so /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8 /usr/lib/ && \
  ln -s /opt/rrdtool/lib/librrd.so.8.1.0 /usr/lib/

# ##############################################################################
# Set up email

RUN \
  apk add \
    mailx \
    ssmtp

COPY ssmtp.conf /etc/ssmtp/ssmtp.conf

# ##############################################################################
# Install and run vito tasks

RUN \
  apk add \
    coreutils

COPY \
  ascheGeleert.sh \
  ascheGeleert.cmd \
  checkAccess.sh \
  checkError.sh \
  getVitoData.sh \
  getVitoData.cmd \
  getVitoData.tmpl \
  vclientLock.sh \
  /vito/

RUN \
  mkdir /etc/periodic/2min && \
  echo -e '*/2	*	*	*	*	run-parts /etc/periodic/2min\n' >> /var/spool/cron/crontabs/root && \
  ln -s /vito/getVitoData.sh /etc/periodic/2min/getVitoData

COPY docker_container_profile /root/.profile
# CMD ["/bin/bash", "-l"]

ENTRYPOINT ["/usr/sbin/crond", "-f"]

VOLUME /var/vito
