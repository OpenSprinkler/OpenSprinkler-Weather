import * as moment from "moment-timezone";

import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class DarkSkyWeatherProvider extends WeatherProvider {

	private readonly API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.DARKSKY_API_KEY;
		if (!this.API_KEY) {
			throw "DARKSKY_API_KEY environment variable is not defined.";
		}
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData > {
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp: number = moment().subtract( 1, "day" ).unix();

		const yesterdayUrl = `https://api.darksky.net/forecast/${ this.API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ yesterdayTimestamp }?exclude=currently,minutely,daily,alerts,flags`;

		let yesterdayData;
		try {
			yesterdayData = await httpJSONRequest( yesterdayUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Dark Sky:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !yesterdayData.hourly || !yesterdayData.hourly.data ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const samples = [
			...yesterdayData.hourly.data
		];

		// Fail if not enough data is available.
		if ( samples.length !== 24 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const totals = { temp: 0, humidity: 0, precip: 0 };
		for ( const sample of samples ) {
			/*
			 * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
			 * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
			 * calculated when data is missing from some samples (since they follow diurnal cycles and will be
			 * significantly skewed if data is missing for several consecutive hours).
			 */
			totals.temp += sample.temperature;
			totals.humidity += sample.humidity;
			// This field may be missing from the response if it is snowing.
			totals.precip += sample.precipIntensity || 0;
		}

		return {
			weatherProvider: "DarkSky",
			temp: totals.temp / 24,
			humidity: totals.humidity / 24 * 100,
			precip: totals.precip,
			raining: samples[ samples.length - 1 ].precipIntensity > 0
		};
	}

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
		const forecastUrl = `https://api.darksky.net/forecast/${ this.API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] }?exclude=minutely,alerts,flags`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Dark Sky:", err );
			throw "An error occurred while retrieving weather information from Dark Sky."
		}

		if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
			throw "Necessary field(s) were missing from weather information returned by Dark Sky.";
		}

		const weather: WeatherData = {
			weatherProvider: "DarkSky",
			temp: Math.floor( forecast.currently.temperature ),
			humidity: Math.floor( forecast.currently.humidity * 100 ),
			wind: Math.floor( forecast.currently.windSpeed ),
			description: forecast.currently.summary,
			icon: this.getOWMIconCode( forecast.currently.icon ),

			region: "",
			city: "",
			minTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMin ),
			maxTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMax ),
			precip: forecast.daily.data[ 0 ].precipIntensity * 24,
			forecast: []
		};

		for ( let index = 0; index < forecast.daily.data.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( forecast.daily.data[ index ].temperatureMin ),
				temp_max: Math.floor( forecast.daily.data[ index ].temperatureMax ),
				date: forecast.daily.data[ index ].time,
				icon: this.getOWMIconCode( forecast.daily.data[ index ].icon ),
				description: forecast.daily.data[ index ].summary
			} );
		}

		return weather;
	}

	public async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {
		// The Unix epoch seconds timestamp of 24 hours ago.
		const timestamp: number = moment().subtract( 1, "day" ).unix();

		const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
			historicUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${timestamp}`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch (err) {
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const cloudCoverInfo: CloudCoverInfo[] = historicData.hourly.data.map( ( hour ): CloudCoverInfo => {
			return {
				startTime: moment.unix( hour.time ),
				endTime: moment.unix( hour.time ).add( 1, "hours" ),
				cloudCover: hour.cloudCover
			};
		} );

		let minHumidity: number = undefined, maxHumidity: number = undefined;
		for ( const hour of historicData.hourly.data ) {
			// Skip hours where humidity measurement does not exist to prevent result from being NaN.
			if ( hour.humidity === undefined ) {
				continue;
			}

			// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
			minHumidity = minHumidity < hour.humidity ? minHumidity : hour.humidity;
			maxHumidity = maxHumidity > hour.humidity ? maxHumidity : hour.humidity;
		}

		return {
			weatherProvider: "DarkSky",
			periodStartTime: historicData.hourly.data[ 0 ].time,
			minTemp: historicData.daily.data[ 0 ].temperatureMin,
			maxTemp: historicData.daily.data[ 0 ].temperatureMax,
			minHumidity: minHumidity * 100,
			maxHumidity: maxHumidity * 100,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: historicData.daily.data[ 0 ].windSpeed,
			precip: ( historicData.daily.data[ 0 ].precipIntensity || 0 ) * 24
		};
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

	private getOWMIconCode(icon: string) {
		switch(icon) {
			case "partly-cloudy-night":
				return "02n";
			case "partly-cloudy-day":
				return "02d";
			case "cloudy":
				return "03d";
			case "fog":
			case "wind":
				return "50d";
			case "sleet":
			case "snow":
				return "13d";
			case "rain":
				return "10d";
			case "clear-night":
				return "01n";
			case "clear-day":
			default:
				return "01d";
		}
	}
}
