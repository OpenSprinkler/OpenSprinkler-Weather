import { GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";

async function getDarkSkyWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		historicUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]}`;

	let historicData;
	try {
		historicData = await httpJSONRequest( historicUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}
if ( !historicData.currently || !historicData.hourly || !forecastData.hourly.data) {
    return undefined;
}
	const periods = Math.min( 24, historicData.hourly.data.length );
	const totals = { temp: 0, humidity: 0, precip: 0 };
	for ( let index = 0; index < periods; index++ ) {
		totals.temp += historicData.hourly.data[ index ].temperature;
		totals.humidity += historicData.hourly.data[ index ].humidity;
		totals.precip += historicData.hourly.data[ index ].precipIntensity
	}

	return {
		temp : totals.temp / periods,
		humidity: totals.humidity / periods * 100,
		precip: totals.precip,
		raining: historicData.hourly.data[0].precipIntensity > 0;
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
