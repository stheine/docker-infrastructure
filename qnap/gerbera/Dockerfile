FROM alpine:3.14 AS builder

RUN apk add --no-cache tini gcc g++ pkgconf make \
    util-linux-dev sqlite-dev mariadb-connector-c-dev cmake zlib-dev fmt-dev \
    file-dev libexif-dev curl-dev ffmpeg-dev ffmpegthumbnailer-dev \
    libmatroska-dev libebml-dev taglib-dev pugixml-dev spdlog-dev \
    duktape-dev libupnp-dev git bash

# ##############################################################################
# Install and run from https://github.com/gerbera/gerbera

WORKDIR /source
ARG CACHE_DATE=2020-07-25

ARG GERBERA_VERSION=1.9.0
RUN \
  wget https://github.com/gerbera/gerbera/archive/v$GERBERA_VERSION.zip && \
  unzip v$GERBERA_VERSION.zip && \
  mv gerbera-$GERBERA_VERSION /gerbera_build

WORKDIR /gerbera_build

RUN mkdir build && \
    cd build && \
    cmake .. \
        -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DWITH_MAGIC=YES \
        -DWITH_MYSQL=YES \
        -DWITH_CURL=YES \
        -DWITH_JS=YES \
        -DWITH_TAGLIB=YES \
        -DWITH_AVCODEC=YES \
        -DWITH_FFMPEGTHUMBNAILER=YES \
        -DWITH_EXIF=YES \
        -DWITH_LASTFM=NO \
        -DWITH_SYSTEMD=NO \
        -DWITH_DEBUG=YES && \
    make -j$(nproc)

FROM alpine:3.14
RUN apk add --no-cache tini util-linux sqlite mariadb-connector-c zlib fmt \
    file libexif curl ffmpeg-libs ffmpegthumbnailer libmatroska libebml taglib \
    pugixml spdlog sqlite-libs libupnp duktape su-exec

# Gerbera itself
COPY --from=builder /gerbera_build/build/gerbera /bin/gerbera
COPY --from=builder /gerbera_build/scripts/js /usr/local/share/gerbera/js
COPY --from=builder /gerbera_build/web /usr/local/share/gerbera/web
COPY --from=builder /gerbera_build/src/database/*/*.sql /usr/local/share/gerbera/
COPY --from=builder /gerbera_build/src/database/*/*.xml /usr/local/share/gerbera/

RUN addgroup -S gerbera 2>/dev/null && \
    adduser -S -D -H -h /var/run/gerbera -s /sbin/nologin -G gerbera -g gerbera gerbera 2>/dev/null && \
    mkdir /var/run/gerbera/ && chmod 2775 /var/run/gerbera/

#RUN mkdir -p /root/.config/gerbera &&\
#    gerbera --create-config > /root/.config/gerbera/config.xml &&\
#    sed 's/<import hidden-files="no">/<import hidden-files="no">\n\
#    <autoscan use-inotify="yes">\n\
#      <directory location="\/media" mode="inotify" recursive="yes" hidden-files="no"\/>\n\
#    <\/autoscan>/' -i /root/.config/gerbera/config.xml

#WORKDIR /

RUN apk add bash
COPY docker_container_profile /root/.profile
COPY config/ /etc/gerbera/config/

COPY gerbera.sh /

ENTRYPOINT ["/sbin/tini", "--"]
CMD /gerbera.sh
#CMD ["/bin/bash", "-l"]
