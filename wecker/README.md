# docker setup for the `wecker` raspi

## Hypriot

- download hypriot from https://blog.hypriot.com/downloads/
- write to SD card
- update `/boot/user-data`
```
# Set your hostname here, the manage_etc_hosts will update the hosts file entries as well
hostname: wecker
manage_etc_hosts: true

# You could modify this for your own user information
users:
  - name: pirate
    gecos: "Hypriot Pirate"
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    groups: users,docker,video,input
    plain_text_passwd: hypriot
    lock_passwd: false
    ssh_pwauth: true
    chpasswd: { expire: false }

# # Set the locale of the system
# locale: "en_US.UTF-8"

# # Set the timezone
# # Value of 'timezone' must exist in /usr/share/zoneinfo
timezone: "Europe/Berlin"

# # Update apt packages on first boot
# package_update: true
# package_upgrade: true
# package_reboot_if_required: true
package_upgrade: false

# # Install any additional apt packages you need here
packages:
  - ntp
  - nfs-common
  - vim

# # WiFi connect to HotSpot
# # - use `wpa_passphrase SSID PASSWORD` to encrypt the psk
write_files:
  - content: |
      allow-hotplug wlan0
      iface wlan0 inet dhcp
      wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf
      iface default inet dhcp
    path: /etc/network/interfaces.d/wlan0
  - content: |
      country=de
      ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
      update_config=1
      network={
      ssid="holzhaus"
      psk="<enter the wifi key>"
      proto=RSN
      key_mgmt=WPA-PSK
      pairwise=CCMP
      auth_alg=OPEN
      }
    path: /etc/wpa_supplicant/wpa_supplicant.conf

# These commands will be ran once on first boot only
runcmd:
  # Pickup the hostname changes
  - 'systemctl restart avahi-daemon'

  # Activate WiFi interface
  - 'ifup wlan0'
```
- boot raspi
- ssh to system
- pirate / hypriot

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
sudo chown -R pirate:pirate .ssh
chmod 700 .ssh
chmod 600 .ssh/id_rsa
chmod 644 .ssh/id_rsa.pub
chmod 644 .ssh/authorized_keys

passwd
# Set new password
```

### Special hardware support

https://www.alsa-project.org/

/boot/config.txt

```
# Disable GPIO interrupts (https://www.npmjs.com/package/rpio)
# interferes with the input devices/ rotary encoder dtoverlay=gpio-no-irq

# Disable build-in audio (snd_bcm2835)
dtparam=audio=off

# Enable the optional hardware interfaces
dtparam=i2c_arm=on
dtparam=i2c1=on
dtparam=i2c=on
dtparam=i2c_arm_baudrate=1000000

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
```

### Reboot
```
sudo reboot
```

### Prepare for docker

```
sudo mkdir /docker-data
sudo mkdir /docker-data/portainer
sudo mkdir /docker-data/wecker

git config --global core.editor "vim"
git config --global user.email "stheine@arcor.de"
git config --global user.name "Stefan Heine"
git clone git@github.com:stheine/docker-infrastructure.git
ln -s docker-infrastructure/wecker docker

cp docker/docker_host_system__profile .profile

cd docker/wecker
git clone git@github.com:stheine/wecker.git
mv wecker app

cd app
git clone https://github.com/suldashi/node-lame
```

Logout & Login again

```
cd docker
docker-compose build wecker
docker-compose run wecker /bin/bash -l

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
- <pw>
- Create user
- Local
- Connect
