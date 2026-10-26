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

### Independent Forecast Provider

`FORECAST_WEATHER_PROVIDER` optionally selects a different source for the
forecast-rain restriction (`rainAmt`/`rainDays`), the `/weatherData` forecast fields,
and the `/weatherSensorData` forecast block. For example:

```dotenv
WEATHER_PROVIDER=local
FORECAST_WEATHER_PROVIDER=OpenMeteo
PWS=WU
LOCAL_PERSISTENCE=true
```

Current observations, ETo/Zimmerman history, minimum-temperature restrictions,
and California rain-history restrictions still use the main provider. Selecting
an external forecast does not fill gaps in local observations.

Leave the override unset or blank to preserve existing behavior, including
per-controller provider selection and WU station credentials. When both sources
resolve to the same provider, the service reuses its original result and request
credentials.

Supported override values are `OpenMeteo`, `DWD`, `Apple`, `OWM`, `AW`, and `PW`.
Use these exact short IDs; long names such as `AccuWeather` are not aliases.
`OWM`, `AW`, and `PW` require their respective server API keys from the table
above. Apple requires its normal server-side WeatherKit credentials; DWD retains
its geographic coverage limits. A separate forecast provider never receives the
controller's main-provider key or station ID.

Unknown overrides, `WU`, `local`, and keyed overrides without their server API
key prevent startup with a configuration error. WU needs per-request station
credentials, and local observations have no forecast; both remain supported as
main providers when the override is unset. A keyed override requires its server
key even if some requests select the same main provider.

If a provider fails during an enabled rain or temperature restriction check,
the watering endpoint returns its existing `Error: …` response, rather than a
successful response that skips the restriction. This also prevents an updated
watering scale from being returned on that request. It does not itself command
the controller to stop watering; retained settings and timeout behavior depend
on firmware. During a separate forecast outage, `/weatherData` returns the main
provider's data unchanged, and `/weatherSensorData` reports a forecast error
while retaining other successful requested scopes.

For mixed `/weatherData` responses, `weatherProvider` remains the main source and
`forecastProvider` identifies the external forecast source. Forecast attribution
in the App must prefer `forecastProvider`, then fall back to older provider fields.
[App PR #306](https://github.com/OpenSprinkler/OpenSprinkler-App/pull/306) needs this
additional field preference; its original fallback reorder alone is insufficient.
Until the App supports this field, mixed forecasts can display the main provider's
attribution. Coordinate the App update before deploying mixed-source forecast
pages, particularly when the provider requires attribution.

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
