FROM alpine:3.18

# Set the shell environment
COPY docker_container_profile /root/.bash_profile

# Install
RUN \
  apk update && \
  apk --no-cache add \
    bash \
    shadow \
    vsftpd

ENV TZ Europe/Berlin

# User
RUN \
  addgroup -g 1000 foto && \
  adduser  -u 1000 -D -G foto -h /ftp -H -s /bin/false foto

COPY start.sh /
CMD /start.sh
# CMD ["/usr/bin/tail", "-f", "/dev/null"]

EXPOSE 3873
VOLUME /ftp
