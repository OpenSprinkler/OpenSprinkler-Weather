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
https://<Local Weather Service IP:Port>/weatherstation/updateweatherstation.php?tempf=70.5&humidity=90&rainin=0&dailyrainin=0.54&dateutc=2000-01-01+10%3A32%3A35
```
The response text from the Weather Service server will be either "`success`" or an error message.

