# DWD / Bright Sky

The DWD provider uses the [Bright Sky API](https://brightsky.dev/) to retrieve Deutscher Wetterdienst observations and forecasts. It is intended for locations in Germany and requires no API key.

Select it in `.env`:

```text
WEATHER_PROVIDER=DWD
```

The provider supports current and forecast weather, historical data, Zimmerman adjustment, rain delay, ETo, and WeatherSensor values. Wind observations are standardized to a 2 m measurement height for ETo calculations.
