# Open-Meteo

[Open-Meteo](https://open-meteo.com/) combines regional and global forecast models and is available worldwide without an API key. It is a practical default for self-hosted weather services.

Select it in `.env`:

```text
WEATHER_PROVIDER=OpenMeteo
```

The provider supports current and forecast weather, historical data, Zimmerman adjustment, rain delay, ETo, and WeatherSensor values.
