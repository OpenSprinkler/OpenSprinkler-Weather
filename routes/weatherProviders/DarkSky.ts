import { GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";

async function getDarkSkyWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		forecastUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]}`;

	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}


	let totalTemp = 0,
		totalHumidity = 0,
		totalPrecip = 0;

	const periods = Math.min( forecast.hourly.data.length, 30 );
	for ( let index = 0; index < periods; index++ ) {
		totalTemp += forecast.hourly.data[ index ].temperature;
		totalHumidity += forecast.hourly.data[ index ].humidity * 100;
		totalPrecip += forecast.hourly.data[ index ].precipIntensity;
	}

	return {
		temp: totalTemp / periods,
		humidity: totalHumidity / periods,
		precip: totalPrecip,
		raining: forecast.currently.precipType === "rain"
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


const DarkSkyWeatherProvider: WeatherProvider = {
	getWateringData: getDarkSkyWateringData,
	getWeatherData: getDarkSkyWeatherData
};
export default DarkSkyWeatherProvider;
