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

		if ( queue.length == 0 || queue[ 0 ].timestamp - queue[ queue.length - 1 ].timestamp < 23*60*60 ) {
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

if ( process.env.PWS && process.env.LOCAL_PERSISTENCE ) {
	if ( fs.existsSync( "observations.json" ) ) {
		try {
			queue = JSON.parse( fs.readFileSync( "observations.json", "utf8" ) );
			queue = queue.filter( obs => moment().unix() - obs.timestamp  < 24*60*60 );
		} catch ( err ) {
			console.error( "Error reading historical observations from local storage.", err );
			queue = [];
		}
	}
	setInterval( saveQueue, 1000 * 60 * 30 );
}

interface Observation {
	timestamp: number;
	temp: number;
	humidity: number;
	windSpeed: number;
	solarRadiation: number;
	precip: number;
}
