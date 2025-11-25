# docker setup for the `jalousie` raspi

## System setup

### Raspberry Pi OS

- `rpi-imager`
- `Raspberry Pi 3`
- `Raspberry Pi OS (other) / Raspberry Pi OS (64-bit) Lite (Trixie)`
- Next
- Edit settings
  - General: 
    - [x] Set hostname `jalousie`
    - [x] Set username and password
    - [x] Set locale settings, Time zone `Europe/Berlin`
  - Services:
    - [x] Enable SSH
    - [x] Allow public-key authentication only, enter `authorized_key`
   - Save
- Yes
- Write to SD Card
- Boot with new SD Card
- ssh into server

### Enable Serial interface

```
sudo vi /boot/firmware/config.txt
```

```
# Enable the optional hardware interface, SPI
dtparam=spi=on

dtoverlay=disable-wifi
dtoverlay=disable-bt
```

### Install NFS and vim

```
sudo apt update && \
sudo apt upgrade -y && \
sudo apt install -y nfs-common vim

sudo reboot

echo "SELECTED_EDITOR=\"/usr/bin/vim.basic\"" > .selected-editor

echo "192.168.6.7:/linux /mnt/qnap_linux nfs defaults,_netdev,bg,soft 0 0" | sudo tee -a /etc/fstab >/dev/null
sudo mkdir /mnt/qnap_linux
sudo mount -a

echo "@reboot /bin/sleep 20 && /bin/mount -a" | sudo tee -a /var/spool/cron/crontabs/root >/dev/null
```

### Prepare for git access

```
ssh-keygen

cat ~/.ssh/id_rsa.pub
```

https://github.com/settings/keys
Add the new SSH key into the git allowed SSH keys

### Install docker

https://docs.docker.com/engine/install/raspberry-pi-os/

```
sudo vi /etc/docker/daemon.json

{
  "dns": ["192.168.6.1"]
}

sudo service docker restart
```

### Prepare for docker

```
git config --global core.editor vim
git config --global user.email stheine@arcor.de
git config --global user.name 'Stefan Heine'

git clone git@github.com:stheine/docker-infrastructure.git
ln -s docker-infrastructure/jalousie docker

cp docker/docker_host_system__profile .profile

# Log out and in

mkdir /var/opt/pihole
cd ~/docker
docker compose up -d pihole
docker compose exec pihole pihole setpassword

cd ~/docker/jalousie-backend
git clone git@github.com:stheine/jalousie-backend.git app/

cd ~/docker/jalousie-io
git clone git@github.com:stheine/jalousie-io.git app/

cd ~/docker/watchdog
git clone git@github.com:stheine/watchdog.git app/

cd ~/docker
docker compose build

docker compose run --rm jalousie-backend npm install
docker compose run --rm jalousie-io npm install
docker compose run --rm watchdog npm install

docker compose up -d
```

### Check postfix

```
sudo apt install nullmailer

<hostname>
wyse.fritz.box smtp --port=25
```
