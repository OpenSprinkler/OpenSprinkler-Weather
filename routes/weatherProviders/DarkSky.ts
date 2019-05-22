import * as moment from "moment-timezone";

import { GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";

async function getDarkSkyWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	// The Unix timestamp of 24 hours ago.
	const yesterdayTimestamp: number = moment().subtract( 1, "day" ).unix();
	const todayTimestamp: number = moment().unix();

	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		yesterdayUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${yesterdayTimestamp}?exclude=currently,minutely,daily,alerts,flags`,
		todayUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${todayTimestamp}?exclude=currently,minutely,daily,alerts,flags`;

	let yesterdayData, todayData;
	try {
		yesterdayData = await httpJSONRequest( yesterdayUrl );
		todayData = await httpJSONRequest( todayUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	if ( !todayData.hourly || !todayData.hourly.data || !yesterdayData.hourly || !yesterdayData.hourly.data ) {
		return undefined;
	}

	// Fail if not enough data is available.
	if ( yesterdayData.hourly.data.length + todayData.hourly.data.length < 24 ) {
		return undefined;
	}

	const totals = { temp: 0, humidity: 0, precip: 0 };
	// The number of hourly forecasts from today's data that use historic data (not forecast data).
	// Find the first element that contains forecast data.
	const todayHistoricElements = todayData.hourly.data.findIndex( ( data ) => data.time > todayTimestamp - 60 * 60 );
	// Sum data from the current calendar day.
	const todayPeriods =  Math.min( 24, todayHistoricElements );
	for ( let index = todayPeriods - 1; index >= 0; index-- ) {
		totals.temp += todayData.hourly.data[ index ].temperature;
		totals.humidity += todayData.hourly.data[ index ].humidity;
		totals.precip += todayData.hourly.data[ index ].precipIntensity
	}

	// Sum data from yesterday.
	for ( let index = 24 - todayPeriods - 1; index >= 0; index-- ) {
		totals.temp += yesterdayData.hourly.data[ index ].temperature;
		totals.humidity += yesterdayData.hourly.data[ index ].humidity;
		totals.precip += yesterdayData.hourly.data[ index ].precipIntensity
	}

	return {
		temp : totals.temp / 24,
		humidity: totals.humidity / 24 * 100,
		precip: totals.precip,
		raining: todayData.hourly.data[ todayHistoricElements - 1 ].precipIntensity > 0
	};
}

async function getDarkSkyWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		forecastUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]}?exclude=minutely,alerts,flags`;

	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate weather data could not be retrieved if an API error occurs.
		return undefined;
	}

	if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
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
		minTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMin ),
		maxTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMax ),
		precip: forecast.daily.data[ 0 ].precipIntensity * 24,
		forecast: [ ]
	};

	for ( let index = 0; index < forecast.daily.data.length; index++ ) {
		weather.forecast.push( {
			temp_min: Math.floor( forecast.daily.data[ index ].temperatureMin ),
			temp_max: Math.floor( forecast.daily.data[ index ].temperatureMax ),
			date: forecast.daily.data[ index ].time,
			// TODO set this
			icon: "",
			description: forecast.daily.data[ index ].summary
		} );
	}

	return weather;
}


const DarkSkyWeatherProvider: WeatherProvider = {
	getWateringData: getDarkSkyWateringData,
	getWeatherData: getDarkSkyWeatherData
};
export default DarkSkyWeatherProvider;
