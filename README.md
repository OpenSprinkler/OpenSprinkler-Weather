<img align="left" height="150" src="http://albahra.com/opensprinkler/icon-new.png"><h3>&nbsp;OpenSprinkler Weather Service [![GitHub version](https://img.shields.io/github/package-json/v/opensprinkler/opensprinkler-weather.svg)](https://github.com/OpenSprinkler/OpenSprinkler-Weather)</h3>
&nbsp;[![Build Status](https://api.travis-ci.org/OpenSprinkler/OpenSprinkler-Weather.svg?branch=master)](https://travis-ci.org/) [![devDependency Status](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather/status.svg)](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather#info=dependencies)<br>
&nbsp;[Official Site][official] | [Support][help] | [Changelog][changelog]
<br>
This script is used by OpenSprinkler Unified Firmware to update the water level of the device. It also provides timezone information based on user location along with other local information (sunrise, sunset, daylights saving time, etc).

The production version runs on Amazon Elastic Beanstalk (AWS EB) and therefore this package is tailored to be zipped and uploaded to AWS EB. The script is written in Javascript for Node.JS.

---

[official]: https://opensprinkler.com
[help]: http://support.opensprinkler.com
[changelog]: https://github.com/OpenSprinkler/OpenSprinkler-Weather/releases

## File Detail

**server.js** is the primary file launching the API daemon.

**routes/*.js** contains all the endpoints for the API service. Currently, only two exists for weather adjustment and logging a PWS observation.

---
## Local Installation onto a Raspberry Pi

**Step 1:** Download and install Node.js onto the Raspberry Pi so that we can run the OpenSprinkler weather server. The version of Node.js to install is dependent on your model of Raspberry Pi. Note that you can run the command ```uname -m``` on your Raspberry Pi to help identify the chipset that is being used.

*For Raspberry Pi 2 or Pi 3 models that are based on the newer ARMv7 and ARMv8 chip*
```
pi@OSPi:~ $ curl -sL https://deb.nodesource.com/setup_11.x | sudo -E bash -l
pi@OSPi:~ $ sudo apt install -y nodejs
```

*For Raspberry Pi Model A, B, B+, Zero and Compute Module based on the older ARMv6 chip, the process is slightly more convoluted*
```
pi@OSPi:~ $ wget https://nodejs.org/dist/v11.4.0/node-v11.4.0-linux-armv6l.tar.gz
pi@OSPi:~ $ tar -xvf node-v11.4.0-linux-armv6l.tar.gz
pi@OSPi:~ $ cd node-v11.4.0-linux-armv6l
pi@OSPi:~ $ sudo cp -R * /usr/local/
pi@OSPi:~ $ cd ..
pi@OSPi:~ $ rm -rf node-v11.4.0-linux-armv6l
pi@OSPi:~ $ rm node-v11.4.0-linux-armv6l.tar.gz

```

**Step 2:** Download the OpenSprinkler Weather Service repository to your Raspberry Pi so that we can run a local version of the service:

```
pi@OSPi:~ $ git clone https://github.com/OpenSprinkler/OpenSprinkler-Weather.git weather
```

**Step 3:** Install all of the dependencies using the Node Package Manager, npm, from within the weather project directory:
```
pi@OSPi:~ $ cd weather
pi@OSPi:~/weather $ npm install
```
**Step 4:** Configure the weather server to use either the OpenWeatherMap API or the Dark Sky API

* **Step 4a:** If you want to use the Open Weather Map API, go to `https://openweathermap.org/appid` to register with OpenWeatherMaps and obtain an API key that is needed to request weather information.

* **Step 4b:** If you want to use the Dark Sky API, go to `https://darksky.net/dev` to register with Dark Sky and obtain an API key that is needed to request weather information.

**Step 5:** The file .env is used by the weather server to specify the interface and port to listen on for OpenSprinkler Firmware weather requests. We need to create a new file, .env, and enter some configuration details.
```
pi@OSPi:~/weather $ nano .env
```

Add the following two lines to the .env file so that the weather server is configured to listen for weather requests. Using 0.0.0.0 as the host interfaces allows you to access the service from another machine to test. Alternatively, set HOST to “localhost” if you want to limit weather service access to only applications running on the local machine.

```
HOST=0.0.0.0
PORT=3000
```

If you want to use the OWM API, also add the following two lines to the .env file:
```
WEATHER_PROVIDER=OWM
OWM_API_KEY=<YOUR OWM KEY>
```

If you want to use the Dark Sky API instead, add these two lines to the .env file:
```
WEATHER_PROVIDER=DarkSky
DARKSKY_API_KEY=<YOUR DARK SKY KEY>
```


**Step 6:** Setup the Weather Server to start whenever the Raspberry Pi boots up using the built-in service manager:

```
pi@OSPi:~/weather $ sudo nano /etc/systemd/system/weather.service
```

Cut and paste the following lines into the weather.service file:

```
[Unit]
Description=OpenSprinkler Weather Server

[Service]
ExecStart=/usr/bin/npm start
WorkingDirectory=/home/pi/weather
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
Save the file and enable/start the weather service

```
pi@OSPi:~/weather $ sudo systemctl enable weather.service
pi@OSPi:~/weather $ sudo systemctl start weather.service
pi@OSPi:~/weather $ systemctl status weather.service
```

The final line above checks that the service has been started and you should see the service marked as running.

**Step 7:** You can now test that the service is running correctly from a Web Browser.

Firstly, ensure that the Weather Service is up and running by navigating to the service (note: the default port was set to 3000 in the .env file):

```
http://<Weather Service IP:PORT>/
```
You should see "OpenSprinkler Weather Service" in response.

Secondly, you can use the following request to see the watering level that the Weather Service calculates. Note: to be consistent, change the values of h, t and r to the % weightings and bh (as a %), bt (in F), bp (in inches) to the offsets from the Zimmerman config page in App.

```
http://<Weather Service IP>:3000/weather1.py?loc=50,1&wto="\"h\":100,\"t\":100,\"r\":100,\"bh\":70,\"bt\":59,\"br\":0"
```

This will return a response similar to below with ```scale``` value equating to the watering level and ```rawData``` reflecting the temp (F), humidity (%) and daily rainfall (inches) used in the zimmerman calc.
```
&scale=20&rd=-1&tz=48&sunrise=268&sunset=1167&eip=3232235787&rawData={"h":47,"p":0,"t":54.4,"raining":0}
```

**Step 8:** You will now need to configure your OpenSprinkler device to use the local version of the Weather Service rather than the Cloud version. On a web browser from your PC, go to `http://<your OSPi IP>:8080/su` and specify “localhost:3000” as the new location for the weather service.

OpenSprinkler should now be connected to your local Weather Service for calculating rain delay and watering levels.

---
## Submitting PWS Observations to a Local Weather Service Server

### Options for PWS Owners

**1 ) PWS Supporting RESTfull Output**

Some PWS allow the user to specify a `GET request` to send weather observations onto a local service for processing. For example, the MeteoBridge Pro allows for requests to be specified in a custom template that translates the PWS weather values and units into a format that the local OS Weather Service can accept. If available, The user documentation for the PWS should detail how to configure a custom GET request and the message structure required by the OS Weather Service is documented below.

**2 ) Networked PWS Supporting Weather Underground**

Many PWS already support the Weather Underground format and can be connected to the user's home network to send data directly to the WU cloud service. For these PWS, it is possible to physically intercept the data stream heading to the WU cloud and redirect it to the OS Weather Service server instead.

To do this intercepting, you place a physical device - such as a Raspberry Pi - in-between the PWS and the home network. It is this "man-in-the-middle" device that will look for information heading from the PWS toward the WU cloud and redirect that information to the local Weather Service.

There is a section below that goes through the steps to configure/install a Raspberry Pi Zero W to act as a "man-in-the-middle".

**3 ) PWS Supported By WeeWX**

From the Author of [WeeWX](http://www.weewx.com) - *"WeeWX is a free, open source, software program, written in Python, which interacts with your weather station to produce graphs, reports, and HTML pages. It can optionally publish to weather sites or web servers. It uses modern software concepts, making it simple, robust, and easy to extend. It includes extensive documentation."*

The WeeWX project provides a mechanism for OpenSprinkler PWS Owners to capture the data from their PWS and to both store the information locally and to publish the data to a number of destinations. OpenSprinkler Users can use this solution to send their PWS weather observations onto a local Weather Service server.

The list of WeeWX supported hardware can be found [here](http://www.weewx.com/hardware.html) along with an extensive installation/configuration documentation [here](http://www.weewx.com/docs.html). There is also an active Google Groups forum [here](https://groups.google.com/forum/#!forum/weewx-user)

Once installed and capturing data, the WeeWX solution can send the weather observation onto the local Weather Service. WeeWX's built-in Weather Underground plug-in can be configured in the ```/etc/weewx/weewx.conf``` file specifying the IP Address and Port of the local Weather Service server as follows:

```
    [[Wunderground]]
        enable = true
        station = anyText
        password = anyText
        server_url = http://<IP>:<PORT>/weatherstation/updateweatherstation.php
        rapidfire = False
```
Note: the `station` and `password` entries are not used by the OS Weather Service but must be populated to keep the plug-in happy.

You can then restart the WeeWX server and your PWS observations should now be sent to the local Weather Service every 5 minutes.


---
## Personal Weather Station Upload Protocol

**Background**

To upload a PWS observation, you make a standard HTTP GET request with the weather conditions as the GET parameters.

**Endpoint**

The GET message should be directed to the local Weather Service server and with the same endpoint as used by legacy Weather Underground service:

```
http://<Local Weather Service IP:Port>/weatherstation/updateweatherstation.php
```

**GET Parameters**

The following fields are required:


| Field Name | Format | Description |
|---|:---:|---|
| tempf | 55\.6 | Outdoor temperature in fahrenheit |
| humidity | 0-100 | Outdoor humidity as a percentage |
| rainin | 0.34 | Accumulated rainfall in inches over the last 60 min |
| dailyrainin | 1.45 | Accumulated rainfall in inches for the current day (in local time) |
| dateutc | 2019-03-12 07:45:10 | Time in UTC as YYYY-MM-DD HH:MM:SS (not local time) |

IMPORTANT all fields must be url escaped. For example, if the current time in utc is "`2019-01-01 10:32:35`" then the dateutc field should be sent as "`2019-01-01+10%3A32%3A35`". For reference see http://www.w3schools.com/tags/ref_urlencode.asp.

_[To Do: If the weather station is not capable of producing a timestamp then either omit the field or set the field value to "`now`"]_


**Example GET Message**

Here is an example of a full URL:
```
https://<Local Weather Service IP:Port>/weatherstation/updateweatherstation.php?tempf=70.5&humidity=90&rainin=0&dailytainin=0.54&dateutc=2000-01-01+10%3A32%3A35
```
The response text from the Weather Service server will be either "`success`" or an error message.

---
## Setup a Raspberry Pi To Intercept PWS Information

The following steps are based on a Raspberry Pi Zero W with an Ethernet/USB adapter to provide two network interfaces. The installation instructions below assume the PWS Internet Bridge has been connected into the Pi's ethernet port and that the Pi's WiFi interface is being used to connect with the Home Network.

**Step 1: Install Software and Basic Setup**

Install the latest version of Raspbian onto the Pi and configure the wifi network as per the instructions from the Raspberry Pi Foundation. You can now `ssh` into the Pi via the WiFi network and contiue the setup process.

We only need to install one additional piece of software called `dnsmasq` which we will need to manage the network on the ethernet side of the Pi. We don't want any of the default configuration as we need to tailor that to our specific needs:

```
pi@raspberry:~ $ sudo apt-get install dnsmasq
pi@raspberry:~ $ sudo rm -rf /etc/dnsmasq.d/*
```

Lastly, we need to change one of the default Raspberry Pi setting to enable IP forwarding. We will be using this forwarding functional later in the installation process. The setting can be changed by editing the file `sysctl.conf`:

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

Next, we to assign a static address to the Pi's ethernet port (`eth0`). This is the port connected to the PWS Internet Bridge and will act as the "network controller" for the ethernet side of things. Since my home network is configured to use `192.168.1.0-255`, I choose to use `192.168.2.0-255` for the network on the ethernet side. The commands below setup a network using this address range. So we need to edit the `dhcp.conf` configuration file

```
pi@raspberry:~ $ sudo nano /etc/dhcpcd.conf
```

Adding the following lines to the end of the file:

```
interface eth0
static ip_address=192.168.2.1/24
static routers=192.168.2.0
```

Now we need to configure `dnsmasq` to allocate an IP address to our PWS Internet Gateway so that it can connect and communicate with the Pi. In order for the PWS to get the same static address each time it restarts, we need to tell `dnsmasq` the MAC address of the PWS and the Hostname and IP Address we wantit to have. For example, my Ambient Weather PWS has a MAC Address of 00:0E:C6:XX:XX:XX and I want it to be known as "PWS" at 192.168.2.10.

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

These packets can be redirected to the IP and Port of our local Weather Service using the `iptable` command. We will need to setup the configuration and then save it to a file `iptables.ipv4.nat` so that we can restore the configuration easily after a reboot. When executing the commands below, make sure to substitute <PWS_IP> with the PWS address selected earlier and to use the IP and Port for your local Weather Service in place of <Weather Service IP:PORT>:

```
pi@raspberry:~ $ sudo iptables -t nat -A PREROUTING -s <PWS IP> -p tcp --dport 80 -j DNAT --to-destination <Weather Service IP:PORT>
pi@raspberry:~ $ sudo iptables -t nat -A POSTROUTING -j MASQUERADE
pi@raspberry:~ $ sudo iptables-save > /etc/iptables.ipv4.nat
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
pi@raspberry:~ $ chmod +x /etc/network/if-up.d/eth0-iptables
```
We have now configured the various port forwarding rules and ensured they will survive a reboot and/or a restart of the ethernet interface.

**Step 4:  Start the Redirection of Weather Observations**

All of the configuration has been completed and the Raspberry Pi can be rebooted to activate the redirection of PWS observations to the local Weather Service:

```
pi@raspberry:~ $ sudo reboot
```
