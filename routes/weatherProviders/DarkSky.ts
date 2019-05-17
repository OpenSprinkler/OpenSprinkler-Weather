import * as moment from "moment-timezone";

import {EToData, GeoCoordinates, WateringData, WeatherData, WeatherProvider} from "../../types";
import { httpJSONRequest } from "../weather";
import * as SunCalc from "suncalc";

async function getDarkSkyWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	// The Unix epoch seconds timestamp of 24 hours ago.
	const timestamp: number = moment().subtract( 1, "day" ).unix();

	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		historicUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${timestamp}`;

	let historicData;
	try {
		historicData = await httpJSONRequest( historicUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	return {
		// Calculate average temperature for the day using hourly data.
		temp : historicData.hourly.data.reduce( ( sum, hourlyData ) => sum + hourlyData.temperature, 0 ) / historicData.hourly.data.length,
		humidity: historicData.daily.data[ 0 ].humidity * 100,
		precip: historicData.daily.data[ 0 ].precipIntensity * 24,
		raining: historicData.currently.precipType === "rain"
	};
}

async function getDarkSkyWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		forecastUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]}`;

	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	const weather: WeatherData = {
		temp: Math.floor( forecast.currently.temperature ),
		humidity: Math.floor( forecast.currently.humidity * 100 ),
		wind: Math.floor( forecast.currently.windSpeed ),
		description: forecast.currently.summary,
		// TODO set this
		icon: "",

		region: "",
		city: "",
		minTemp: Math.floor( forecast.daily.data[ 0 ].temperatureLow ),
		maxTemp: Math.floor( forecast.daily.data[ 0 ].temperatureHigh ),
		precip: forecast.daily.data[ 0 ].precipIntensity * 24,
		forecast: []
	};

	for ( let index = 0; index < forecast.daily.data.length; index++ ) {
		weather.forecast.push( {
			temp_min: Math.floor( forecast.daily.data[ index ].temperatureLow ),
			temp_max: Math.floor( forecast.daily.data[ index ].temperatureHigh ),
			date: forecast.daily.data[ index ].time,
			// TODO set this
			icon: "",
			description: forecast.daily.data[ index ].summary
		} );
	}

	return weather;
}

async function getDarkSkyEToData( coordinates: GeoCoordinates, elevation: number ): Promise< EToData > {
	// The Unix epoch seconds timestamp of 24 hours ago.
	const timestamp: number = moment().subtract( 1, "day" ).unix();

	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		historicUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${timestamp}?units=si`;

	let historicData;
	try {
		historicData = await httpJSONRequest( historicUrl );
	} catch (err) {
		// Indicate ETO data could not be retrieved if an API error occurs.
		return undefined;
	}

	const sunData = SunCalc.getTimes( new Date(timestamp * 1000), coordinates[ 0 ], coordinates[ 1 ] );
	// The Unix epoch seconds timestamp of sunrise.
	const sunriseTimestamp = sunData.sunrise.valueOf() / 1000;
	// The Unix epoch seconds timestamp of sunset.
	const sunsetTimestamp = sunData.sunset.valueOf() / 1000;
	const sunshineHours = historicData.hourly.data.reduce( ( total, hour ) => {
		// Calculate how much of this hour was during the daytime.
		const daytimeFraction = Math.min( Math.max(
			// Subtract the time between the start of the forecast hour and sunrise.
			1 - Math.min( Math.max( 60 * 60 / ( sunriseTimestamp -  hour.time ), 0 ), 1 )
			// Subtract the time between sunset and the end of the forecast hour.
			- Math.min( Math.max( 60 * 60 / ( hour.time + 60 * 60 - sunsetTimestamp ), 0 ), 1 )
		, 0), 1 );

		// Multiply the daytime fraction of the hour and the fraction of sunshine that wasn't blocked by clouds.
		return total + daytimeFraction * ( 1 - hour.cloudCover );
	}, 0);

	return {
		minTemp: historicData.daily.data[ 0 ].temperatureMin,
		maxTemp: historicData.daily.data[ 0 ].temperatureMax,
		minHumidity: historicData.hourly.data.reduce( ( min, hour ) => Math.min( min, hour.humidity ), 1) * 100,
		maxHumidity: historicData.hourly.data.reduce( ( max, hour ) => Math.max( max, hour.humidity ), 0) * 100,
		sunshineHours: sunshineHours,
		windSpeed: historicData.daily.data[ 0 ].windSpeed,
		// TODO find out what height wind speed measurements are actually taken at.
		windSpeedMeasurementHeight: 2,
		elevation: elevation,
		dayOfYear: moment().subtract( 1, "day" ).dayOfYear(),
		lat: coordinates[0]
	};
}


const DarkSkyWeatherProvider: WeatherProvider = {
	getWateringData: getDarkSkyWateringData,
	getWeatherData: getDarkSkyWeatherData,
	getEToData: getDarkSkyEToData
};
export default DarkSkyWeatherProvider;
