import * as express	from "express";
import * as moment from "moment";
import * as fs from "fs";

import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

var queue: Array<Observation> = [],
	lastRainEpoch = 0,
	lastRainCount: number;

function getMeasurement(req: express.Request, key: string): number {
	let value: number;

	return ( key in req.query ) && !isNaN( value = parseFloat( req.query[key] ) ) && ( value !== -9999.0 ) ? value : undefined;
}

export const captureWUStream = async function( req: express.Request, res: express.Response ) {
	let rainCount = getMeasurement(req, "dailyrainin");

	const obs: Observation = {
		timestamp: req.query.dateutc === "now" ? moment().unix() : moment( req.query.dateutc + "Z" ).unix(),
		temp: getMeasurement(req, "tempf"),
		humidity: getMeasurement(req, "humidity"),
		windSpeed: getMeasurement(req, "windspeedmph"),
		solarRadiation: getMeasurement(req, "solarradiation") * 24 / 1000,	// Convert to kWh/m^2 per day
		precip: rainCount < lastRainCount ? rainCount : rainCount - lastRainCount,
	};

	lastRainEpoch = getMeasurement(req, "rainin") > 0 ? obs.timestamp : lastRainEpoch;
	lastRainCount = isNaN(rainCount) ? lastRainCount : rainCount;

	queue.unshift(obs);

	res.send( "success\n" );
};

type DavisWeatherStationData = {
  /** logical sensor ID **(no unit)** */
	lsid: number;
  /** data structure type **(no unit)** */
	data_structure_type: 1;
  /** transmitter ID **(no unit)** */
	txid: number;
  /** most recent valid temperature **(°F)** */
	temp: number;
  /** most recent valid humidity **(%RH)** */
	hum: number;
  /** **(°F)** */
	dew_point: number;
  /** **(°F)** */
	wet_bulb: number | null;
  /** **(°F)** */
	heat_index: number;
  /** **(°F)** */
	wind_chill: number;
  /** **(°F)** */
	thw_index: number;
  /** **(°F)** */
	thsw_index: number;
  /** most recent valid wind speed **(mph)** */
	wind_speed_last: number;
  /** most recent valid wind direction **(°degree)** */
	wind_dir_last: number | null;
  /** average wind speed over last 1 min **(mph)** */
	wind_speed_avg_last_1_min: number;
  /** scalar average wind direction over last 1 min **(°degree)** */
	wind_dir_scalar_avg_last_1_min: number;
  /** average wind speed over last 2 min **(mph)** */
	wind_speed_avg_last_2_min: number;
  /** scalar average wind direction over last 2 min **(°degree)** */
	wind_dir_scalar_avg_last_2_min: number;
  /** maximum wind speed over last 2 min **(mph)** */
	wind_speed_hi_last_2_min: number;
  /** gust wind direction over last 2 min **(°degree)** */
	wind_dir_at_hi_speed_last_2_min: number;
  /** average wind speed over last 10 min **(mph)** */
	wind_speed_avg_last_10_min: number;
  /** scalar average wind direction over last 10 min **(°degree)** */
	wind_dir_scalar_avg_last_10_min: number;
  /** maximum wind speed over last 10 min **(mph)** */
	wind_speed_hi_last_10_min: number;
  /** gust wind direction over last 10 min **(°degree)** */
	wind_dir_at_hi_speed_last_10_min: number;
  /** rain collector type/size **(0: Reserved, 1: 0.01", 2: 0.2 mm, 3:  0.1 mm, 4: 0.001")** */
	rain_size: number;
  /** most recent valid rain rate **(counts/hour)** */
	rain_rate_last: number;
  /** highest rain rate over last 1 min **(counts/hour)** */
	rain_rate_hi: number | null;
  /** total rain count over last 15 min **(counts)** */
	rainfall_last_15_min: number | null;
  /** highest rain rate over last 15 min **(counts/hour)** */
	rain_rate_hi_last_15_min: number;
  /** total rain count for last 60 min **(counts)** */
	rainfall_last_60_min: number | null;
  /** total rain count for last 24 hours **(counts)** */
	rainfall_last_24_hr: number | null;
  /** total rain count since last 24 hour long break in rain **(counts)** */
	rain_storm: number | null;
  /** UNIX timestamp of current rain storm start **(seconds)** */
	rain_storm_start_at: number | null;
  /** most recent solar radiation **(W/m²)** */
	solar_rad: number;
  /** most recent UV index **(Index)** */
	uv_index: number;
  /** configured radio receiver state **(no unit)** */
	rx_state: number;
  /** transmitter battery status flag **(no unit)** */
	trans_battery_flag: number;
  /** total rain count since local midnight **(counts)** */
	rainfall_daily: number;
  /** total rain count since first of month at local midnight **(counts)** */
	rainfall_monthly: number;
  /** total rain count since first of user-chosen month at local midnight **(counts)** */
	rainfall_year: number;
  /** total rain count since last 24 hour long break in rain **(counts)** */
	rain_storm_last: number | null;
  /** UNIX timestamp of last rain storm start **(sec)** */
	rain_storm_last_start_at: number | null;
  /** UNIX timestamp of last rain storm end **(sec)** */
	rain_storm_last_end_at: number | null;
};

