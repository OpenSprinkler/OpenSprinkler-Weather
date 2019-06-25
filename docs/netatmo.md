## Setup a Netatmo PWS to stream data to a local Weather Service

**Background**

Netatmo Weather Stations send weather information to the Netatmo Cloud using an encrypted data stream. So for this PWS, we cannot readily intercept the data before it leaves the home network. Instead, we can make use of a WeeWX plug-in that can retreive the weather data from the Netatmo Cloud and then forward it onto our local Weather Service.

**Step 1: Install the local Weather Service and WeeWX solutions**

* **Step 1a:** Install your local Weather Service and configure the service for PWS input using the instructions [here](local-installation.md).

* **Step 1b:** Next, install the WeeWX platofrm using the instructions [here](weewx.md)

Note that you can install both the local Weather Service and the WeeWX solution onto the same Raspberry Pi if you wish.

**Step 3: Register a Client ID on the Netatmo Cloud**

Now we need to register with the Netatmo Cloud service in order to obtain a `Client ID` and a `Client Secret` via the `netatmo.com` web site.

During registration, you will need to create a Netatmo Connect project and an APP in addition to the username and password already available for the existing Netatmo account:

* Whilst creating the APP, a form will be presented requesting a number of items. As a minimum, you need to provide: Name; Description; Data Protection Officer Name; and Data Protection Officer Email.

* Note that the Email Address should be the same as used to access the Netatmo account, all the other text may vary.

* After saving this form the so called “Technical Parameters” Client id and Client secret can be obtained.

These credentials, together with the username (Email Address) and password, are needed to install the WeeWX Netatmo plug-in.

**Step 4: Install and Configure the WeeWX Netatmo Plug-In**

There is a Netatmo/WeeWX driver, written by Matthew Wall, that can be added to the WeeWX platform in order to retreive weather data from the Netatmo Cloud service. The procedure to install the plug-in as avaliable [here](https://github.com/matthewwall/weewx-netatmo)

Once installed, confirm that the necessary configuration has been added to the `/etc/weewx/weewx.conf` file. The file should be set to select the `netatmo` station type and to provide your account information as follows:

```
# in this file with a ‘driver’ parameter indicating the driver to be used.
station_type = netatmo
...
##############################################################################
[netatmo]
username = <Email Address as used for Netatmo login>
client_secret = <Client secret as obtained from the Netatmo Connect website>
password = <Password as used for Netatmo login>
driver = user.netatmo
client_id = <Client id as obtained from the Netatmo Connect website>
mode = cloud
##############################################################################
```

**Step 4: Configure WeeWX to forward Weather Data to you local Weather Service**

Once installed and capturing data, the WeeWX solution can send the Netatmo weather observation onto the local Weather Service. WeeWX's built-in Weather Underground plug-in can be configured in the ```/etc/weewx/weewx.conf``` file specifying the IP Address and Port of the local Weather Service server as follows:

```
[[Wunderground]]
    enable = true
    station = anyText
    password = anyText
    server_url = http://<IP>:<PORT>/weatherstation/updateweatherstation.php
    rapidfire = False
```
Note: the `station` and `password` entries are not used by the OS Weather Service but must be populated to keep the plug-in happy.

You should now `stop` and `start` the WeeWX service for the configuration options to take effect:

```
$ sudo /etc/init.d/weewx stop
$ sudo /etc/init.d/weewx start
```
Your Netatmo weather information should now be sent to the local Weather Service every 5 minutes.
