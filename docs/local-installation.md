# Local Weather Service and PWS Setup

A self-hosted weather service can use a public provider, locally streamed personal weather station (PWS) observations, or both. The repository [README](../README.md) contains the standard Node.js and Docker installation commands; this page covers long-running service setup and PWS integration.

## Local PWS Behavior

Set `PWS=WU` to enable the Weather Underground-compatible upload route. This setting is independent of `WEATHER_PROVIDER`: for example, the service can retain local observations while Open-Meteo supplies controller weather requests.

To calculate adjustments entirely from the local station, use:

```text
PWS=WU
WEATHER_PROVIDER=local
LOCAL_PERSISTENCE=true
PERSISTENCE_LOCATION=/var/lib/opensprinkler-weather
```

Create `PERSISTENCE_LOCATION` with write permission for the account running the service. The local provider retains eight days of observations and returns up to seven contiguous, complete local-calendar days, newest first.

- Zimmerman requires temperature, humidity, and precipitation coverage for a complete previous local-calendar day.
- ETo additionally requires wind and solar-radiation coverage for each day it uses.
- Observation gaps greater than two hours make the affected daily measurement unavailable.
- Collection begins immediately, but adjustment cannot begin until a complete previous day exists.

Observations are saved every 30 minutes and on graceful shutdown. An abrupt process or host failure can lose data received since the last checkpoint.

## Run with systemd

Build the service under a stable path such as `/opt/opensprinkler-weather`, then create `/etc/systemd/system/opensprinkler-weather.service`:

```ini
[Unit]
Description=OpenSprinkler Weather Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opensprinkler
Group=opensprinkler
WorkingDirectory=/opt/opensprinkler-weather
EnvironmentFile=/opt/opensprinkler-weather/.env
ExecStart=/usr/bin/node /opt/opensprinkler-weather/dist/index.cjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Adjust the user, paths, and Node executable for your installation. Then enable and inspect the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now opensprinkler-weather.service
systemctl status opensprinkler-weather.service
journalctl -u opensprinkler-weather.service -f
```

## Verify the Service

Check the version endpoint and one adjustment request:

```text
http://<weather-host>:<port>/
http://<weather-host>:<port>/1?loc=40.7128,-74.0060&wto="provider":"OpenMeteo","h":100,"t":100,"r":100,"bh":30,"bt":70,"br":0&format=json
```

Configure the controller's weather-service host and port through its `/su` page. Ensure the controller can reach the service over the selected address and port.

## PWS Integration Options

### Configurable HTTP Output

Some stations and gateways can send a custom HTTP GET request. Point them at the [PWS upload endpoint](pws-protocol.md) and map their measurements to the documented fields.

### Weather Underground-Compatible Devices

Some networked stations have a fixed Weather Underground destination. Existing community guides describe redirecting those requests through a Raspberry Pi:

- [Ethernet interception](man-in-middle.md)
- [WiFi access-point interception](wifi-hotspot.md)

These network configurations are hardware- and operating-system-specific. Review firewall and routing commands before applying them.

### WeeWX

[WeeWX](weewx.md) supports many station models and can forward observations to the local weather service.

### Device-Specific Guides

- [Davis Vantage](davis-vantage.md)
- [Netatmo through WeeWX](netatmo.md)

These are community-maintained integrations and may require adaptation for current versions of their respective software.
