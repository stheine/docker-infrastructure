# docker setup for the `wecker` raspi

## Raspberry PI OS

2024, Raspbian 11, bullseye

Install, according to https://wiki.heine7.de/index.php/Raspbian

### Set hostname
```
sudo hostnamectl set-hostname --static pi-wecker
```

### Configure apt and install needed packages

```
sudo apt update
sudo apt upgrade -y
sudo apt install -y nfs-common vim git

echo "192.168.6.7:/linux /mnt/qnap_linux/ nfs defaults 0 0" | sudo tee -a /etc/fstab >/dev/null
sudo mkdir /mnt/qnap_linux
sudo mount -a

echo "@reboot /bin/sleep 10 && /bin/mount -a" | sudo tee -a /var/spool/cron/crontabs/root >/dev/null
```

### Setup ssh access key

```
ssh-keygen
# Add the key to github
```

### Special hardware support

/boot/config.txt

```
# Enable Hifiberry Miniamp
dtoverlay=hifiberry-dac

# Enable the optional hardware interfaces
dtparam=i2c1=on
dtparam=i2c_arm=on
dtparam=i2c_arm_baudrate=1000000

# Enable rotary encoder
# https://blog.ploetzli.ch/2018/ky-040-rotary-encoder-linux-raspberry-pi/
dtoverlay=rotary-encoder,pin_a=22,pin_b=27,relative_axis=1
dtoverlay=gpio-key,gpio=17,keycode=28,label="ENTER"
dtoverlay=rotary-encoder,pin_a=12,pin_b=4,relative_axis=1
dtoverlay=gpio-key,gpio=23,keycode=28,label="ENTER"

[pi3]
# Disable Bluetooth
dtoverlay=pi3-disable-bt

[pi4]
# Disable Bluetooth
dtoverlay=pi3-disable-bt
```

### Swap

Since the Raspberry Pi Zero has little memory, it might be required to add a swapfile
(eg. `npm install` results in `npm ERR! code ENOMEM`).

```
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
```

### Reboot

```
sudo reboot
```

### Test Audio (not really required on the host)

sudo vi /etc/asound.conf
```
pcm.hifiberry {
    type softvol
    slave.pcm "plughw:0"
    control.name "Master"
    control.card 0
}

pcm.!default {
    type             plug
    slave.pcm       "hifiberry"
}
```

speaker-test --channels 2 --test pink --nperiods 2

### Mail

```
sudo apt install nullmailer
# wyse.fritz.box smtp --port=25
```

### Install docker & docker-compose
https://wiki.heine7.de/index.php/docker_%2B_docker-compose#Installation

```
sudo usermod -aG docker pi
```

### Prepare for docker

```
git config --global core.editor "vim"
git config --global user.email "stheine@arcor.de"
git config --global user.name "Stefan Heine"
git clone git@github.com:stheine/docker-infrastructure.git
ln -s docker-infrastructure/wecker docker

cp docker/docker_host_system__profile .profile

cd docker/wecker
git clone git@github.com:stheine/wecker.git app

amixer set Master 60%

cd ../../docker/watchdog
git clone git@github.com:stheine/watchdog.git app
```

Logout & Login again

```
cd docker

docker-compose build wecker
docker-compose run wecker npm install

docker-compose build watchdog
docker-compose run watchdog npm install

docker-compose up -d
```

### Check wecker

```
docker-compose logs --tail 10 --follow wecker
```
