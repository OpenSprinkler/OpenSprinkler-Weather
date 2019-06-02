## Setup a Raspberry Pi To Intercept PWS Information

The following steps are based on a Raspberry Pi Zero W with an Ethernet/USB adapter to provide two network interfaces. The installation instructions below assume the PWS Internet Bridge has been connected into the Pi's ethernet port and that the Pi's WiFi interface is being used to connect with the Home Network.

**Step 1: Install Software and Basic Setup**

Install the latest version of Raspbian onto the Pi and configure the wifi network as per the instructions from the Raspberry Pi Foundation. You can now `ssh` into the Pi via the WiFi network and contiue the setup process.

We only need to install one additional piece of software called `dnsmasq` which we will need to manage the network on the ethernet side of the Pi. We don't want any of the default configuration as we need to tailor that to our specific needs:

```
pi@raspberry:~ $ sudo apt-get install dnsmasq
pi@raspberry:~ $ sudo rm -rf /etc/dnsmasq.d/*
```

Then, we need to change one of the default Raspberry Pi setting to enable IP forwarding. We will be using this forwarding functionality later in the installation process. The setting can be changed by editing the file `sysctl.conf`:

```
pi@raspberry:~ $ sudo nano /etc/sysctl.conf
```
Uncomment the line "`# net.ipv4.ip_forward=1`" to look as follows and save the file:
```
net.ipv4.ip_forward=1
```
We now have a pretty standard Raspberry Pi installation with the Pi connected to our Home Network via the WiFi interface.

**Step 2: Configure the PWS Side of the Network**

We now need to shift our focus across to the ethernet side of the Pi. At the moment, we have the PWS physically connected to the Pi via the ethernet port but have yet to setup the networking layer to communicate with the PWS.

Wwe need to assign a static address to the Pi's ethernet port (`eth0`). This is the port connected to the PWS Internet Bridge and will act as the "network controller" for the ethernet side of things. Since my home network is configured to use `192.168.1.0-255`, I choose to use `192.168.2.0-255` for the network on the ethernet side. To make these changes, we need to edit the `dhcp.conf` configuration file:

```
pi@raspberry:~ $ sudo nano /etc/dhcpcd.conf
```

Adding the following lines to the end of the file:

```
interface eth0
static ip_address=192.168.2.1/24
static routers=192.168.2.0
```

Now we need to configure `dnsmasq` to allocate an IP address to our PWS Internet Gateway so that it can connect and communicate with the Pi. In order for the PWS to get the same static address each time it restarts, we need to tell `dnsmasq` the MAC address of the PWS and the Hostname and IP Address we want it to have. For example, my Ambient Weather PWS has a MAC Address of 00:0E:C6:XX:XX:XX and I want it to be known as "PWS" at 192.168.2.10.

We need to create a new file to configure our specific requirements:
```
pi@raspberry:~ $ sudo nano /etc/dnsmasq.d/eth0-dnsmasq.conf
```
Add the following lines of configuration to the file (swapping out <PWS_MAC>, <PWS_HOST> and <PWS_IP> with our required values):
```
interface=eth0
bind-interfaces
server=8.8.8.8
domain-needed
bogus-priv
dhcp-range=192.168.2.2,192.168.2.100,12h
dhcp-host=<PWS_MAC>,<PWS_NAME>,<PWS_IP>
```
**Step 3: Configure the Intercept (Port Forwarding)**

Now that we have both sides of the network configured, we can setup the Pi to intercept weather observations sent by the PWS Internet Bridge to Weather Underground. We do this by identifying all packets arriving at the Pi from the PWS Internet Gateway and heading towards Port 80 (the WU cloud port).

These packets can be redirected to the IP and Port of our local Weather Service using the `iptable` command. We will need to setup the configuration and then save it to a file `iptables.ipv4.nat` so that we can restore the configuration easily after a reboot. When executing the commands below, make sure to substitute <PWS_IP> with the PWS address selected earlier and to use the IP and Port for your local Weather Service in place of `<Weather Service IP:PORT>`:
```
pi@raspberry:~ $ sudo iptables -t nat -A PREROUTING -s <PWS IP> -p tcp --dport 80 -j DNAT --to-destination <Weather Service IP:PORT>
pi@raspberry:~ $ sudo iptables -t nat -A POSTROUTING -j MASQUERADE
pi@raspberry:~ $ sudo sh -c "iptables-save >/etc/iptables.ipv4.nat"
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

**Step 4:  Start the Redirection of Weather Observations**

All of the configuration has been completed and the Raspberry Pi can be rebooted to activate the redirection of PWS observations to the local Weather Service:

```
pi@raspberry:~ $ sudo reboot
```
