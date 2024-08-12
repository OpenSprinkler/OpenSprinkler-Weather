## Installating a Local Weather Service onto a Raspberry Pi

**Step 1:** Download and install Node.js onto the Raspberry Pi so that you can run the OpenSprinkler weather server locally. The version of Node.js to install is dependent on your model of Raspberry Pi. Note that you can run the command ```uname -m``` on your Raspberry Pi to help identify the chipset that is being used.

*For Raspberry Pi 2 or Pi 3 models that are based on the newer ARMv7 and ARMv8 chip*
```
pi@OSPi:~ $ curl -sL https://deb.nodesource.com/setup_11.x | sudo -E bash -l
pi@OSPi:~ $ sudo apt-get install -y nodejs
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

**Step 2:** Download the OpenSprinkler Weather Service repository to your Raspberry Pi so that you can run a local version of the service:

```
pi@OSPi:~ $ git clone https://github.com/OpenSprinkler/OpenSprinkler-Weather.git weather
```

**Step 3:** Install all of the dependencies using the Node Package Manager, `npm`, from within the weather project directory and transpile the TypeScript files to JavaScript:
```
pi@OSPi:~ $ cd weather
pi@OSPi:~/weather $ npm install
pi@OSPi:~/weather $ npm run compile
```
**Step 4:** Configure the weather server to use either the OpenWeatherMap API or the Dark Sky API

* **Step 4a:** If you want to use the Open Weather Map API, go to `https://openweathermap.org/appid` to register with OpenWeatherMaps and obtain an API key that is needed to request weather information.

* **Step 4b:** If you want to use the Dark Sky API, go to `https://darksky.net/dev` to register with Dark Sky and obtain an API key that is needed to request weather information.

* **Step 4c:** If you want just want to use your PWS for weather information then you dont need to register for either Open Weather Map nor DarkSky.

**Step 5:** The file `.env` is used by the weather server to specify the interface and port to listen on for requests coming from your OpenSprinkler device. You need to create a new `.env` file and enter some configuration details.
```
pi@OSPi:~/weather $ nano .env
```

Add the following lines to the .env file so that the weather server is configured to listen for weather requests. Using 0.0.0.0 as the host interfaces allows you to access the service from another machine to test. Alternatively, set HOST to “localhost” if you want to limit weather service access to only applications running on the local machine.

Note: if you are using OS then you must set `PORT=80` as this cannot be changed on the OS device. If using OSPi or OSBo then you can set `PORT` to any unused value.

```
HOST=0.0.0.0
PORT=3000
```

* **Step 5a:** If you registered for the OWM API then also add the following two lines to the .env file:
```
WEATHER_PROVIDER=OWM
OWM_API_KEY=<YOUR OWM KEY>
```

* **Step 5b:** If you registered for the Dark Sky API then also add these two lines to the .env file:
```
WEATHER_PROVIDER=DarkSky
DARKSKY_API_KEY=<YOUR DARK SKY KEY>
```

* **Step 5c:** If you wanted to use your PWS information then make sure to add two lines to the .env file:
```
WEATHER_PROVIDER=local
PWS=WU
```

* **Step 5d:** If you registered for the Apple WeatherKit API then also add these two lines to the .env file:
```
WEATHER_PROVIDER=Apple
WEATHERKIT_API_KEY=<YOUR APPLE WEATHERKIT KEY>
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

**Step 7:** You can now test that the service is running correctly from a Web Browser by navigating to the service (note: make sure to use the PORT number specified in the `.env` file above, e.g. 3000 for OSPi or 80 for OS devices):

```
http://<Weather Service IP:PORT>/
```
You should see the text "OpenSprinkler Weather Service" appear in your browser in response.

Next, you can use the following request to see the watering level that the Weather Service calculates. Note: to be consistent, change the values of h, t and r to the % weightings and bh (as a %), bt (in F), bp (in inches) to the offsets from the Zimmerman config page in App.

```
http://<Weather Service IP:PORT>/weather1.py?loc=50,1&wto="h":100,"t":100,"r":100,"bh":70,"bt":59,"br":0
```

This will return a response similar to below with the `scale` value equating to the watering level and `rawData` reflecting the temp (F), humidity (%) and daily rainfall (inches) used in the zimmerman calc.
```
&scale=20&rd=-1&tz=48&sunrise=268&sunset=1167&eip=3232235787&rawData={"h":47,"p":0,"t":54.4,"raining":0}
```

**Step 8:** You will now need to configure your OpenSprinkler device to use the local version of the Weather Service rather than the Cloud version. On a web browser, go to `http://<your OS IP>:80/su` if you have an OS device or `http://<your OSPi IP>:8080/su` for OSPi/OSBo devices to set the Weather Service IP and PORT number.

OpenSprinkler should now be connected to your local Weather Service for calculating rain delay and watering levels.

