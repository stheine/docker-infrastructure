# Backup

https://www.mediawiki.org/wiki/Manual:Backing_up_a_wiki/de

# Restore

docker-compose stop mediawiki mediawiki-database-backup
docker-compose start mediawiki-database
docker-compose exec mediawiki-database /bin/sh

=> get the backup file into the container
gibt's da nicht ein docker copy command?
gunzip backup file

mysql -u root -p
<empty pw>
drop database my_wiki;
create database my_wiki;
exit
mysql -u root -p my_wiki < <backup_file>

Im Falle eines mediawiki version upgrades:
docker-compose exec mediawiki /usr/local/bin/php /var/www/html/maintenance/update.php
