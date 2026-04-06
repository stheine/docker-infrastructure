# Label console
echo -e "${HEADER}Log 1${CTLG}\c"

docker compose logs --tail 30 --follow fronius-battery noop
