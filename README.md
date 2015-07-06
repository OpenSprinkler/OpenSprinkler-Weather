<img align="left" height="150" src="http://albahra.com/opensprinkler/icon-new.png"><h3>&nbsp;OpenSprinkler Weather Service <sup><img src="http://vb.teelaun.ch/OpenSprinkler/OpenSprinkler-Weather.svg"></sup></h3>
&nbsp;[![Build Status](https://api.travis-ci.org/OpenSprinkler/OpenSprinkler-Weather.svg?branch=master)](https://travis-ci.org/) [![Coverage Status](https://coveralls.io/repos/OpenSprinkler/OpenSprinkler-Weather/badge.svg?branch=master)](https://codecov.io/github/OpenSprinkler/OpenSprinkler-Weather?branch=master) [![devDependency Status](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather/status.svg)](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather#info=dependencies)  
&nbsp;[Official Site][official] | [Support][help] | [Changelog][changelog]  
<br>
This script is used by OpenSprinkler Unified Firmware to update the water level of the device. It also provides timezone information based on user location along with other local information (sunrise, sunset, daylights saving time, etc).

The production version runs on Amazon Elastic Beanstalk (AWS EB) and therefore this package is tailored to be zipped and uploaded to AWS EB. The script is written in Javascript for Node.JS.
  
---

[official]: https://opensprinkler.com
[help]: http://support.opensprinkler.com
[changelog]: https://github.com/OpenSprinkler/OpenSprinkler-App/releases
[salbahra]: http://albahra.com

#### File Detail

**server.js** is the primary file launching the API daemon.

**routes/*.js** contains all the endpoints for the API service. Currently, only one exists for weather adjustment.

**models/*.js** contains all the database models used by the routes. Currently, only one exists to manage weather cache data.
