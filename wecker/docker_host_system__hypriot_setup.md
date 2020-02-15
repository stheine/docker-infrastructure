# Install

## Install Hypriot (1.8.0)
http://blog.hypriot.com/downloads/
download, write to SD card, and boot in raspi
```
ssh pirate@<new IP>
passwd
# hypriot -> <secret password>

# Update the 'hostname'
sudo vi /etc/hostname

sudo dpkg-reconfigure tzdata

sudo apt-get update
sudo apt-get install -y cifs-utils nfs-common vim dnsutils
sudo mkdir /mnt/mybook_data
echo '192.168.6.22:/nfs/Data /mnt/mybook_data nfs defaults 0 0' | sudo tee -a /etc/fstab
sudo mkdir /mnt/fritz_nas_hd
echo '//fritz.nas/fritz.nas/Fritz_NAS_HD /mnt/fritz_nas_hd cifs username=fritz.nas,password=nas 0 0' | sudo tee -a /etc/fstab
sudo mount -a

cat /etc/logrotate.conf | sed 's/^#compress/delaycompress/' | sudo tee /etc/logrotate.conf.tmp
sudo mv /etc/logrotate.conf.tmp  /etc/logrotate.conf
 
cat /mnt/mybook_data/linux/docker/docker_host_system__profile >> .profile

mkdir .ssh
cat /mnt/mybook_data/linux/sshd_certs/bonsai.pub >> .ssh/authorized_keys
cat /mnt/mybook_data/linux/sshd_certs/ssh/stheine@redwood.pub >> .ssh/authorized_keys
sudo vi /etc/ssh/sshd_config
```
PasswordAuthentication no
```
sudo /etc/init.d/ssh restart

cat /mnt/mybook_data/linux/docker/vimrc >> .vimrc

sudo update-alternatives --install /usr/bin/editor editor /usr/bin/vim 100
sudo update-alternatives --set editor /usr/bin/vim

```

log out and log in again to make the new profile settings active


## Allow access to the GPIO serial port

https://github.com/openv/openv/wiki/Bauanleitung-RaspberryPi
https://www.raspberrypi.org/documentation/configuration/uart.md
https://www.raspberrypi.org/documentation/configuration/config-txt/boot.md
https://spellfoundry.com/2016/05/29/configuring-gpio-serial-port-raspbian-jessie-including-pi-3/

```
sudo vi /boot/cmdline.txt
```
> remove the references to tty and serial

```
sudo vi /boot/config.txt
```
> \# Enable the optional hardware interface, SPI
>
> dtparam=spi=on
>
> \# Enable UART
>
> enable_uart=1
> 
> \# Disable bluetooth
>
> dtoverlay=pi3-disable-bt
> dtoverlay=pi3-miniuart-bt
> 
> \# Allow higher USB current
>
> \# max_usb_current=1

https://www.raspberrypi.org/documentation/configuration/uart.md

```
sudo vi /etc/inittab
```
> comment out the reference to ttyAMA0

```
sudo systemctl disable hciuart
```

## Allow docker access to CIFS filesystem
#
#2018-04-04 this is not working, but results in 
#ERROR: for twonky  Cannot start service twonky: error while mounting volume '/var/lib/docker-volumes/netshare/cifs/docker_nas_fritzbox': VolumeDriver.Mount: exit status 32
#so I switched to mounting the filesystem on the host and binding to the container.
#
#https://github.com/gondor/docker-volume-netshare/blob/master/README.md
#
#```
#wget https://github.com/ContainX/docker-volume-netshare/releases/download/v0.34/docker-volume-netshare_0.34_armhf.deb
#sudo dpkg -i docker-volume-netshare_0.34_armhf.deb
#rm docker-volume-netshare_0.34_armhf.deb
#
#sudo vi /etc/default/docker-volume-netshare
#```
#> DKV_NETSHARE_OPTS="cifs"
#```
#sudo vi ~root/.netrc
#```
#machine fritz.nas
#  username  fritz.nas
#  password  nas
#```
#sudo systemctl enable docker-volume-netshare
#sudo systemctl start docker-volume-netshare
#```

## Allow email on the host

```
sudo apt-get install -y mailutils ssmtp
echo "mailhub=localhost" | sudo tee /etc/ssmtp/ssmtp.conf
```

Test (after the postfix container is running):
```
/usr/sbin/sendmail -t <<-EOF
From: pirate <technik@heine7.de>
To: stefan@heine7.de
Subject: test

test mail
EOF
```

## Reboot to make all the changes active

```
sudo reboot
```

## Docker related tasks
```
git config --global user.email "stheine@arcor.de"
git config --global user.name "Stefan Heine"
git config --global push.default simple

cp /mnt/mybook_data/linux/sshd_certs/pirate ~/.ssh/id_rsa
cp /mnt/mybook_data/linux/sshd_certs/pirate.pub ~/.ssh/id_rsa.pub
ssh -T git@github.com
# accept the host's fingerprint

ln -s /mnt/mybook_data/linux/docker /home/pirate/

cd docker
docker-compose build

./run.sh

crontab -e
```
> @reboot (sleep 30s ; cd /mnt/mybook_data/linux/docker ; /usr/local/bin/docker-compose up -d )&

# Let's Encrypt

https://miki725.github.io/docker/crypto/2017/01/29/docker+nginx+letsencrypt.html
https://certbot.eff.org/#debianother-other

```
crontab -e
```
> 26 0,12 10,20,30 * * /usr/local/bin/docker-compose run certbot

# Maintenance

## Docker cleanup

```
docker system prune
docker volume prune
```

# References

https://www.heise.de/developer/artikel/Ein-Container-voller-Himbeeren-Docker-auf-dem-Raspberry-Pi-2572533.html

https://www.golem.de/news/docker-auf-dem-raspberry-pi-mit-hypriot-gut-verpackt-1711-130639-3.html
