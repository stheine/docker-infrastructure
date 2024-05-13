# Based on https://github.com/peez80/docker-imapfilter

FROM alpine:latest

RUN \
  apk add \
    alpine-sdk \
    lua5.3 \
    lua-dev \
    make \
    openssl \
    openssl-dev \
    pcre2 \
    pcre2-dev

ENV TZ Europe/Berlin

WORKDIR /source

ARG IMAPFILTER_VERSION=2.8.2

RUN \
  wget https://github.com/lefcha/imapfilter/archive/refs/tags/v${IMAPFILTER_VERSION}.zip && \
  unzip v${IMAPFILTER_VERSION}.zip

WORKDIR /source/imapfilter-${IMAPFILTER_VERSION}

RUN \
  make all && \
  make install

RUN \
  apk del alpine-sdk && \
  cd .. && \
  rm -r imapfilter-${IMAPFILTER_VERSION} && \
  rm v${IMAPFILTER_VERSION}.zip

WORKDIR /

RUN \
  apk add \
    luarocks \
    tzdata && \
  luarocks-5.1 install luatz

RUN \
  apk add \
    bash \
    mandoc \
    man-pages
COPY docker_container_profile /root/.profile

CMD ["imapfilter"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
