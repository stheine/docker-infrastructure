# docker setup for the `wecker` raspi

## System setup

### Install

Currently this is a plain raspbian with `docker` and `docker-compose`

```
sudo apt-get install apt-transport-https ca-certificates software-properties-common -y
curl -fsSL get.docker.com -o get-docker.sh && sh get-docker.sh
sudo usermod -aG docker pi
# Logout and login again

sudo curl https://download.docker.com/linux/raspbian/gpg
sudo vim /etc/apt/sources.list
# Add this line
deb https://download.docker.com/linux/raspbian/ stretch stable

sudo apt-get update
sudo apt-get upgrade
systemctl start docker.service
systemctl enable docker.service

docker info
```

```
sudo apt-get install -y python3-pip python3-dev
sudo pip3 install docker-compose
docker-compose --version
```

### Special hardware support

https://www.alsa-project.org/

/boot/config.txt

```
# Enable the optional hardware interfaces
dtparam=i2c_arm=on
dtparam=i2c1=on
dtparam=i2c=on
dtparam=i2c_arm_baudrate=1000000

# Disable build-in audio (snd_bcm2835)
dtparam=audio=off

# Enable rotary encoder
# https://blog.ploetzli.ch/2018/ky-040-rotary-encoder-linux-raspberry-pi/
dtoverlay=rotary-encoder,pin_a=16,pin_b=20,relative_axis=1
dtoverlay=gpio-key,gpio=21,keycode=28,label="ENTER"
dtoverlay=rotary-encoder,pin_a=05,pin_b=06,relative_axis=1
dtoverlay=gpio-key,gpio=13,keycode=28,label="ENTER"

# Enable UART
enable_uart=1

# Disable Bluetooth
dtoverlay=pi3-disable-bt
dtoverlay=pi3-miniuart-bt

# Allow higher USB current (not sure if this actually works)
max_usb_current=1
```

### Check wecker

```
docker-compose logs --tail 100 --follow wecker
```
