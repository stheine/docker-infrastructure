# Label console
echo -e "${HEADER}Log 3${CTLG}\c"

docker compose logs --tail 30 --follow auto noop
# vwsfriend
