<img align="left" height="150" src="http://albahra.com/opensprinkler/icon-new.png"><h3>&nbsp;OpenSprinkler Weather Service [![GitHub version](https://badge.fury.io/gh/OpenSprinkler%2FOpenSprinkler-Weather.svg)](http://badge.fury.io/gh/OpenSprinkler%2FOpenSprinkler-Weather)</h3>
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
**Step 4:** Go to `https://openweathermap.org/appid` to register with OpenWeatherMaps and obtain an API key that is needed to request weather information.

**Step 5:** The file .env is used by the weather server to specify the interface and port to listen on for OpenSprinkler Firmware weather requests. We need to create a new file, .env, and enter some configuration details.
```
pi@OSPi:~/weather $ nano .env
```

Add the following three lines to the .env file so that the weather server is configured to listen for weather requests and generate OWM calls. Using 0.0.0.0 as the host interfaces allows you to access the service from another machine to test. Alternatively, set HOST to “localhost” if you want to limit weather service access to only applications running on the local machine. Make sure to use the OWM API key that was provided during registration.

```
HOST=0.0.0.0
PORT=3000
OWM_API_KEY=<YOUR KEY>
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
ExecStart=/usr/bin/node /home/pi/weather/server.js
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

**Step 7:** You will now need to configure your OpenSprinkler device to use the local version of the Weather Service rather than the Cloud version. On a web browser from your PC, go to `http://<your OSPi IP>:8080/su` and specify “localhost:3000” as the new location for the weather service.

OpenSprinkler should now be connected to your local Weather Service for calculating rain delay and watering levels.

---
## Submitting PWS Observations to a Local Weather Service Server

### Personal Weather Station Upload Protocol

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
