## The WeeWX Project

**Background**

From the Author of [WeeWX](http://www.weewx.com) - *"WeeWX is a free, open source, software program, written in Python, which interacts with your weather station to produce graphs, reports, and HTML pages. It can optionally publish to weather sites or web servers. It uses modern software concepts, making it simple, robust, and easy to extend. It includes extensive documentation."*

**Supported Weather Stations**

The list of WeeWX supported hardware can be found [here](http://www.weewx.com/hardware.html) along with an extensive installation/configuration documentation [here](http://www.weewx.com/docs.html). There is also an active Google Groups forum [here](https://groups.google.com/forum/#!forum/weewx-user)

**Connecting WeeWX to OpenSprinkler Weather Service**

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
