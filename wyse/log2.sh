# Label console
echo -e "${HEADER}Log 2${CTLG}\c"

docker compose logs \
  --tail 15 \
  --follow \
  comics \
  delete-video \
  fritz \
  mqtt2rrd \
  mqtt-fenster \
  mqtt-notify \
  mqtt-solcast \
  mqtt-strom \
  mqtt-vito \
  mqtt-wetter \
  muell \
  noop \
  watchdog
