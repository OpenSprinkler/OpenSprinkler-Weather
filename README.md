# OpenSprinkler Weather Service

[![Docker](https://github.com/OpenSprinkler/OpenSprinkler-Weather/actions/workflows/build-ci.yml/badge.svg)](https://github.com/OpenSprinkler/OpenSprinkler-Weather/actions/workflows/build-ci.yml)

The OpenSprinkler Weather Service supplies weather data, time-zone and sunrise/sunset information, watering adjustments, and weather-based restrictions to OpenSprinkler controllers. It supports multiple public weather providers and locally streamed personal weather station (PWS) data.

- [Configuration reference](docs/configuration.md)
- [HTTP API reference](docs/api.md)
- [Local service and PWS setup](docs/local-installation.md)
- [Testing and release checks](docs/weather-testing.md)
- [OpenSprinkler weather-adjustment guide](https://openthings.freshdesk.com/support/solutions/articles/5000823370-use-weather-adjustments)

## Quick Start

Use Node.js 24 LTS. With NVM, `nvm use` selects the version declared in `.nvmrc`. Clone the repository, install the locked dependencies, and build the service:

```bash
git clone https://github.com/OpenSprinkler/OpenSprinkler-Weather.git
cd OpenSprinkler-Weather
npm ci
npm run build
```

Create `.env` from [.env.example](.env.example). Open-Meteo is a useful keyless default for a self-hosted instance:

```text
HOST=0.0.0.0
PORT=3000
WEATHER_PROVIDER=OpenMeteo
```

The baseline ETo endpoint also requires `baselineEToData/Baseline_ETo_Data.bin`. Generate it when it is not already present:

```bash
cd baselineEToData
sh prepareData.sh 20
sh baseline.sh
cd ..
```

Start the compiled service:

```bash
npm start
```

The root URL reports the running service version. API coordinates use `latitude,longitude`, for example:

```text
http://127.0.0.1:3000/1?loc=40.7128,-74.0060&wto="provider":"OpenMeteo","h":100,"t":100,"r":100,"bh":30,"bt":70,"br":0&format=json
```

## Docker

The published image includes the generated baseline ETo data:

```bash
docker run -d --name opensprinkler-weather \
  --env-file .env -p 3000:3000 \
  ghcr.io/opensprinkler/weather-server:release
```

For a local PWS, enable persistence and retain `/data` across container replacement:

```bash
docker run -d --name opensprinkler-weather \
  --env-file .env -e LOCAL_PERSISTENCE=true \
  -v opensprinkler-weather-data:/data -p 3000:3000 \
  ghcr.io/opensprinkler/weather-server:release
```

To build the image locally, run `docker build -t opensprinkler-weather .`. Generating the baseline ETo dataset makes this build CPU-, memory-, and disk-intensive.

## Endpoints

The principal routes are:

- `/0`, `/1`, `/2`, `/3`: manual, Zimmerman, rain-delay, and ETo adjustment responses.
- `/weatherData`: current conditions and forecast data for the UI.
- `/weatherSensorData`: compact current, forecast, and historical values for controller WeatherSensor instances.
- `/baselineETo`: average daily baseline ETo for a location.
- `/weatherstation/updateweatherstation.php`: local PWS observation upload when `PWS=WU`.

See the [HTTP API reference](docs/api.md) for parameters, response schemas, units, caching, and error handling.

## Development

Run the deterministic release checks before submitting changes:

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
```

Live-provider and deployed-server comparison tests are documented in [Weather Service Testing](docs/weather-testing.md).

## License and Support

- [OpenSprinkler](https://opensprinkler.com)
- [Support](https://openthings.freshdesk.com/support/home)
- [Releases](https://github.com/OpenSprinkler/OpenSprinkler-Weather/releases)
