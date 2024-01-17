# Local Davis Weather Station with WeatherLink Live

You need to buy a WeatherLink Live device – this is the only device that has a local API.

You can read more about the API here: https://weatherlink.github.io/weatherlink-live-local-api/

On MacOS, you need to figure out the mDNS address of the WeatherLink Live device. You can do that using the `dns-sd` command:

```sh
❯ dns-sd -B _weatherlinklive._tcp local
Browsing for _weatherlinklive._tcp.local
DATE: ---Wed 17 Jan 2024---
12:32:15.786  ...STARTING...
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
12:32:15.787  Add        2  14 local.               _weatherlinklive._tcp. weatherlinklive-719e35
```

This is showiung that my weatherlink live instance name as `weatherlinklive-719e35`. This means that its serving from a `weatherlinklive-719e35.local` web address. You can make sure you have the right one by using `curl` to check for the current weather conditions:

```sh
❯ curl -X GET -H "application/json" http://weatherlinklive-719e35.local/v1/current_conditions
{"data":{"did":"001D0A719E35","ts":1705523645,"conditions":[{"lsid":690486,"data_structure_type":1,"txid":2,"temp": 57.3,"hum":81.9,"dew_point": 51.8,"wet_bulb": 53.9,"heat_index": 57.3,"wind_chill": 57.3,"thw_index": 57.3,"thsw_index": 57.7,"wind_speed_last":0.00,"wind_dir_last":0,"wind_speed_avg_last_1_min":0.00,"wind_dir_scalar_avg_last_1_min":0,"wind_speed_avg_last_2_min":0.06,"wind_dir_scalar_avg_last_2_min":132,"wind_speed_hi_last_2_min":null,"wind_dir_at_hi_speed_last_2_min":null,"wind_speed_avg_last_10_min":0.37,"wind_dir_scalar_avg_last_10_min":129,"wind_speed_hi_last_10_min":3.00,"wind_dir_at_hi_speed_last_10_min":138,"rain_size":1,"rain_rate_last":0,"rain_rate_hi":0,"rainfall_last_15_min":0,"rain_rate_hi_last_15_min":0,"rainfall_last_60_min":0,"rainfall_last_24_hr":29,"rain_storm":29,"rain_storm_start_at":1705446961,"solar_rad":91,"uv_index":1.1,"rx_state":0,"trans_battery_flag":0,"rainfall_daily":4,"rainfall_monthly":70,"rainfall_year":70,"rain_storm_last":41,"rain_storm_last_start_at":1705158841,"rain_storm_last_end_at":1705334461},{"lsid":690482,"data_structure_type":4,"temp_in": 72.0,"hum_in":46.2,"dew_point_in": 50.2,"heat_index_in": 70.6},{"lsid":690481,"data_structure_type":3,"bar_sea_level":30.075,"bar_trend":-0.009,"bar_absolute":29.906}]},"error":null}%
```


Now that you have the Weatherlink Live figured out, you need to host this OpenSprinkler-Weather server somewhere on the same local network. A Raspberry Pi 4 works great. After you ssh into your Pi, follow the [local installation instructions](./local-installation.md).

Here's an abbreviated version.

Download dependencies for your raspberry pi.

```sh
sudo apt-get update
sudo apt-get install git nodejs npm
```

Install the weather server.

```sh
git clone https://github.com/OpenSprinkler/OpenSprinkler-Weather.git
cd OpenSprinkler-Weather
npm install
npm run compile
```

Create this `.env` file, using the weatherlink live address you determined above.

```sh
HOST=0.0.0.0
PORT=3344
WEATHER_PROVIDER=local
PWS=weatherlink
WEATHERLINK_URL=http://weatherlinklive-719e35.local/v1/current_conditions
LOCAL_PERSISTENCE=1
```

There's a convenient script for adding this server to systemd:

```sh
sudo npm i add-to-systemd
sudo add-to-systemd weather "$(which npm) start" --cwd `pwd` --restart 10
```

Boot it up!
```sh
sudo systemctl enable weather.service
sudo systemctl start weather.service
systemctl status weather.service

# View logs
journalctl -u weather.service
```

Don't worry about the error regarding `Baseline_ETo_Data.bin` file not existing. You can just set the baseline value yourself.

Check that its working:
```sh
curl http://localhost:3344
```

Now just wait 24 hours for the observational data to accumulate before going to http://<opensprinkler_ip>:80/su to set the weather url.
