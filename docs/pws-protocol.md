# Personal Weather Station Upload Protocol

The local weather service accepts Weather Underground-compatible observations through an HTTP GET request when `PWS=WU` is configured:

```text
GET /weatherstation/updateweatherstation.php
```

The route returns `success` after accepting the request. Values equal to `-9999` and malformed numeric values are treated as unavailable. Partial observations are allowed, but adjustment methods require sufficient coverage of their respective fields.

## Fields

| Field | Unit and format | Use |
| --- | --- | --- |
| `dateutc` | `YYYY-MM-DD HH:MM:SS` in UTC, or `now` | Observation timestamp. Supply this for every useful observation. |
| `tempf` | °F | Temperature; required over the day for Zimmerman and ETo. |
| `humidity` | 0–100% | Relative humidity; required over the day for Zimmerman and ETo. |
| `dailyrainin` | inches | Cumulative rainfall since local midnight. Successive differences produce interval precipitation. |
| `rainin` | inches over the previous hour | A positive value marks the station as currently raining. |
| `windspeedmph` | mph | Wind speed; required over the day for local ETo. |
| `solarradiation` | W/m² | Solar irradiance; required over the day for local ETo. |

The first cumulative-rain observation establishes a baseline. If `dailyrainin` decreases, the service treats it as a daily counter reset. Send observations in chronological order whenever possible.

## Coverage

For a daily adjustment, samples must cover the previous local-calendar day without a gap greater than two hours. Zimmerman uses temperature, humidity, and precipitation. ETo also needs wind and solar radiation. Sending every 5–15 minutes is typical and provides comfortable margin for transient upload failures.

The local provider retains eight days and exposes up to seven complete, contiguous days for multiday averaging. Enable `LOCAL_PERSISTENCE` so this history survives restarts.

## Example

Query values must be URL-encoded. For example, a space in `dateutc` may be encoded as `+` and colons as `%3A`:

```text
http://192.168.1.10:3000/weatherstation/updateweatherstation.php?dateutc=2026-08-09+14%3A30%3A00&tempf=72.5&humidity=58&windspeedmph=4.2&solarradiation=420&rainin=0&dailyrainin=0.12
```

For quick testing, `dateutc=now` uses the server's current time.
