<img align="left" height="150" src="http://albahra.com/opensprinkler/icon-new.png"><h3>&nbsp;OpenSprinkler Weather Service [![GitHub version](https://img.shields.io/github/package-json/v/opensprinkler/opensprinkler-weather.svg)](https://github.com/OpenSprinkler/OpenSprinkler-Weather)</h3>
&nbsp;[![Build Status](https://api.travis-ci.org/OpenSprinkler/OpenSprinkler-Weather.svg?branch=master)](https://travis-ci.org/) [![devDependency Status](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather/status.svg)](https://david-dm.org/OpenSprinkler/OpenSprinkler-Weather#info=dependencies)<br>
&nbsp;[Official Site][official] | [Support][help] | [Changelog][changelog]
<br>
This script works with the OpenSprinkler Unified Firmware to automatically adjust station run times based on weather data. In addition to calculating the watering level, it also supplies details such as the user’s time zone, sunrise, and sunset times, based on the user's location information. The script is implemented in JavaScript and runs on Node.js.

---

[official]: https://opensprinkler.com
[help]: http://support.opensprinkler.com
[changelog]: https://github.com/OpenSprinkler/OpenSprinkler-Weather/releases

## File Detail

**server.js** is the primary file launching the API daemon.

**js/routes/** contains all the endpoints for the API service, including weather data providers, adjustment methods, geocoders. The list of currently supported weather data providers, their capabilities, and details on various adjustment methods can be found at our [support website]: https://openthings.freshdesk.com/support/solutions/articles/5000823370-use-weather-adjustments

---

## Running the Weather Script Locally

To run the weather script on your own computer, start by downloading the source code (either via `git clone` or a ZIP download). Then install dependencies and compile the TypeScript sources:

```
npm install
npm run build
```

### 1. Compose `.env` file
Before starting the service, you’ll need a `.env` file with configuration parameters such as the server port, default weather provider, geocoder, and any required API keys. A minimal example looks like this:

```
HOST=0.0.0.0
PORT=3000
GEOCODER=GoogleMaps
GOOGLE_MAPS_API_KEY=your_api_key
```

Note: The `GOOGLE_MAPS_API_KEY` does not need to be valid if you query the service directly with GPS coordinates. The Maps API is only used for geocoding (converting a city name or ZIP code into latitude/longitude).

To set a default weather provider (e.g. `OpenMeteo`), include:

```
WEATHER_PROVIDER=OpenMeteo
```

If your chosen provider requires an API key (for example, OpenWeatherMap or `OWM`), add:

```
WEATHER_PROVIDER=OWM
OWM_API_KEY=your_owm_api_key
```

Unlike earlier versions, this script also allows you to specify the weather provider and API key dynamically via the `wto` parameter in API queries. This means you don’t have to hardcode a default provider in `.env` unless you prefer to.

### 2. Build the baselineETo data:

```
cd baselineEToData
sh prepareData.sh 20
sh baseline.sh
```

This command runs the data preparation script with `20` interpolation passes (the recommended default, explained in the `README` for that folder). When it finishes, it will produce the file `Baseline_ETo_Data.bin`, which is required by the weather service for ETo-based watering adjustments. This file only needs to be built once -- you don't need to generate it again if you already have it.

### 3. Start the Service
Once your `.env` file is ready and the baseline ETo data is prepared, start the service with:

```
npm run start
```

The server will launch on the port you configured in `.env`.

---

## Running the Weather Service with Docker

You can also run the precompiled weather service in Docker. The GitHub repository automatically publishes an up-to-date image, which you can pull with:

`ghcr.io/opensprinkler/weather-server:release`

To launch it as a background service (daemon), run the container and point it to your `.env` file for configuration. The .env setup is the same as described above, but note that the Docker image already includes the `Baseline_ETo_Data.bin`, so you don’t need to generate it yourself.

If you prefer to build the Docker image locally, be aware that the process is resource-intensive. You will need at least 30 GB of free disk space and sufficient memory to complete the build, since generating the baseline ETo dataset is computationally heavy.

---

## Using the Weather Service

When the weather server is running, it starts a web service at `<host>:3000`, where `<host>` is the IP/DNS of your computer and `3000` is the default port. The OpenSprinkler firmware and UI/app communicate with it through these endpoints:

- `<host>:3000`: Returns the weather service version.

- `<host>:3000/0?loc=[long],[lat]`: Used for **Manual** adjustment.
  - `[long],[lat]` are GPS coordinates (e.g. `42,-75`).
  - Returns time zone, sunrise/sunset times, and an error code if any.
  - Time zone is encoded as `(GMT shift × 4) + 48`. For example, `GMT-4` is encoded as `32`.
  - Sunrise/sunset are given in minutes since midnight.
  - If a valid geocoder (e.g. Google Maps with API key) is set, location may also be provided as ZIP code, city, etc.

- `<host>:3000/1?loc=[long],[lat]&wto="h":100,"t":100,"r":100,"bh":30,"bt":70,"br":0`: Used for **Zimmerman** adjustment method.
  - `wto` specifies the optional adjustment parameters, such as weights and baselines of humidity, temperature, and rain.
  - Returns all parameters from `/0`, plus:
    - `scale`: watering level calculated by the Zimmerman algorithm from yesterday's data.
    - `scales`: multi-day averages based on available historic data. The length of this array depends on the selected weather data provider's capability.

- `<host>:3000/2?loc=[long],[lat]&wto="d":28`: Used for **Auto Rain Delay**, where `d` is the number of hours to delay if rain is currently reported.

- `<host>:3000/3?loc=[long],[lat]&wto="baseETo":0.34,"elevation":600`: Used for **ETo** adjustment. `baseETo` is the baseline ETo value in inches/day; `elevation` is the elevation in feet. Returns `scale` and `scales` array similar to Zimmerman.

- **Weather Constraints** can be added via `wto` to any adjustment method above. For example:
  - `"minTemp":78` triggers a return parameter of `restrict=1` if the current temperature is below `78°F`.
  - `"rainAmt":1.5,"rainDays":4` triggers `restrict=1` if the forecast rain is more than 1.5 (inches) in the next 4 days.
  - `"cali":` enables California restriction (stop watering if ≥0.1″ rain in past 48h).

- **Weather Data Provider** can be specified with any adjustment method by adding `"provider":"X","key":Y` to `wto`. For example:
  - `"provider":"OpenMeteo"` for OpenMeteo (no key required)
  - `"provider":"AW","key":"xxxx"` for AccuWeather with the corresponding key.

- `<host>:3000/weatherData?loc=[long],[lat]`: Return forecast data. A provider can also be set via `wto`.
