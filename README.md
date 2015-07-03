# Weather Adjustment Service

## Description
This script is used by OpenSprinkler Unified Firmware to update the water level of the device. It also provides timezone information based on user location along with other local information (sunrise, sunset, daylights saving time, etc).

The production version runs on Amazon Elastic Beanstalk (AWS EB) and therefore this package is tailored to be zipped and uploaded to AWS EB. The script is written in Javascript for Node.JS.

## File Detail
**server.js** is the primary file launching the API daemon.

**routes/*.js** contains all the endpoints for the API service. Currently, only one exists for weather adjustment.

**models/*.js** contains all the database models used by the routes. Currently, only one exists to manage weather cache data.

## Privacy

The script does use Google Analytics to collect anonymous data regarding each query such as the firmware of the device querying, the location entered in the device options, and result of the weather adjustment. These are used to improve the accuracy of location resolution and precision of weather adjustments.
