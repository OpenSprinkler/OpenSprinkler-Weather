import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import * as moment from "moment";
import { CodedError, ErrorCode } from "../../errors";

export default class OWMWeatherProvider extends WeatherProvider {

	private readonly API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.OWM_API_KEY;
		if (!this.API_KEY) {
			throw "OWM_API_KEY environment variable is not defined.";
		}
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData > {
		const forecastUrl = `http://api.openweathermap.org/data/2.5/forecast?appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		// Perform the HTTP request to retrieve the weather data
		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate watering data could not be retrieved if the forecast data is incomplete.
		if ( !forecast || !forecast.list ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		let totalTemp = 0,
			totalHumidity = 0,
			totalPrecip = 0;

		const periods = Math.min( forecast.list.length, 8 );
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

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
		const currentUrl = `http://api.openweathermap.org/data/2.5/weather?appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`,
			forecastDailyUrl = `http://api.openweathermap.org/data/2.5/forecast/daily?appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		let current, forecast;
		try {
			current = await httpJSONRequest( currentUrl );
			forecast = await httpJSONRequest( forecastDailyUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw "An error occurred while retrieving weather information from OWM."
		}

		// Indicate watering data could not be retrieved if the forecast data is incomplete.
		if ( !current || !current.main || !current.wind || !current.weather || !forecast || !forecast.list ) {
			throw "Necessary field(s) were missing from weather information returned by OWM.";
		}

		const weather: WeatherData = {
			weatherProvider: "OWM",
			temp: parseInt( current.main.temp ),
			humidity: parseInt( current.main.humidity ),
			wind: parseInt( current.wind.speed ),
			description: current.weather[ 0 ].description,
			icon: current.weather[ 0 ].icon,

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

	// Uses a rolling window since forecast data from further in the future (i.e. the next full day) would be less accurate.
	async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {
		const OWM_API_KEY = process.env.OWM_API_KEY,
			forecastUrl = "http://api.openweathermap.org/data/2.5/forecast?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

		// Perform the HTTP request to retrieve the weather data
		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch (err) {
			console.error( "Error retrieving ETo information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate ETo data could not be retrieved if the forecast data is incomplete.
		if ( !forecast || !forecast.list || forecast.list.length < 8 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
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

		let minTemp: number = undefined, maxTemp: number = undefined;
		let minHumidity: number = undefined, maxHumidity: number = undefined;
		// Skip hours where measurements don't exist to prevent result from being NaN.
		for ( const sample of samples ) {
			const temp: number = sample.main.temp;
			if ( temp !== undefined ) {
				// If minTemp or maxTemp is undefined, these comparisons will yield false.
				minTemp = minTemp < temp ? minTemp : temp;
				maxTemp = maxTemp > temp ? maxTemp : temp;
			}

			const humidity: number = sample.main.humidity;
			if ( humidity !== undefined ) {
				// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
				minHumidity = minHumidity < humidity ? minHumidity : humidity;
				maxHumidity = maxHumidity > humidity ? maxHumidity : humidity;
			}
		}

		return {
			weatherProvider: "OWM",
			periodStartTime: samples[ 0 ].dt,
			minTemp: minTemp,
			maxTemp: maxTemp,
			minHumidity: minHumidity,
			maxHumidity: maxHumidity,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: samples.reduce( ( sum, window ) => sum + ( window.wind.speed || 0 ), 0) / samples.length,
			// OWM always returns precip in mm, so it must be converted.
			precip: samples.reduce( ( sum, window ) => sum + ( window.rain ? window.rain[ "3h" ] || 0 : 0 ), 0) / 25.4
		};
	}
}
