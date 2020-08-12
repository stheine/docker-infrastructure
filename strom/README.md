# docker setup for the `strom` raspi

## System setup

### Hypriot

- download hypriot from https://blog.hypriot.com/downloads/
- write to SD card
- boot raspi
- ssh to system
- pirate / hypriot

### Enable UART / Serial interface

```
echo "# Enable the optional hardware interface, SPI
dtparam=spi=on

# Enable UART
enable_uart=1

# Disable bluetooth
dtoverlay=pi3-disable-bt
dtoverlay=pi3-miniuart-bt" | sudo tee -a /boot/config.txt >/dev/null

sudo systemctl disable hciuart

sudo vi /boot/cmdline.txt
# <remove all console entries>
```

### Set hostname
```
sudo hostnamectl set-hostname --static pi-strom
sudo vi /etc/cloud/cloud.cfg
# Change preserve_hostname: true
```

### Configure apt and install needed packages

```
curl -L "https://packagecloud.io/Hypriot/rpi/gpgkey" 2> /dev/null | sudo apt-key add -
sudo apt update
sudo apt upgrade
sudo apt install -y nfs-common vim

echo "SELECTED_EDITOR=\"/usr/bin/vim.basic\"" > .selected-editor

# Forcing the qnap/192.168.6.7 mounts to nfsvers=3, as nfs4 causes i/o errors
# while [ true ]; do echo `date` > dieZeit; cat dieZeit; sleep 1; done
echo "192.168.6.7:/linux /mnt/qnap_linux nfs nfsvers=3,soft 0 0" | sudo tee -a /etc/fstab >/dev/null
sudo mkdir /mnt/qnap_linux
sudo mount -a

echo "@reboot /bin/sleep 20 && /bin/mount -a" | sudo tee -a /var/spool/cron/crontabs/root >/dev/null
```

### Setup ssh access key

```
mkdir .ssh
sudo cp /mnt/qnap_linux/data/sshd_certs/strom .ssh/id_rsa
sudo cp /mnt/qnap_linux/data/sshd_certs/strom.pub .ssh/id_rsa.pub
sudo cat /mnt/qnap_linux/data/sshd_certs/bonsai.pub  >> .ssh/authorized_keys
sudo chown -R pirate:pirate .ssh
chmod 700 .ssh
chmod 600 .ssh/id_rsa
chmod 644 .ssh/id_rsa.pub
chmod 644 .ssh/authorized_keys

sudo reboot
```

### Prepare for docker

```
sudo systemctl disable systemd-resolved.service
sudo systemctl stop systemd-resolved

sudo mkdir /docker-data
sudo mkdir /docker-data/portainer
# sudo mkdir /docker-data/pihole
# sudo mkdir /docker-data/pihole/etc_pihole
# sudo mkdir /docker-data/pihole/etc_dnsmasq.d

git config --global core.editor vim
git config --edit --global
# Enter name and arcor email
git clone git@github.com:stheine/docker-infrastructure.git

ln -s docker-infrastructure/strom docker
cp docker/docker_host_system__profile .profile
cd docker
docker-compose build
docker-compose up -d
```

### Install and Configure pihole

Note, pihole docker does not function on armv6, so it has to be installed locally, outside docker

```
curl -sSL https://install.pi-hole.net | bash

# Set web admin password
pihole -a -p
```

# /docker-data/pihole/etc_pihole
# /docker-data/pihole/etc_dnsmasq.d
# - ServerIP=192.168.6.6
# - WEBPASSWORD=1234

- http://192.168.6.6/admin/index.php
- Login
- &lt;pw&gt;
- Settings
- DNS
- Upstream: `OpenDNS`
- disable `Never forward non-FQDNs`
- disable `Never forward reverse lookups for private IP ranges`
- enable `Use conditional forwarding`
- IP: `192.168.6.1`
- domain name: `fritz.box`

### Configure FritzBox

- http://192.168.6.1
- &lt;pw&gt;
- Internet/ Zugangsdaten/ DNS-Server
- enable `Andere DNSv4-Server verwenden`
- Bevorzugt: `192.168.6.6`
- Alternativ: `8.8.8.8`
- Uebernehmen
- Heimnetz/ Netzwerk/ Netzwerkeinstellungen/ IPv4-Addressen
- Lokaler DNS-Server: `192.168.6.6`

### Configure portainer

- http://192.168.6.6:8008/#/init/admin
- admin
- &lt;pw&gt;
- Create user
- Local
- Connect

### Install strom

```
docker-compose run --rm strom /bin/bash -l
cd /app
npm install
exit

docker-compose up -d
```

### Check strom

```
sudo apt install -y minicom
sudo minicom
```
- CTRL-A Z
- o
- Serial port setup
- a /dev/ttyAMA0
- e cq ENTER ENTER (9600 8N1)
- Save setup as dfl
- Should see data coming in
