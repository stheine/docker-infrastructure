FROM alpine:latest

RUN \
  apk update && \
  apk --no-cache add \
    bash \
    tzdata && \
  cp /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
  echo "Europe/Berlin" > /etc/timezone && \
  apk del tzdata

ENV TZ Europe/Berlin

CMD ["/usr/bin/tail", "-f", "/dev/null"]
