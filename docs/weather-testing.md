# Weather Service Testing

The weather service uses three complementary test layers. Live weather alone is not a sufficient regression test because it cannot reliably exercise snow, malformed responses, missing fields, daylight-saving transitions, or provider failures.

## Deterministic Tests

Run the unit, provider-fixture, cache, and endpoint-contract tests before every merge:

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
```

These tests do not contact external weather providers. They cover provider field normalization, units, rain and snow, missing fields, HTTP failures, 23/25-hour days, irregular PWS observations, ETo calculations, cache reuse, concurrent request coalescing, expiration, and retry after failure.

## Start a Local Service

The live runner tests through HTTP, so build and start the service in another terminal first:

```bash
npm run build
HOST=127.0.0.1 PORT=3000 npm start
```

The service reads its normal `.env`. `baselineEToData/Baseline_ETo_Data.bin` must exist for `/baselineETo` and ETo adjustment tests.

## Smoke Profile

The bounded smoke profile exercises the default Apple provider, Open-Meteo, and Bright Sky/DWD across representative locations. It tests current weather, forecast, historical weather, all adjustment methods, the compact sensor endpoint, baseline ETo, malformed requests, and basic legacy route compatibility. The full profile exercises every legacy route in the controller's query-string response format.

```bash
npm run test:weather-smoke
```

The default provider case is skipped when the Apple WeatherKit environment is incomplete. For production validation, configure:

```text
APPLE_PRIVATE_KEY
APPLE_KEY_ID
APPLE_TEAM_ID
APPLE_SERVICE_ID
```

## Full Profile

The full profile adds all sampled locations, keyed providers, and all legacy adjustment routes:

```bash
npm run test:weather-full
```

Keyed providers run only when their corresponding variables exist:

| Provider | Required environment |
| --- | --- |
| Apple | `APPLE_PRIVATE_KEY`, `APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SERVICE_ID` |
| AccuWeather | `ACCUWEATHER_API_KEY` |
| OpenWeather | `OWM_API_KEY` |
| Pirate Weather | `PIRATEWEATHER_API_KEY` |
| Weather Underground | `WEATHER_TEST_WU_ID`, `WEATHER_TEST_WU_KEY`, `WEATHER_TEST_WU_LAT`, `WEATHER_TEST_WU_LON` |

Use `--include-unconfigured` only when testing a remote server known to have its own credentials. Missing providers are otherwise reported as skipped rather than failed.

The default location catalog is [test/live/locations.json](../test/live/locations.json). Open-Meteo uses the complete catalog, paid providers use a smaller representative subset, and Bright Sky is limited to German locations. This keeps API usage controlled while covering US time zones, both hemispheres, tropical, arid, wet, and high-latitude climates.

## Deployed-Server Comparison

Use the deployed service as a differential reference:

```bash
npm run test:weather-smoke -- \
  --compare https://weather.opensprinkler.com
```

Comparison differences are warnings, not failures. Provider observations, cache times, and deployed code can legitimately differ. The runner reports large differences in temperature, humidity, wind, precipitation, solar radiation, ETo, scale, provider identity, status, and error codes. It does not encode expected differences from the currently deployed version because those expectations become invalid as soon as that version is deployed. Deterministic provider tests permanently assert corrected Pirate Weather precipitation, Weather Underground mean wind, and DWD measured solar behavior.

WU and local PWS requests are not sent to the comparison server because they contain station-specific data.

## Local PWS

Start the service with its local upload route and provider enabled:

```text
PWS=WU
WEATHER_PROVIDER=local
```

Then upload a synthetic 48-hour observation stream, ensuring the previous local-calendar day is complete, and test it with:

```bash
npm run test:weather-full -- --providers local --include-local-pws
```

## Runner Options

```text
--base URL                 service under test
--compare URL              optional differential server
--profile smoke|full       test matrix
--providers IDS            comma-separated provider IDs
--timeout MS               per-request timeout
--concurrency N            maximum concurrent requests, 1-10
--delay MS                 delay before each request
--include-local-pws        prepare and test synthetic local observations
--include-unconfigured     do not skip providers with missing test environment
--report FILE              output JSON report path
```

The default concurrency is two and no automatic retries are made. This avoids amplifying rate-limit or authentication failures. Reports are written under `artifacts/`, which is ignored by Git. Request URLs and response objects are sanitized so API keys and authorization fields are not written to reports.

## Interpreting Results

- **Pass:** HTTP contract, provider identity, required fields, units, bounds, and ordering are valid.
- **Warning:** the local response is valid, but differs materially from the comparison server, another cached endpoint, or other providers serving the same sampled location. Cross-provider checks use broad thresholds and are intended to expose gross unit or field-selection errors, not normal forecast-model variation.
- **Fail:** timeout, unexpected HTTP status, provider error, malformed schema, non-finite value, invalid range, or inconsistent ordering.
- **Skip:** provider credentials or optional PWS setup are unavailable.

The command exits nonzero only when one or more cases fail. Warnings and skips remain visible in the console and JSON report for release review.

## Persistence Shutdown Check

When local persistence changes, verify more than the periodic checkpoint:

1. Start the service with `PWS=WU`, `LOCAL_PERSISTENCE=true`, and a temporary `PERSISTENCE_LOCATION`.
2. Upload an observation with `dateutc=now` to `/weatherstation/updateweatherstation.php`.
3. Send `SIGTERM` or press Ctrl+C before the 30-minute interval expires.
4. Confirm `observations.json` exists, contains the uploaded observation, and loads after restart.

This checks the graceful-shutdown path used by `docker stop` and systemd. It does not simulate an abrupt power or process failure, which can lose observations since the last periodic checkpoint.

## Release Checklist

Before deploying a release:

1. Run the deterministic tests, type check, and production build from a clean `npm ci` installation.
2. Run the default-provider smoke profile with the production Apple WeatherKit credentials.
3. Run the Open-Meteo and DWD full profiles. Treat provider HTTP 5xx responses as upstream failures, but rerun before deployment.
4. Run the synthetic local-PWS profile and the persistence shutdown check.
5. Require GitHub's amd64 and arm64 Docker jobs to pass; the Docker build generates and packages the baseline ETo data.
6. Deploy to a staging or canary instance and query `/0`, `/1`, `/2`, `/3`, `/weatherData`, `/weatherSensorData`, and `/baselineETo`.
7. Confirm provider attribution, cache behavior, error logs, and local persistent volume ownership before promoting the image.
