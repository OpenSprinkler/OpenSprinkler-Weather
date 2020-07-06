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
## Installating a Local Weather Service

If you would like to choose between different Weather Providers (currently OpenWeatherMap and DarkSky are supported) or use your local PWS to provide the weather information used by OpenSprinkler then you can install and configure the Weather Service on a device within your own local network.

You will need a 24x7 "always on" machine to host the service (this can be a Windows or Linux machine or even a Raspberry Pi device) provided it supports the `Node.js` environment.

For detailed instructions on setup and configuration of a local Weather Service running on a Raspberry Pi then click [here](docs/local-installation.md)

---
## Connecting a Personal Weather Station to a Local Weather Service

If you are running a local instance of the Weather Service then you may be able to send the data directly from your PWS to the Weather Service avoiding any "cloud" based services. The weather data can then be used by the Weather Service to calculate Zimmerman based watering levels.

### Options for PWS Owners

**1 ) PWS supporting RESTfull output**

Some PWS allow the user to specify a `GET request` to send weather observations onto a local service for processing. For example, the MeteoBridge Pro allows for requests to be specified in a custom template that translates the PWS weather values and units into a format that the local Weather Service can accept. If available, the user documentation for the PWS should detail how to configure a custom GET request.

For more information on the RESTfull protocol click [here](docs/pws-protocol.md)

**2 ) Networked PWS that support Weather Underground**

Many PWS already support the Weather Underground format and can be connected to the user's home network to send data directly to the WU cloud service. For these PWS, it is possible to physically intercept the data stream heading to the WU cloud and redirect it to the Weather Service server instead.

To do this intercepting, you place a physical device - such as a Raspberry Pi - in-between the PWS and the home network. It is this "man-in-the-middle" device that will look for information heading from the PWS toward the WU cloud and redirect that information to the local Weather Service.

For more information on configuring a Raspberry Pi Zero W to act as a "Man In The Middle" solution follow these links:
- If you have a PWS that connects to your home network using an ethernet cable then click [here](docs/man-in-middle.md)
- If you have a PWS that connects to your home network via wifi then click [here](docs/wifi-hotspot.md)

**3 ) PWS Supported By WeeWX**

The WeeWX project provides a mechanism for OpenSprinkler owners to capture the data from many different manufacturer's PWS and to both store the information locally and to publish the data to a number of destinations. OpenSprinkler owners can use this solution to send their PWS weather observations onto a local Weather Service server.

For more information on the "WeeWX Solution" click [here](docs/weewx.md)

**4 ) Solutions for specific PWS (provided by OpenSprinkler Forum members)**

- Davis Vantage: a solution for this PWS has been kindly provided by @rmloeb [here](docs/davis-vantage.md)
- Netatmo: instructions for configuring this PWS have been greatfully provided by @franzstein [here](docs/netatmo.md)

## Docker

It is possible to build a self-contained docker image from this repository.  It can then be used to run the service
without installing any prerequisites or setting up systemd.

### Building the Docker image
```shell script
./build-docker.sh  # run with -h for other options
```
The above will generate baselineEtoData (if not already done) and then build a complete opensprinkler-weather docker image.

### Running the Docker image
```shell script
docker create --name=osweather -p 3000:3000 --restart unless-stopped opensprinkler-weather
docker start osweather

# Instead of the above, use this for testing/troubleshooting by running it in the foreground:
docker run --rm -it -p 3000:3000 opensprinkler-weather
```
Note: to expose a different port, change `-p 3000:3000` to, eg `-p12345:3000` 