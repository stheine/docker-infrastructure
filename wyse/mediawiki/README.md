# Installation

- Comment out the docker volume `./mediawiki/LocalSettings.php:/var/www/html/LocalSettings.php:ro`
- Startup the wiki
```
docker-compose up -d mediawiki
```
- Run the mediawiki installer
https://wiki.heine7.de/mw-config/index.php
- Your language: `de`
- Wiki language: `de`
- continue
- weiter
- weiter
- [x] MariaDb, MySQL
- Datenbankserver: `mediawiki-database`
- Name der Datenbank: `my_wiki`
- Name des Datenbankbenutzers: `wikiuser`
- Passwort des Datenbankbenutzers: `example`
- weiter
- [x] Dasselbe Datenbankkonto
- [x] InnoDB
- weiter
- Name: `heine7Wiki`
- Projektnamensraum: [x] Entspricht dem Namen des Wikis: Heine7Wiki
- Benutzername: `Heine7`
- Password: `<pw>`
- Email: `stefan@heine7.de`
- [ ] Mailingliste
- [ ] Daten teilen
- [x] weitere Konfigurationseinstellungen
- weiter
- Benutzerberechtigungen: [x] Erstellung eines Benutzerkontos erforderlich
- Lizenz: [x] GNU
- Antwort email: `technik@heine7.de`
- Erweiterungen:
- [x] <alle>
- [x] Das Hochladen von Dateien ermögliche
- weiter
- weiter
- weiter
- Stop the wiki
```
docker-compose stop mediawiki
```
- Move the generated `LocalSettings.php` file into place
- Activate the docker volume `./mediawiki/LocalSettings.php:/var/www/html/LocalSettings.php:ro`
- Startup the wiki
```
docker-compose up -d mediawiki
```
- Access wiki
https://wiki.heine7.de
- Try to login
- In case of "Es gab ein Problem bei der Uebertragung deiner Benutzerdaten.", change `$wgMainCacheType = CACHE_DB;`.

# Restore database

```
docker-compose exec mediawiki-database /bin/sh -l
mysqlshow
mysql -e "drop database my_wiki; create database my_wiki;"
gunzip -c restore.log.gz /database-restore/daily/my_wiki/my_wiki_2019-07-15_06h34m.Monday.sql.gz | mysql my_wiki
```

# Upgrading

See instructions in Dockerfile
