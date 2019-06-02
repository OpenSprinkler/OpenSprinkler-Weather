## Setup a Raspberry Pi To Intercept PWS Information (via Access Point)

The following steps are based on a Raspberry Pi Zero W with an Ethernet/USB adapter to provide two network interfaces. The installation instructions below assume that the Pi's ethernet interface is connect to the Home Network and the PWS will be connected to the Pi's wifi port.

**Step 1: Install Software and Basic Setup**

Install the latest version of Raspbian onto the Pi as per the instructions from the Raspberry Pi Foundation. Do not enable the WiFi interface by providing a `wpa_supplicant.conf` file but do enable `ssh`. You can now `ssh` into the Pi via the ethernet network and contiue the setup process.

We need to install two software packages to allow our Raspberry Pi to connect to our PWS and send the weather information across to our home network. The first, `hostapd`, will provide an access point to connect the PWS, and the second, `bridge-utils`, will route the information from the wifi-side of the rapsberry pi to the ethernet-side:
```
pi@raspberry:~ $ sudo apt-get install hostapd bridge-utils
```
We need to change one of the default Raspberry Pi setting to enable IP forwarding. We will be using this forwarding functionality later in the installation process. The setting can be changed by editing the file `sysctl.conf`:

```
pi@raspberry:~ $ sudo nano /etc/sysctl.conf
```
Uncomment the line "`# net.ipv4.ip_forward=1`" to look as follows and save the file:
```
net.ipv4.ip_forward=1
```
We now have a pretty standard Raspberry Pi installation with the Pi connected to our Home Network via the ethernet interface.

**Step 2: Configure a "Bridge" connecting the Pi's WiFi and Ethernet interfaces**

In order to create a "bridge" between the wifi-side and the ethernet-side of the Pi we need to make a few changes in a file called `dhcp.conf` as follows:
```
pi@raspberry:~ $ sudo nano /etc/dhcpcd.conf
```
Add two line to the end of the file but above any other added interface lines and save the file:
```
denyinterfaces wlan0
denyinterfaces eth0
```

Now the interfaces file needs to be edited to make the two interfaces act as a bridge:
```
pi@raspberry:~ $ sudo nano /etc/network/interfaces
```
Add the following lines to the end of the file:
```
# Bridge setup
auto br0
iface br0 inet manual
bridge_ports eth0 wlan0
```
**Step 3: Setup the WiFi Access Point**

Now we need to provide a mechanism to allow the PWS to connect to the Raspberry Pi's WiFi. We do this using the `hostapd` package to create a dedicated Access Point for the PWS.

You need to edit the hostapd configuration file, located at `/etc/hostapd/hostapd.conf`. This is an empty file so we just need to open it up in an editor add some line from below:
```
pi@raspberry:~ $ sudo nano /etc/hostapd/hostapd.conf
```
Add the information below to the configuration file. This configuration assumes we are using channel `7`, with a network name of `PWSAccessPoint`, and a password `PWSSecretPassword`. Note that the name and password should not have quotes around them. The passphrase should be between 8 and 64 characters in length.

To use the 5 GHz band, you can change the operations mode from hw_mode=g to hw_mode=a. Possible values for hw_mode are:

- a = IEEE 802.11a (5 GHz)
- b = IEEE 802.11b (2.4 GHz)
- g = IEEE 802.11g (2.4 GHz)
- ad = IEEE 802.11ad (60 GHz)
```
interface=wlan0
bridge=br0
ssid=PWSAccessPoint
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=PWSSecretPassword
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP
```
We now need to tell the system where to find this configuration file:
```
pi@raspberry:~ $ sudo nano /etc/default/hostapd
```
Add the line below to the end of the file:
```
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```
We can now activate the Access Point with the following commands:
```
pi@raspberry:~ $ sudo systemctl unmask hostapd
pi@raspberry:~ $ sudo systemctl enable hostapd
```
Reboot the Raspberry Pi for all of these changes to take effect:
```
pi@raspberry:~ $ sudo reboot
```
You should now be able to go to your PWS configuration screen and connect the PWS to this new Access Point. At this point your PWS should be sending weather data to the Weather Underground cloud and you should confirm that is happening to ensure we haven't made any mistakes thus far.

**Step 4: Configure the Intercept (Port Forwarding)**

Now that we have the PWS connected to the Raspberry Pi's WiFi access point and sending information to Weather Underground, we can set-up the intercept to redirect that information to our local Weather Service. We do this by identifying all packets arriving at the Pi from the PWS and heading towards Port 80 (the WU cloud port).

These packets can be redirected to the IP and Port of our local Weather Service using the `iptable` command. We will need to setup the configuration and then save it to a file `iptables.ipv4.nat` so that we can restore the configuration easily after a reboot. When executing the commands below, make sure to substitute <PWS_IP> with your PWS address and to use the IP and Port for your local Weather Service in place of `<Weather Service IP:PORT>`:
```
pi@raspberry:~ $ sudo iptables -t nat -A PREROUTING -m physdev --physdev-in wlan0 -s <PWS IP> -p tcp --dport 80 -j DNAT --to-destination <Weather Service IP:PORT>
pi@raspberry:~ $ sudo sh -c "iptables-save > /etc/iptables.ipv4.nat"
```
In order to ensure these forwarding rules are always operating, we need to create a small batch file called `/etc/network/if-up.d/eth0-iptables` that is run every time the ethernet inerface is started:
```
pi@raspberry:~ $ sudo nano /etc/network/if-up.d/eth0-iptables
```
Add the following lines:
```
#!/bin/sh
sudo iptables-restore < /etc/iptables.ipv4.nat
```
Lastly, ensure that the file is executable:
```
pi@raspberry:~ $ sudo chmod +x /etc/network/if-up.d/eth0-iptables
```
We have now configured the various port forwarding rules and ensured they will survive a reboot and/or a restart of the ethernet interface.

**Step 5:  Start the Redirection of Weather Observations and Test it is Working**

All of the configuration has been completed and the Raspberry Pi can be rebooted to activate the redirection of PWS observations to the local Weather Service:

```
pi@raspberry:~ $ sudo reboot
```
At this point you should have information flowing from your PWS into the local Weather Service available for use by OS. You can test the service is operating correctly by going back to the instructions on "Installing a Local Weather Service" and following the penultimate Step 7.