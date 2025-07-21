# certbot

## First run to get initial certificates

```
docker compose run --rm certbot /bin/bash -l
/usr/bin/certbot certonly
2
<Enter>
y
wyse.heine7.de
/var/letsencrypt
2 (for each certificate)
```

## List existing certificates

```
docker compose run --rm certbot /bin/bash -l
/usr/bin/certbot certificates
```

## Expand to a new subdomain

Neuen Domainnamen erstellen:
- Strato
- Domain & Mail
- Domains verwalten
- heine7.de -> Zahnrad
- DNS
- TXT- und CNAME-Record / verwalten
- Weiteren Record erstellen
- Typ: CNAME
- Präfix: <subdomain>.heine7.de
- Wert: heine7.de.
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
