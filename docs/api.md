# HTTP API

The service exposes controller-compatible watering-adjustment routes and JSON weather-data routes. Examples below use `http://127.0.0.1:3000`; replace the host and port for your deployment.

## Common Parameters

| Parameter | Description |
| --- | --- |
| `loc` | Location as `latitude,longitude`, such as `40.7128,-74.0060`. Text locations require a configured geocoder. |
| `wto` | Comma-separated JSON object members without the outer braces. URL-encode this value in clients. |
| `format=json` | Requests JSON from adjustment routes. Without it, those routes return the legacy `&key=value` controller format. |

Provider selection is carried in `wto`, for example `"provider":"OpenMeteo"`. Keyed providers may also receive `"key":"..."`; Weather Underground PWS requests use `provider`, `pws`, and `key` together.

## Service Information

`GET /` returns the service name and package version as plain text.

## Watering Adjustments

The numeric route identifies the adjustment method. Legacy `/weather0.py` through `/weather3.py` aliases remain available.

| Route | Method | Principal `wto` fields |
| --- | --- | --- |
| `/0` | Manual | No weather fields required. |
| `/1` | Zimmerman | `h`, `t`, `r` weights and `bh`, `bt`, `br` baselines. |
| `/2` | Automatic rain delay | `d`: delay duration in hours. |
| `/3` | ETo | `baseETo`: inches/day; `elevation`: feet. |

Example JSON request:

```text
GET /3?loc=40.7128,-74.0060&wto="provider":"OpenMeteo","baseETo":0.15,"elevation":33&format=json
```

Successful adjustment responses can contain:

| Field | Meaning |
| --- | --- |
| `scale` | Watering percentage, normally constrained to 0–200. |
| `rd` | Rain-delay duration in hours, when applicable. |
| `restricted` | `1` when a configured weather restriction is active. |
| `tz` | OpenSprinkler-encoded time-zone value. |
| `sunrise`, `sunset` | Minutes from UTC midnight. |
| `eip` | Requester's IPv4 address encoded as an integer. |
| `rawData` | Method-specific source values. |
| `scales` | Rolling multiday watering percentages, newest day first. |
| `ttl` | Remaining cache lifetime in milliseconds. |
| `errCode` | `0` on success; otherwise an error code listed below. |

Weather restrictions may be included in `wto`: `minTemp`, `rainAmt` with `rainDays`, and `cali`.

The `cali` restriction normally sums the two most recent complete historical days. If a provider supplies only one complete day, that day's precipitation can still activate the restriction; unavailable earlier history does not by itself force watering off.

## Weather Data

`GET /weatherData?loc=latitude,longitude&wto=...` returns a JSON object used by the UI. Temperatures are Fahrenheit, wind is mph, precipitation is inches, and timestamps are Unix epoch seconds.

The response includes provider identity, current conditions when available, today's minimum and maximum temperature and precipitation, a daily `forecast` array, time-zone and sunrise/sunset data, cache `ttl`, resolved coordinates, and provider attribution when required.

## WeatherSensor Data

`GET /weatherSensorData` provides a compact, versioned response for controller WeatherSensor instances.

| Parameter | Default | Description |
| --- | --- | --- |
| `loc` | required | `latitude,longitude` or a geocodable location. |
| `scope` | `cfh` | Any combination of `c` (current), `f` (forecast), and `h` (historical). |
| `wto` | empty | Provider selection and optional ETo `elevation` in feet. |

Example:

```text
GET /weatherSensorData?loc=40.7128,-74.0060&scope=cfh&wto="provider":"OpenMeteo","elevation":33
```

```json
{
  "v": 1,
  "u": "us",
  "wp": "OpenMeteo",
  "c": { "at": 1786200000, "t": 72.4, "h": 61, "w": 4.8, "r": 0 },
  "f": { "at": 1786233600, "lo": 65.1, "hi": 79.3, "p": 0.04 },
  "h": { "at": 1786147200, "t": 70.2, "h": 64, "p": 0.12, "w": 3.9, "sr": 4.83, "eto": 0.137 }
}
```

Top-level fields:

| Field | Meaning |
| --- | --- |
| `v` | Schema version; currently `1`. |
| `u` | Unit system; currently `us`. |
| `wp` | Provider that supplied the returned data. |
| `c`, `f`, `h` | Current, forecast, and historical blocks requested by `scope`. |
| `e` | Per-scope errors, such as `{ "f": 40 }`, when another requested scope still succeeded. |

Compact value fields:

| Field | Unit or meaning |
| --- | --- |
| `at` | Unix epoch seconds. For current data, this is when the provider response entered the cache. |
| `t`, `lo`, `hi` | Degrees Fahrenheit. |
| `h` | Relative humidity percentage. |
| `w` | Miles per hour; historical wind is standardized to a 2 m measurement height. |
| `r` | Current rain indicator: `0` or `1`. |
| `p` | Inches of precipitation. |
| `sr` | Solar energy in kWh/m²/day. |
| `eto` | Reference ETo in inches/day. Omitted when required inputs are unavailable. |

Unavailable values and blocks are omitted. If every requested scope fails, the route returns HTTP 502 with `{ "errCode": N }`. Invalid parameters return HTTP 400.

## Baseline ETo

`GET /baselineETo?loc=latitude,longitude` returns the long-term average daily ETo in inches/day:

```json
{ "eto": 0.142 }
```

This endpoint requires a readable `Baseline_ETo_Data.bin`. It returns HTTP 503 while the data is unavailable and HTTP 404 when the location cannot be resolved or has no dataset coverage.

## Local PWS Upload

When `PWS=WU`, observations can be sent to:

```text
GET /weatherstation/updateweatherstation.php?...fields...
```

See the [PWS Upload Protocol](pws-protocol.md) for fields and data-coverage requirements.

## Caching

Provider caches are shared by adjustment, `/weatherData`, and `/weatherSensorData` consumers for the same provider and location. Current/forecast data expires at the next six-hour boundary in the location's time zone. Historical watering data expires at the next local midnight. Concurrent misses are coalesced into one provider request.

## Error Codes

| Code | Meaning |
| ---: | --- |
| 0 | No error |
| 1 | Invalid weather data |
| 10 | Insufficient historical coverage |
| 11 | Required weather field missing |
| 12 | Weather provider HTTP or parsing error |
| 2, 20, 21, 22 | Location or geocoder errors |
| 3 | Reserved PWS error-category code |
| 30, 31, 32, 33, 34 | PWS validation, authentication, or capability errors |
| 35 | Provider API key missing |
| 4 | Reserved adjustment-method error-category code |
| 40, 41 | Unsupported or invalid adjustment method |
| 5 | Reserved adjustment-option error-category code |
| 50, 51 | Malformed or incomplete adjustment options |
| 99 | Unexpected internal error |
