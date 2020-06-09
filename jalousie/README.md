# docker setup for the `jalousie` raspi

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

sudo vi /boot/config.txt
# Required for pigpio (in jalousie nodejs) to restart after an unclean shutdown
# gpu_mem=32

sudo systemctl disable hciuart

sudo vi /boot/cmdline.txt
# <remove all console entries>
```

### Configure apt and install needed packages

```
# still needed???? curl -L "https://packagecloud.io/Hypriot/rpi/gpgkey" 2> /dev/null | sudo apt-key add -
sudo apt update
sudo apt upgrade -y
sudo apt install -y nfs-common vim

echo "SELECTED_EDITOR=\"/usr/bin/vim.basic\"" > .selected-editor

echo "# Forcing the qnap/192.168.6.7 mounts to nfsvers=3, as nfs4 causes i/o errors
# while [ true ]; do echo `date` > dieZeit; cat dieZeit; sleep 1; done
192.168.6.7:/linux /mnt/qnap_linux nfs nfsvers=3,soft 0 0" | sudo tee -a /etc/fstab >/dev/null
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

passwd
# Set new password

sudo reboot
```

### Prepare for docker

```
sudo mkdir /docker-data
sudo mkdir /docker-data/portainer

git config --global core.editor vim
git config --edit --global
# Enter name and arcor email
git clone git@github.com:stheine/docker-infrastructure.git
ln -s docker-infrastructure/jalousie docker

cp docker/docker_host_system__profile .profile

cd docker/jalousie
git clone git@github.com:stheine/jalousie.git

cd ..
docker-compose up -d
```

### Configure portainer

- http://192.168.6.11:8008/#/init/admin
- admin
- &lt;pw&gt;
- Create user
- Local
- Connect

### Check postfix

```
docker-compose exec postfix /bin/sh -c '/bin/echo -e "testing email\n\nsent on: $(date)\n\n$(hostname)" | /usr/bin/mail -s "test cli email $(date)" stefan@heine7.de'
```

### Check Vito

```
docker-compose exec vito /bin/bash -c /vito/checkAccess.sh
docker-compose exec vito /bin/sh -c '/bin/echo -e "testing email\n\nsent on: $(date)\n\n$(hostname)" | /usr/bin/mail -s "test cli email $(date)" stefan@heine7.de'
```

### Setup jalousie (npm install missing)

```
docker-compose stop jalousie
docker-compose run --rm jalousie /bin/bash -l

npm install
exit

docker-compose up -d jalousie
docker-compose logs --tail 100 --follow jalousie
```
