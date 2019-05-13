import { GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";

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

const OWMWeatherProvider: WeatherProvider = {
	getWateringData: getOWMWateringData,
	getWeatherData: getOWMWeatherData
};
export default OWMWeatherProvider;
