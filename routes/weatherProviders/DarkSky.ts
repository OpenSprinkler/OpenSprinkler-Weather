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
		weatherProvider: "DarkSky",
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
		weatherProvider: "DarkSky",
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

async function getDarkSkyEToData( coordinates: GeoCoordinates ): Promise< EToData > {
	// TODO use a rolling 24 hour window instead of fixed calendar days?
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

	// Approximate solar radiation using a formula from http://www.shodor.org/os411/courses/_master/tools/calculators/solarrad/
	const solarRadiation = historicData.hourly.data.reduce( ( total, hour ) => {
		const currPosition = SunCalc.getPosition( new Date( hour.time * 1000 ), coordinates[ 0 ], coordinates[ 1 ] );
		// The Sun's position 1 hour ago.
		const lastPosition = SunCalc.getPosition( new Date( hour.time * 1000 - 60 * 60 * 1000 ), coordinates[ 0 ], coordinates[ 1 ] );
		const solarElevationAngle = ( currPosition.altitude + lastPosition.altitude ) / 2;

		// Calculate radiation and convert from watts to megajoules.
		const clearSkyIsolation = ( 990 * Math.sin( solarElevationAngle ) - 30 ) * 0.0036;

		// TODO include the radiation from hours where the sun is partially above the horizon.
		// Skip hours where the sun was below the horizon.
		if ( clearSkyIsolation <= 0 ) {
			return total;
		}

		return total + clearSkyIsolation * ( 1 - 0.75 * Math.pow( hour.cloudCover, 3.4 ) );
	}, 0 );

	return {
		minTemp: historicData.daily.data[ 0 ].temperatureMin,
		maxTemp: historicData.daily.data[ 0 ].temperatureMax,
		minHumidity: historicData.hourly.data.reduce( ( min, hour ) => Math.min( min, hour.humidity ), 1) * 100,
		maxHumidity: historicData.hourly.data.reduce( ( max, hour ) => Math.max( max, hour.humidity ), 0) * 100,
		solarRadiation: solarRadiation,
		windSpeed: historicData.daily.data[ 0 ].windSpeed,
		// TODO find out what height wind speed measurements are actually taken at.
		windSpeedMeasurementHeight: 2,
		dayOfYear: moment().subtract( 1, "day" ).dayOfYear(),
		lat: coordinates[ 0 ],
		precip: historicData.daily.data[ 0 ].precipIntensity * 24
	};
}


const DarkSkyWeatherProvider: WeatherProvider = {
	getWateringData: getDarkSkyWateringData,
	getWeatherData: getDarkSkyWeatherData,
	getEToData: getDarkSkyEToData
};
export default DarkSkyWeatherProvider;
