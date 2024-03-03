# Label console
echo -e "${HEADER}Log 2${CTLG}\c"

docker compose logs \
  --tail 15 \
  --follow \
  comics \
  delete-video \
  fritz \
  mqtt2rrd \
  mqtt-solcast \
  mqtt-strom \
  mqtt-vito \
  mqtt-volumio \
  mqtt-wetter \
  muell \
  noop \
  watchdog
