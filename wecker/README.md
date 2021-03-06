# docker setup for the `wecker` raspi

## Raspbian

Note, Hypriot does not work for wecker, since it doesn't contain the necessary Hifiberry overlay.

Install, according to https://wiki.heine7.de/index.php/Raspbian

### Set hostname
```
sudo hostnamectl set-hostname --static pi-wecker
```

### Configure apt and install needed packages

```
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
sudo chown -R pi:pi .ssh
chmod 700 .ssh
chmod 600 .ssh/id_rsa
chmod 644 .ssh/id_rsa.pub
chmod 644 .ssh/authorized_keys

passwd
# Set new password

sudo raspi-config
# - Localisation
# - Timezone
# - Europe
# - Berlin
# - Finish
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

[all]
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

### Install docker & docker-compose
```
curl -fsSL get.docker.com -o get-docker.sh && sh get-docker.sh
sudo usermod -aG docker pi
```

Logout / Login

```
sudo apt-get install -y libffi-dev libssl-dev python3 python3-dev python3-pip
sudo apt-get remove -y python-configparser
sudo pip3 install docker-compose
```

### Prepare for docker

```
sudo mkdir /docker-data
sudo mkdir /docker-data/portainer
sudo mkdir /docker-data/wecker

sudo apt-get install -y git

git config --global core.editor "vim"
git config --global user.email "stheine@arcor.de"
git config --global user.name "Stefan Heine"
git clone git@github.com:stheine/docker-infrastructure.git
ln -s docker-infrastructure/wecker docker

cp docker/docker_host_system__profile .profile

cd docker/wecker
git clone git@github.com:stheine/wecker.git app

cd app
git clone git@github.com:stheine/mpg123.git

amixer set Master 60%
```

Logout & Login again

```
cd docker
docker-compose build wecker
docker-compose run --rm wecker /bin/bash -l

npm install
exit

docker-compose up -d
```

### Check wecker

```
docker-compose logs --tail 10 --follow wecker
```

### Configure portainer

- http://192.168.6.15:8008/#/init/admin
- admin
- &lt;pw&gt;
- Create user
- Local
- Connect
