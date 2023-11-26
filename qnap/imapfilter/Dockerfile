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

WORKDIR /source

RUN \
  wget https://github.com/lefcha/imapfilter/archive/master.zip && \
  unzip master.zip

WORKDIR /source/imapfilter-master

RUN \
  make all && \
  make install

RUN \
  apk del alpine-sdk && \
  cd .. && \
  rm -r imapfilter-master && \
  rm master.zip

WORKDIR /

RUN \
  apk add \
    luarocks \
    tzdata && \
  luarocks-5.1 install luatz

ENV TZ Europe/Berlin

RUN \
  apk add \
    bash \
    mandoc \
    man-pages
COPY docker_container_profile /root/.profile

CMD ["imapfilter"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
