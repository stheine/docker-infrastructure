FROM python:3.13

ENV TZ Europe/Berlin

WORKDIR /usr/src/app

RUN \
  apt update && \
  apt install -y \
    bluez \
    vim

RUN \
  pip install asyncio-paho && \
  pip install casambi-bt && \
  pip install paho-mqtt

# # https://github.com/lkempf/casambi-bt/issues/42
# # https://github.com/hbldh/bleak/issues/1885
# RUN \
#   sed -i -e 's/use_notify_acquire = "NotifyAcquired".*$/use_notify_acquire = False/' \ 
#     /usr/local/lib/python3.13/site-packages/bleak/backends/bluezdbus/client.py

# COPY casambi-mqtt.py .

COPY docker_container_profile /root/.profile

CMD ["python", "/usr/src/app/casambi-mqtt.py"]
# CMD ["/usr/bin/tail", "-f", "/dev/null"]
