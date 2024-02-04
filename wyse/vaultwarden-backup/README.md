# Reference

https://github.com/dani-garcia/vaultwarden/wiki/Backing-up-your-vault

# Create a database dump

```
sqlite3 data/db.sqlite3 ".backup /backup.sqlite"
```

# Prepare for the raw sqlite database file backup

Force truncating the database write-ahead log file into the database file

https://www.sqlite.org/pragma.html#pragma_wal_checkpoint

```
sqlite3 data/db.sqlite3 'PRAGMA wal_checkpoint(TRUNCATE);'
```
