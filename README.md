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

`npm install`
`npm run build`

1. Before starting the service, you’ll need a `.env` file with configuration parameters such as the server port, default weather provider, geocoder, and any required API keys. A minimal example looks like this:

`HOST=0.0.0.0`
`PORT=3000`
`GEOCODER=GoogleMaps`
`GOOGLE_MAPS_API_KEY=your_api_key`

Note: The `GOOGLE_MAPS_API_KEY` does not need to be valid if you query the service directly with GPS coordinates. The Maps API is only used for geocoding (converting a city name or ZIP code into latitude/longitude).

To set a default weather provider (e.g. `OpenMeteo`), include:

`WEATHER_PROVIDER=OpenMeteo`

If your chosen provider requires an API key (for example, OpenWeatherMap or `OWM`), add:

`WEATHER_PROVIDER=OWM`
`OWM_API_KEY=your_owm_api_key`

Unlike earlier versions, this script also allows you to specify the weather provider and API key dynamically via the `wto` parameter in API queries. This means you don’t have to hardcode a default provider in `.env` unless you prefer to.

2. Build the baselineETo data:

`cd baselineEToData`
`sh prepareData.sh 20`
`sh baseline.sh`

This command runs the data preparation script with `20` interpolation passes (the recommended default, explained in the `README` for that folder). When it finishes, it will produce the file `Baseline_ETo_Data.bin`, which is required by the weather service for ETo-based watering adjustments.

3. Once your `.env` file is ready and the baseline ETo data is prepared, start the service with:

`npm run start`

The server will launch on the port you configured in `.env`.

---

## Running the Weather Service with Docker

You can also run the precompiled weather service in Docker. The GitHub repository automatically publishes an up-to-date image, which you can pull with:

`ghcr.io/opensprinkler/weather-server:release`

To launch it as a background service (daemon), run the container and point it to your `.env` file for configuration. The .env setup is the same as described above, but note that the Docker image already includes the `Baseline_ETo_Data.bin`, so you don’t need to generate it yourself.

If you prefer to build the Docker image locally, be aware that the process is resource-intensive. You will need at least 30 GB of free disk space and sufficient memory to complete the build, since generating the baseline ETo dataset is computationally heavy.
