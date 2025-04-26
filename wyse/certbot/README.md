# certbot

## List existing certificates

```
docker compose run --rm certbot /bin/bash -l
/certbot/certbot-auto certificates
```

## Expand to a new subdomain

Neuen Domainnamen erstellen:
- Strato
- Domain & Mail
- Domains verwalten
- Subdomains anzeigen
- heine7.de -> Zahnrad
- Subdomains/ Subdomain anlegen
- <subdomain>.heine7.de.
- Subdomain anlegen
- Subdomains anzeigen
- <subdomain> anklicken
- DNS
- CNAME-Record / verwalten
- CNAME-Eintrag ändern
- <heine7.de>
- [x] Ich bin mir darüber im klaren...
- Einstellung übernehmen

In Zertifikat aufnehmen:
```
docker compose run --rm certbot /bin/bash -l
cd /etc/letsencrypt/live/heine7.de/
/usr/bin/openssl x509 -in cert.pem -text -noout | grep DNS
/usr/bin/certbot certonly --webroot --webroot-path=/var/letsencrypt \
  -d heine7.de \
  -d bitwarden.heine7.de \
  -d cloud.heine7.de \
  -d homer.heine7.de \
  -d immich.heine7.de \
  -d ladder.heine7.de \
  -d paperless.heine7.de \
  -d wiki.heine7.de
# (E)xpand
exit
docker compose kill -s HUP dovecot
docker compose kill -s HUP nginx
```

## Wildcard certificate

Man kann sich folgendermassen ein wildcard Zertifikat besorgen (*.heine7.de), welches automatisch
alle subdomains enthaelt. Allerdings laesst sich dieses nicht automatisch erneuern, da es einen
eintrag im DNS TXT benoetigt, den ich im Strato UI anpassen muss.

certbot certonly --manual --preferred-challenges=dns --email stefan@heine7.de --agree-tos -d heine7.de -d '*.heine7.de'
