FROM alpine:3.11

RUN apk add --no-cache tini gcc g++ pkgconf make automake autoconf libtool \
	util-linux-dev sqlite-dev mariadb-connector-c-dev cmake zlib-dev fmt-dev \
	file-dev libexif-dev curl-dev ffmpeg-dev ffmpegthumbnailer-dev wget xz \
	libmatroska-dev libebml-dev taglib-dev

# ##############################################################################
# Install and run from https://github.com/gerbera/gerbera

WORKDIR /source
ARG CACHE_DATE=2020-07-25

ARG GERBERA_VERSION=1.6.0
RUN \
  wget https://github.com/gerbera/gerbera/archive/v$GERBERA_VERSION.zip && \
  unzip v$GERBERA_VERSION.zip && \
  mv gerbera-$GERBERA_VERSION /gerbera_build

WORKDIR /gerbera_build

RUN mkdir build && \
    cd build && \
    sh ../scripts/install-pugixml.sh && \
    sh ../scripts/install-pupnp.sh && \
    sh ../scripts/install-duktape.sh && \
    sh ../scripts/install-spdlog.sh && \
    cmake ../ -DWITH_MAGIC=1 -DWITH_MYSQL=1 -DWITH_CURL=1 -DWITH_JS=1 \
        -DWITH_TAGLIB=1 -DWITH_AVCODEC=1 -DWITH_FFMPEGTHUMBNAILER=1 \
        -DWITH_EXIF=1 -DWITH_LASTFM=0 -DWITH_SYSTEMD=0 -DWITH_DEBUG=1 && \
    make -j`nproc` && \
    make install && \
    rm -rf /gerbera_build

RUN mkdir -p /root/.config/gerbera &&\
    gerbera --create-config > /root/.config/gerbera/config.xml &&\
    sed 's/<import hidden-files="no">/<import hidden-files="no">\n\
    <autoscan use-inotify="yes">\n\
      <directory location="\/media" mode="inotify" recursive="yes" hidden-files="no"\/>\n\
    <\/autoscan>/' -i /root/.config/gerbera/config.xml

WORKDIR /

COPY docker_container_profile /root/.profile
COPY config/ /etc/gerbera/config/

COPY gerbera.sh /

ENTRYPOINT ["/sbin/tini", "--"]
CMD /gerbera.sh
#CMD ["/bin/bash", "-l"]

VOLUME /gerbera_home /media