type WeatherlinkLiveData = {
	// Apparently the Weatherlink Live has indoor sensors.
	data_structure_type: 4;
	lsid: number; // 690482;
	temp_in: number // 70.8;
	hum_in: number // 45.6;
	dew_point_in: number // 48.8;
	heat_index_in: number // 69.0;
}

/**
 * Comments are examples of data found from a Vantage Pro2 Plus Sensor Suite (SKU 6328) and a WeatherLink Live.
 * Note that your Davis weather station may not have all of these sensors.
 */
type WeatherlinkResponse = {
  data: {
    did: string; // "001D0A719E35";
    ts: number; // 1705448784;
    conditions: Array<
      | DavisWeatherStationData
      | WeatherlinkLiveData
			// Not sure why this is separate.
      | {
        lsid: number // 690481;
        data_structure_type: 3
        bar_sea_level: number // 30.067;
        bar_trend: number // -0.021;
        bar_absolute: number // 29.898;
      }
    >;
  };
  error: null;
};


let lastPollMs: number | null = null

export async function pollWeatherlink(weatherLinkUrl: string) {
	if (lastPollMs === null) {
		lastPollMs = Date.now()
		return
	}
	const nowMs = Date.now()
	// This interval is used to computing rates correctly.
	const intervalMs = nowMs - lastPollMs
	lastPollMs = nowMs

	const MinuteMs = 1000*60
	const HourMs = MinuteMs*60
	const DayMs = HourMs*24

  const response = await fetch(weatherLinkUrl);
  const { data }: WeatherlinkResponse = await response.json();

	const weatherStation = data.conditions.find(device => device.data_structure_type === 1) as DavisWeatherStationData | undefined

	if (!weatherStation) {
		console.error("Could not find Davis weather station data from Weatherlink Live.")
		return
	}

	const currentTempF = weatherStation.temp;
	const currentPercentRelativeHumidity = weatherStation.hum;
	const averageWindspeedLastMinuteMph =
    weatherStation.wind_speed_avg_last_1_min;

	let solarRadiation = weatherStation.solar_rad / 1000; // kW/m^2
	const samplesPerHour = HourMs / intervalMs; // samples/hr, 60 for every minute
	solarRadiation = solarRadiation / samplesPerHour; // kWh/m^2 / sample
	const samplesPerDay = DayMs / intervalMs // samples/day, 24*60 for every minute.
	solarRadiation = solarRadiation * samplesPerDay; // kWh/m^2 / day
	// Net math we did here is `solar_rad/1000/60*24*60` = `solar_rad/1000*24` which is same as captureWUStream.

	const rainCupSizeInches: number = {
    1: 0.01, // 0.01 inch
    2: 0.0079, // 0.2 mm
    3: 0.0039, // 0.1 mm
    4: 0.001, // 0.001 in
  }[weatherStation.rain_size];

	const rainInchesLastMinute =
    (rainCupSizeInches * weatherStation.rainfall_last_15_min) * intervalMs / (15*MinuteMs);

	const observation: Observation = {
    timestamp: moment().unix(),
    temp: currentTempF,
    humidity: currentPercentRelativeHumidity,
    windSpeed: averageWindspeedLastMinuteMph,
    solarRadiation: solarRadiation,
    precip: rainInchesLastMinute,
  };

  queue.unshift(observation);
}


