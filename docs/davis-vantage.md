## Connecting a Davis Vantage PWS to the Local Weather Service

**Background**

The Davis Vantage has the option to connect the PWS to a Windows machine using a serial or USB logger. The Davis Weatherlink software has an optional DLL, WUiWlink_1.dll (dated 4/26/17), which is designed to push observation data from the Davis Vantage weather console to WeatherUnderground's now obsolete interface. That feature can be used to push data to a local instance of weather-service, which will, in turn, be accessed by OpenSprinkler as data for the Zimmerman water level calculation.

Note: if you have the WeatherLinkIP version then see the instructions for using a RaspberryPi Zero to redirect weather data to local weather-service.

**Configuration**

To install the DLL module, see the directions at http://www.davisinstruments.com/resource/send-weather-data-weather-underground-weatherlink-software/

To redirect the weather data to weather-server, modify the HOSTS file on the Windows machine running Weatherlink by adding the following two lines substituting `<weather-service IP>` for the IP address of your local Weather Service:
```
local <weather-service IP> rtupdate.wunderground.com
local <weather-service IP> weatherstation.wunderground.com
```
Note: you must be running in administrator mode to make this change. On Windows 10 the HOSTS file is in `C:/Windows/System32/drivers/etc`. The easiest way to do this is to open a Command Prompt in Admin mode, navigate to `C:/Windows/System32/drivers/etc`, then execute "notepad.exe hosts", add the three entries, save, exit, and close the command window. The change should take effect immediately, but you may need to reboot the Windows machine to be sure.

WARNING (7/30/2020): recent changes to Windows Defender apparently cause the HOSTS file to be cleared.  In order to prevent this you must list the HOSTS file to be ignored (Settings|Windows Security|Virus & threat protection|(scroll down)Exclusions|C:\Windows\System32\drivers\etc\hosts)

In the Weatherlink application you should see "Wunderground settings" in the File menu. You can ignore the StationID and Password settings (or just enter a single blank character). Set the Update Interval to 5 minutes, which should be more than sufficient for the purpose of the Zimmerman water level calculation.

On the machine running weather-server, edit the weather-server `.env` file to add a line `"PWS=WU"`. Stop and restart weather-service.

Actual readings from your PWS should now be flowing to weather-service. Make sure you have Zimmerman selected in OpenSprinkler and set the parameters appropriately for your situation.

**Testing**

To immediately observe the data feed, open Davis WeatherLink, click on File | Wunderground Settings, then click the "Test" box.
