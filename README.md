# Weather Adjustment Service

## Description
This script is used by OpenSprinkler Unified Firmware to update the water level of the device. It also provides timezone information based on user location along with other local information (sunrise, sunset, daylights saving time, etc).

The production version runs on Amazon Elastic Beanstalk (AWS EB) and therefore this package is tailored to be zipped and uploaded to AWS EB. The script is written in Python.

## File Detail
**Requirements.txt** is used to define the required Python modules needed to run the script.

**Application.py** parses the incoming URL and returns the appropriate values. The script defaults to URL format return however a 'format' parameter can be passed with the value 'json' in order to output JSON.

## Privacy

The script does use Google Analytics to collect anonymous data regarding each query such as the firmware of the device querying, the location entered in the device options, and result of the water adjustment. 
