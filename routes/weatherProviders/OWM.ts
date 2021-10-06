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

	public async getWateringData(coordinates: GeoCoordinates): Promise<ZimmermanWateringData> {
		// The OWM free API options changed so need to use the new API method
		const forecastUrl = `https://api.openweathermap.org/data/2.5/onecall?exclude=current,minutely,daily,alerts&appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		// Perform the HTTP request to retrieve the weather data
		let forecast;
		let hourlyForecast;
		try {
			hourlyForecast = await httpJSONRequest(forecastUrl);

			// The new API call only offers 48 hours of hourly forecast data which is fine because we only use 24 hours
			// just need to translate the data into blocks of 3 hours and then use as normal.
			// Could probably shortcut this if you knew the following calculations better but less chance of screwing 
			// up the calculation just by bundling the hourly data into 3 hour blocks so I went that route
			if (hourlyForecast && hourlyForecast.hourly) {
				forecast = this.get3hForecast(hourlyForecast.hourly, 24);
			}

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

	public async getWeatherData(coordinates: GeoCoordinates): Promise<WeatherData> {
		// The OWM free API options changed so need to use the new API method
		const currentUrl = `https://api.openweathermap.org/data/2.5/weather?appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`,
			forecastDailyUrl = `https://api.openweathermap.org/data/2.5/onecall?exclude=current,minutely,hourly,alerts&appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		let current, forecast;
		try {
			forecast = await httpJSONRequest(forecastDailyUrl);
			current = await httpJSONRequest(currentUrl);
			if (forecast) {
				forecast.list = forecast.daily;
				forecast.city = { name: current.name, region: current.sys.country };
			}
		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw "An error occurred while retrieving weather information from OWM."
		}

		// Indicate watering data could not be retrieved if the forecast data is incomplete.
		if (!current || !current.main || !current.wind || !current.weather || !forecast || !forecast.list) {
			throw "Necessary field(s) were missing from weather information returned by OWM.";
		}

		const weather: WeatherData = {
			weatherProvider: "OWM",
			temp: parseInt(current.main.temp),
			humidity: parseInt(current.main.humidity),
			wind: parseInt(current.wind.speed),
			description: current.weather[0].description,
			icon: current.weather[0].icon,

			region: forecast.city.country,
			city: forecast.city.name,
			minTemp: parseInt(forecast.list[0].temp.min),
			maxTemp: parseInt(forecast.list[0].temp.max),
			precip: (forecast.list[0].rain ? parseFloat(forecast.list[0].rain || 0) : 0) / 25.4,
			forecast: []
		};

		for (let index = 0; index < forecast.list.length; index++) {
			weather.forecast.push({
				temp_min: parseInt(forecast.list[index].temp.min),
				temp_max: parseInt(forecast.list[index].temp.max),
				date: parseInt(forecast.list[index].dt),
				icon: forecast.list[index].weather[0].icon,
				description: forecast.list[index].weather[0].description
			});
		}

		return weather;
	}

	// Uses a rolling window since forecast data from further in the future (i.e. the next full day) would be less accurate.
	async getEToData(coordinates: GeoCoordinates): Promise<EToData> {
		// The OWM API changed what you get on the free subscription so need to adjust the call and translate the data.
		const OWM_API_KEY = process.env.OWM_API_KEY,
			forecastUrl = `https://api.openweathermap.org/data/2.5/onecall?exclude=current,minutely,daily,alerts&appid=${ this.API_KEY }&units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		// Perform the HTTP request to retrieve the weather data
		let forecast;
		let hourlyForecast;
		try {
			hourlyForecast = await httpJSONRequest(forecastUrl);

			// The new API call only offers 48 hours of hourly forecast data which is fine because we only use 24 hours
			// just need to translate the data into blocks of 3 hours and then use as normal.
			// Could probably shortcut this if you knew the following calculations better but less chance of screwing 
			// up the calculation just by bundling the hourly data into 3 hour blocks so I went that route
			if (hourlyForecast && hourlyForecast.hourly) {
				forecast = this.get3hForecast(hourlyForecast.hourly, 24);
			}
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

	// Expects an array of at least 3 hours of forecast data from the API's onecall method
	// Returns the equivilent of the 3 hour object from the previous call from the 5 day forecast API call
	public getPeriod3hObject(hourly: any[]) {

		// Should probably define this in a class somewhere but it isn't done with the existing API calls so not bothering
		let period3h = {
			dt: 0,
			main: {
				temp: 0.0,
				feels_like: 0.0,
				temp_min: 0.0,
				temp_max: 0.0,
				pressure: 0,
				sea_level: 0,
				grnd_level: 0,
				humidity: 0,
				temp_kf: 0.0
			},
			weather: [
				{
					id: 0,
					main: "",
					description: "",
					icon: ""
				}
			],
			clouds: {
				all: 0
			},
			wind: {
				speed: 0.0,
				deg: 0,
				gust: 0.0
			},
			visibility: 0,
			pop: 0.0,
			rain: {
				"3h": 0.0
			},
			sys: {
				pod: ""
			},
			dt_txt: ""
		};

		if (hourly && hourly.length > 2 && hourly[2].dt) {

			// Could add some more data here if needed, I decided to just minimize the translation work
			// Also some of the fields aren't availible in the new call so not worth trying to do a full translation
			for (let index = 0; index < 3; index++) {
				let hour = hourly[index];
				
				period3h.main.temp += hour.temp;
				period3h.main.temp_min = period3h.main.temp_min > hour.temp || index == 0 ? hour.temp : period3h.main.temp_min;
				period3h.main.temp_max = period3h.main.temp_max < hour.temp || index == 0 ? hour.temp : period3h.main.temp_max;
				period3h.main.humidity += hour.humidity;
				period3h.wind.speed += hour.wind_speed;
				period3h.rain["3h"] += hour.rain == null ? 0.0 : hour.rain["1h"];
				period3h.clouds.all += hour.clouds;
			}

			// Some of the decisions could be questionable but I decided to go with the numbers that would err on the side of more
			// rather than less
			period3h.main.temp = Math.ceil(period3h.main.temp / 3);
			period3h.main.humidity = Math.floor(period3h.main.humidity / 3);
			period3h.wind.speed = Math.ceil(period3h.wind.speed / 3);
			period3h.clouds.all = Math.floor(period3h.clouds.all / 3);

			period3h.dt = hourly[0].dt;
		}
	}

	// Expects an array of hourly forecast data from the API's onecall method
	// Returns a minimally equivilent object to the previous 5 day forecast API call
	public get3hForecast(hourly: any[], hours: number = 24) {

		let results = { list: [] };

		if (!hourly || hourly.length < 3) {
			return null;
		}

		for (let index = 0; index < hours; index++) {
			let hour = hourly[index];

			if (index % 3 == 0) {
				results.list.push(this.getPeriod3hObject(hourly.slice(index)));
			}
		}

		return results;
	}
}
