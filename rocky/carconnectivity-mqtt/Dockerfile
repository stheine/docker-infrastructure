FROM tillsteinbach/carconnectivity-mqtt:latest

RUN \
  apt update && \
  apt install -y git && \
  git clone https://github.com/mikrohard/CarConnectivity-connector-vw-eu-data-act.git && \
  cd CarConnectivity-connector-vw-eu-data-act && \
  pip install -e .
