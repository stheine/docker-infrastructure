FROM python:3.13

WORKDIR /usr/src/app

RUN \
  pip install asyncio-paho && \
  pip install casambi-bt && \
  pip install paho-mqtt

# TODO copy script instead of docker volume mount

COPY docker_container_profile /root/.profile

CMD ["python", "./casambi-mqtt.py"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
