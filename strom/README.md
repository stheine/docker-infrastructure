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
# sudo systemctl disable systemd-resolved.service
# sudo systemctl stop systemd-resolved

sudo mkdir /docker-data
sudo mkdir /docker-data/portainer

git config --global core.editor vim
git config --edit --global
# Enter name and arcor email
git clone git@github.com:stheine/docker-infrastructure.git

ln -s docker-infrastructure/strom docker
cp docker/docker_host_system__profile .profile
```

### Install and Configure pihole

Note, pihole docker does not function on armv6, so it has to be installed locally, outside docker

```
curl -sSL https://install.pi-hole.net | bash

# Set web admin password
pihole -a -p
```

- http://192.168.6.6/admin/index.php
- Login
- &lt;pw&gt;
- Settings
- DNS
- Upstream: `OpenDNS`
- [ ] `Never forward non-FQDNs`
- [ ] `Never forward reverse lookups for private IP ranges`
- [x] `Use conditional forwarding`
- Local network: `192.168.6.0/24`
- IP address of DHCP server: `192.168.6.1`
- Local domain name: `fritz.box`

### Update to new version

```
/usr/local/bin/pihole --update
```

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

### Finalize docker setup
Somehow pihole and docker interfere, so that docker containers do not have DNS resolution.
To fix, make docker bypass the pihole DNS.

```
echo "{
  \"dns\": [\"8.8.8.8\"]
}" | sudo tee -a /etc/docker/daemon.json >/dev/null
sudo systemctl restart docker

cd docker
docker-compose build
```

### Install strom
```
docker-compose run --rm strom /bin/bash -l
cd /app
npm install
exit

docker-compose up -d strom
```

### Install watchdog
```
cd watchdog
git clone git@github.com:stheine/watchdog.git
mv watchdog app
cd ..

docker-compose run --rm watchdog /bin/bash -l
cd app
npm install
exit

docker-compose up -d watchdog
```

### Configure portainer
```
docker-compose up -d
```

- http://192.168.6.6:8008/#/init/admin
- admin
- &lt;pw&gt;
- Create user
- Local
- Connect

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

### Overclocking

#### View current state

```
# CPU freq (default 700)
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq # / 1000

# CPU temperate (recommended to keep below 70)
cat /sys/class/thermal/thermal_zone0/temp # / 1000

# CPU info
cat /proc/cpuinfo
```

#### Overclock (raspi-config)

```
sudo /usr/bin/raspi-config
# 6 Overclock
# High
# Finish
# Reboot
```

#### Overclock (manual)

```
sudo vim /boot/config.txt
# arm_freq=1000
# core_freq=500
# sdram_freq=600
# over_voltage=6
```

#### Test

https://elinux.org/index.php?title=RPiconfig&redirect=no#Overclock_stability_test

```
#!/bin/bash
#Simple stress test for system. If it survives this, it's probably stable.
#Free software, GPL2+

echo "Testing overclock stability..."

#Max out all CPU cores. Heats it up, loads the power-supply. 
for ((i=0; i<$(nproc --all); i++)); do nice yes >/dev/null & done

#Read the entire SD card 10x. Tests RAM and I/O
for i in `seq 1 10`; do echo reading: $i; sudo dd if=/dev/mmcblk0 of=/dev/null bs=4M; done

#Writes 512 MB test file, 10x.
for i in `seq 1 10`; do echo writing: $i; dd if=/dev/zero of=deleteme.dat bs=1M count=512; sync; done

#Clean up
killall yes
rm deleteme.dat

#Print summary. Anything nasty will appear in dmesg.
echo -n "CPU freq: " ; cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq
echo -n "CPU temp: " ; cat /sys/class/thermal/thermal_zone0/temp
dmesg | tail 

echo "Not crashed yet, probably stable."
```
