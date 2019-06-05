import { EToData, GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";
import * as moment from "moment-timezone";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";

async function getOWMWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	const OWM_API_KEY = process.env.OWM_API_KEY,
	  forecastUrl = "http://api.openweathermap.org/data/2.5/forecast?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

	// Perform the HTTP request to retrieve the weather data
	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Indicate watering data could not be retrieved if the forecast data is incomplete.
	if ( !forecast || !forecast.list ) {
		return undefined;
	}

	let totalTemp = 0,
	  totalHumidity = 0,
	  totalPrecip = 0;

	const periods = Math.min(forecast.list.length, 8);
	for ( let index = 0; index < periods; index++ ) {
		totalTemp += parseFloat( forecast.list[ index ].main.temp );
		totalHumidity += parseInt( forecast.list[ index ].main.humidity );
		totalPrecip += ( forecast.list[ index ].rain ? parseFloat( forecast.list[ index ].rain[ "3h" ] || 0 ) : 0 );
	}

	return {
		weatherProvider: "OWM",
		temp: totalTemp / periods,
		humidity: totalHumidity / periods,
		precip: totalPrecip / 25.4,
		raining: ( forecast.list[ 0 ].rain ? ( parseFloat( forecast.list[ 0 ].rain[ "3h" ] || 0 ) > 0 ) : false )
	};
}

async function getOWMWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
	const OWM_API_KEY = process.env.OWM_API_KEY,
	  currentUrl = "http://api.openweathermap.org/data/2.5/weather?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ],
	  forecastDailyUrl = "http://api.openweathermap.org/data/2.5/forecast/daily?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

	let current, forecast;
	try {
		current = await httpJSONRequest( currentUrl );
		forecast = await httpJSONRequest( forecastDailyUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Indicate watering data could not be retrieved if the forecast data is incomplete.
	if ( !current || !current.main || !current.wind || !current.weather || !forecast || !forecast.list ) {
		return undefined;
	}

	const weather: WeatherData = {
		weatherProvider: "OWM",
		temp:  parseInt( current.main.temp ),
		humidity: parseInt( current.main.humidity ),
		wind: parseInt( current.wind.speed ),
		description: current.weather[0].description,
		icon: current.weather[0].icon,

		region: forecast.city.country,
		city: forecast.city.name,
		minTemp: parseInt( forecast.list[ 0 ].temp.min ),
		maxTemp: parseInt( forecast.list[ 0 ].temp.max ),
		precip: ( forecast.list[ 0 ].rain ? parseFloat( forecast.list[ 0 ].rain || 0 ) : 0 ) / 25.4,
		forecast: []
	};

	for ( let index = 0; index < forecast.list.length; index++ ) {
		weather.forecast.push( {
			temp_min: parseInt( forecast.list[ index ].temp.min ),
			temp_max: parseInt( forecast.list[ index ].temp.max ),
			date: parseInt( forecast.list[ index ].dt ),
			icon: forecast.list[ index ].weather[ 0 ].icon,
			description: forecast.list[ index ].weather[ 0 ].description
		} );
	}

	return weather;
}

async function getOWMEToData( coordinates: GeoCoordinates ): Promise< EToData > {
	const OWM_API_KEY = process.env.OWM_API_KEY,
		forecastUrl = "http://api.openweathermap.org/data/2.5/forecast?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

	// Perform the HTTP request to retrieve the weather data
	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate ETo data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Indicate ETo data could not be retrieved if the forecast data is incomplete.
	if ( !forecast || !forecast.list || forecast.list.length < 8 ) {
		return undefined;
	}

	// Take a sample over 24 hours.
	const samples = forecast.list.slice( 0, 8 );

	const cloudCoverInfo: CloudCoverInfo[] = samples.map( ( window ): CloudCoverInfo => {
		return {
			startTime: moment.unix( window.dt ),
			endTime: moment.unix( window.dt ).add( 3, "hours" ),
			cloudCover: window.clouds.all / 100
		};
	} );

	return {
		weatherProvider: "OWM",
		minTemp: samples.reduce( ( min, window ) => Math.min( min, window.main.temp ), 1000),
		maxTemp: samples.reduce( ( max, window ) => Math.max( max, window.main.temp ), -1000),
		minHumidity: samples.reduce( ( min, window ) => Math.min( min, window.main.humidity ), 100),
		maxHumidity: samples.reduce( ( max, window ) => Math.max( max, window.main.humidity ), 0),
		solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
		// Assume wind speed measurements are taken at 2 meters.
		windSpeed: samples.reduce( ( sum, window ) => sum + window.wind.speed, 0) / samples.length,
		dayOfYear: moment().dayOfYear(),
		// OWM always returns precip in mm, so it must be converted.
		precip: samples.reduce( ( sum, window ) => sum + ( window.rain ? window.rain["3h"] || 0 : 0 ), 0) / 25.4
	};
}

const OWMWeatherProvider: WeatherProvider = {
	getWateringData: getOWMWateringData,
	getWeatherData: getOWMWeatherData,
	getEToData: getOWMEToData
};
export default OWMWeatherProvider;
