ARG BASE_IMAGE=alpine:3.17
FROM ${BASE_IMAGE} AS builder

RUN apk add --no-cache  \
    bash \
    cmake zlib-dev \
    curl-dev \
    duktape-dev \
    ffmpeg-dev \
    ffmpegthumbnailer-dev \
    file-dev \
    fmt-dev \
    g++ \
    gcc \
    git \
    libebml-dev \
    libexif-dev \
    libmatroska-dev \
    make \
    mariadb-connector-c-dev \
    pkgconf \
    pugixml-dev \
    spdlog-dev \
    sqlite-dev \
    taglib-dev \
    tini \
    util-linux-dev \
    # packages to build libupnp
    autoconf \
    automake \
    libtool \
    file


# ##############################################################################
# Install and run from https://github.com/gerbera/gerbera

ARG GERBERA_VERSION=1.12.1
WORKDIR /source

RUN \
  wget https://github.com/gerbera/gerbera/archive/v${GERBERA_VERSION}.zip && \
  unzip v${GERBERA_VERSION}.zip && \
  mv gerbera-${GERBERA_VERSION} /gerbera_build

# Build libupnp
WORKDIR /libupnp_build
RUN cp /gerbera_build/scripts/install-pupnp.sh /gerbera_build/scripts/versions.sh ./
RUN ./install-pupnp.sh

WORKDIR /gerbera_build

RUN cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CXX_FLAGS=-g1 \
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
    cmake --build build -v -j$(nproc)

FROM ${BASE_IMAGE} AS gerbera
RUN apk add --no-cache \
    curl \
    duktape \
    ffmpeg-libs \
    ffmpegthumbnailer \
    file \
    fmt \
    libebml \
    libexif \
    libmatroska \
    mariadb-connector-c \
    pugixml \
    spdlog \
    sqlite \
    sqlite-libs \
    su-exec \
    taglib \
    tini \
    tzdata \
    util-linux \
    zlib

# Copy libupnp
COPY --from=builder /usr/local/lib/libixml.so.* /usr/local/lib/libupnp.so.* /usr/lib/

# Gerbera itself
COPY --from=builder /gerbera_build/build/gerbera /bin/gerbera
COPY --from=builder /gerbera_build/scripts/js /usr/local/share/gerbera/js
COPY --from=builder /gerbera_build/web /usr/local/share/gerbera/web
COPY --from=builder /gerbera_build/src/database/*/*.sql /gerbera_build/src/database/*/*.xml /usr/local/share/gerbera/
COPY --from=builder /gerbera_build/scripts/docker/docker-entrypoint.sh /usr/local/bin

RUN addgroup -S gerbera 2>/dev/null && \
    adduser -S -D -H -h /var/run/gerbera -s /sbin/nologin -G gerbera -g gerbera gerbera 2>/dev/null && \
    mkdir /var/run/gerbera/ && chmod 2775 /var/run/gerbera/

COPY gerbera.sh /

ENTRYPOINT ["/sbin/tini", "--"]
CMD /gerbera.sh

FROM gerbera AS with_transcoding
RUN apk add --no-cache \
    ffmpeg \
    libheif-tools \
    vlc

RUN apk add bash
COPY docker_container_profile /root/.profile

#CMD ["/bin/bash", "-l"]

FROM gerbera AS default
