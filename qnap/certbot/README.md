# List existing certificates

```
docker-compose run --rm certbot /bin/bash -l
/certbot/certbot-auto certificates
```

# Expand to a new subdomain

```
docker-compose run --rm certbot /bin/bash -l
/usr/bin/openssl x509 -in cert.pem -text -noout | grep DNS
/usr/bin/certbot certonly --webroot --webroot-path=/var/letsencrypt -d heine7.de -d wiki.heine7.de -d home.heine7.de -d bitwarden.heine7.de
exit
docker-compose kill -s HUP dovecot
docker-compose kill -s HUP nginx
```
