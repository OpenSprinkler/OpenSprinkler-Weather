# Configuration

The service loads environment variables from the process environment and an optional `.env` file. Start with the repository's `.env.example`; never commit real API keys or Apple private keys.

## Server

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` for remote or container access. |
| `PORT` | `3000` | HTTP listen port. Must be between 1 and 65535. |
| `HTTP_PORT` | unset | Compatibility alias used only when `PORT` is unset. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |

## Weather Providers

| Provider | `WEATHER_PROVIDER` | Credential variables |
| --- | --- | --- |
| Apple WeatherKit | `Apple` | `APPLE_PRIVATE_KEY`, `APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SERVICE_ID` |
| Open-Meteo | `OpenMeteo` | None |
| DWD / Bright Sky | `DWD` | None; German locations only |
| AccuWeather | `AW` | `ACCUWEATHER_API_KEY` |
| OpenWeather | `OWM` | `OWM_API_KEY` |
| Pirate Weather | `PW` | `PIRATEWEATHER_API_KEY` |
| Weather Underground PWS | `WU` | Station ID and key normally arrive in the request's `wto` parameter |
| Locally streamed PWS | `local` | Enable the upload route with `PWS=WU` |

If `WEATHER_PROVIDER` is missing or unrecognized, the service selects Apple. Self-hosted installations without Apple credentials should explicitly select `OpenMeteo` or another configured provider.

`PWS_WEATHER_PROVIDER` selects the provider used when a request contains a PWS station ID; it defaults to `WU`.

## Geocoding

| Variable | Default | Description |
| --- | --- | --- |
| `GEOCODER` | `WU` | Geocoder used when `loc` is not a coordinate pair. `GoogleMaps` is also supported. |
| `GOOGLE_MAPS_API_KEY` | unset | Required when `GEOCODER=GoogleMaps`. |
| `GEOCODER_CACHE_FILE` | `geocoderCache.json` | Persistent geocoder cache path. Docker sets this to `/data/geocoderCache.json`. |

No geocoder credential is needed when every request supplies `latitude,longitude` directly.

## Local PWS

| Variable | Default | Description |
| --- | --- | --- |
| `PWS` | `none` | Set to `WU` to register the Weather Underground-compatible upload endpoint. |
| `LOCAL_PERSISTENCE` | `false` | Accepts `true`, `false`, `1`, `0`, `yes`, `no`, `on`, or `off`. |
| `PERSISTENCE_LOCATION` | working directory | Directory containing `observations.json`. Docker defaults to `/data`. |

Persistence is independent of `WEATHER_PROVIDER`: the service can collect local observations while another provider handles controller requests. Observations are checkpointed every 30 minutes and on graceful `SIGINT` or `SIGTERM` shutdown. An abrupt process or host failure can lose observations received since the last checkpoint.

## Data Files

| Variable | Default | Description |
| --- | --- | --- |
| `BASELINE_ETO_FILE` | `baselineEToData/Baseline_ETo_Data.bin` | Baseline ETo dataset used by `/baselineETo`. |
| `GEO_TZ_DATA_PATH` | bundled `geo-tz` data | Advanced override for the timezone dataset. Normally leave unset. |