export default class LocalWeatherProvider extends WeatherProvider {

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
		queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );

		if ( queue.length == 0 ) {
			console.error( "There is insufficient data to support Weather response from local PWS." );
			throw "There is insufficient data to support Weather response from local PWS.";
		}

		const weather: WeatherData = {
			weatherProvider: "local",
			temp: Math.floor( queue[ 0 ].temp ) || undefined,
			minTemp: undefined,
			maxTemp: undefined,
			humidity: Math.floor( queue[ 0 ].humidity ) || undefined ,
			wind: Math.floor( queue[ 0 ].windSpeed * 10 ) / 10 || undefined,
			precip: Math.floor( queue.reduce( ( sum, obs ) => sum + ( obs.precip || 0 ), 0) * 100 ) / 100,
			description: "",
			icon: "01d",
			region: undefined,
			city: undefined,
			forecast: []
		};

		return weather;
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData > {

		queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );

		if ( queue.length == 0 || queue[ 0 ].timestamp - queue[ queue.length - 1 ].timestamp < 23*60*60 ) {
			console.error( "There is insufficient data to support Zimmerman calculation from local PWS." );
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		let cTemp = 0, cHumidity = 0, cPrecip = 0;
		const result: ZimmermanWateringData = {
			weatherProvider: "local",
			temp: queue.reduce( ( sum, obs ) => !isNaN( obs.temp ) && ++cTemp ? sum + obs.temp : sum, 0) / cTemp,
			humidity: queue.reduce( ( sum, obs ) => !isNaN( obs.humidity ) && ++cHumidity ? sum + obs.humidity : sum, 0) / cHumidity,
			precip: queue.reduce( ( sum, obs ) => !isNaN( obs.precip ) && ++cPrecip ? sum + obs.precip : sum, 0),
			raining: ( ( moment().unix() - lastRainEpoch ) / 60 / 60 < 1 ),
		};

		if ( !( cTemp && cHumidity && cPrecip ) ) {
			console.error( "There is insufficient data to support Zimmerman calculation from local PWS." );
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		return result;
	};

	public async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {

		queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );

		if ( queue.length == 0 ) {
				console.error( "There is insufficient data to support ETo calculation from local PWS." );
				throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		let cSolar = 0, cWind = 0, cPrecip = 0;
		const result: EToData = {
			weatherProvider: "local",
			periodStartTime: Math.floor( queue[ queue.length - 1 ].timestamp ),
			minTemp: queue.reduce( (min, obs) => ( min > obs.temp ) ? obs.temp : min, Infinity ),
			maxTemp: queue.reduce( (max, obs) => ( max < obs.temp ) ? obs.temp : max, -Infinity ),
			minHumidity: queue.reduce( (min, obs) => ( min > obs.humidity ) ? obs.humidity : min, Infinity ),
			maxHumidity: queue.reduce( (max, obs) => ( max < obs.humidity ) ? obs.humidity : max, -Infinity ),
			solarRadiation: queue.reduce( (sum, obs) => !isNaN( obs.solarRadiation ) && ++cSolar ? sum + obs.solarRadiation : sum, 0) / cSolar,
			windSpeed: queue.reduce( (sum, obs) => !isNaN( obs.windSpeed ) && ++cWind ? sum + obs.windSpeed : sum, 0) / cWind,
			precip: queue.reduce( (sum, obs) => !isNaN( obs.precip ) && ++cPrecip ? sum + obs.precip : sum, 0 ),
		};

		if ( [ result.minTemp, result.minHumidity, -result.maxTemp, -result.maxHumidity ].includes( Infinity ) ||
			!( cSolar && cWind && cPrecip ) ) {
				console.error( "There is insufficient data to support ETo calculation from local PWS." );
				throw new CodedError( ErrorCode.InsufficientWeatherData );
			}

		return result;
	};
}

function saveQueue() {
	queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );
	try {
		fs.writeFileSync( "observations.json" , JSON.stringify( queue ), "utf8" );
	} catch ( err ) {
		console.error( "Error saving historical observations to local storage.", err );
	}
}

if ( process.env.WEATHER_PROVIDER === "local" && process.env.LOCAL_PERSISTENCE ) {
	if ( fs.existsSync( "observations.json" ) ) {
		try {
			queue = JSON.parse( fs.readFileSync( "observations.json", "utf8" ) );
			queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );
			console.log("Loaded historical local observations from storage.")
		} catch ( err ) {
			console.error( "Error reading historical observations from local storage.", err );
			queue = [];
		}
	}
	setInterval( saveQueue, 1000 * 60 * 30 );
}

interface Observation {
  timestamp: number;
  /** Temp in °F */
  temp: number;
  /** Percent relative humidity */
  humidity: number;
  /** Measured at 2m off the ground in mph */
  windSpeed: number;
  /**
   * `kW*hr/m^2 * interval/day`
   * These numebrs will be summed up over a 24hr period to give kW*hr/m^2/day which means
	 * that you need to divide by the rate at which you're sampling.
   */
  solarRadiation: number;
	/** How many inches of rain over the last interval. */
  precip: number;
}
