import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";

import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { httpJSONRequest, keyToUse } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class PirateWeatherWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.PIRATEWEATHER_API_KEY;
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp = moment().startOf("day").subtract( 1, "day" ).unix();

		const localKey = keyToUse(this.API_KEY, pws);

		const yesterdayUrl = `https://api.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ yesterdayTimestamp }?units=us&exclude=currently,minutely,alerts`;

		let historicData;
		try {
			historicData = await httpJSONRequest( yesterdayUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from PirateWeather:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData.hourly || !historicData.hourly.data ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		let samples = [
			...historicData.hourly.data
		];

		// Fail if not enough data is available.
		if ( samples.length < 24 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		//returns 48 hours (first 24 are historical so only loop those)
		samples = samples.slice(0,24);

		const cloudCoverInfo: CloudCoverInfo[] = samples.map( ( hour ): CloudCoverInfo => {
			return {
				startTime: moment.unix( hour.time ),
				endTime: moment.unix( hour.time ).add( 1, "hours" ),
				cloudCover: hour.cloudCover
			};
		} );

		let temp: number = 0, humidity: number = 0, precip: number = 0,
			minHumidity: number = undefined, maxHumidity: number = undefined;
		for ( const hour of samples ) {
			/*
			 * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
			 * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
			 * calculated when data is missing from some samples (since they follow diurnal cycles and will be
			 * significantly skewed if data is missing for several consecutive hours).
			 */
			temp += hour.temperature;
			humidity += hour.humidity;
			// This field may be missing from the response if it is snowing.
			precip += hour.precipAccumulation || 0;

			// Skip hours where humidity measurement does not exist to prevent ETo result from being NaN.
			if ( hour.humidity !== undefined ) {
				minHumidity = minHumidity < hour.humidity ? minHumidity : hour.humidity;
				maxHumidity = maxHumidity > hour.humidity ? maxHumidity : hour.humidity;
			}
		}

		return [{
			weatherProvider: "PW",
			temp: temp / samples.length,
			humidity: humidity / samples.length * 100,
			precip: precip,
			raining: samples[ samples.length - 1 ].precipIntensity > 0,
			periodStartTime: historicData.hourly.data[ 0 ].time,
			minTemp: historicData.daily.data[ 0 ].temperatureMin,
			maxTemp: historicData.daily.data[ 0 ].temperatureMax,
			minHumidity: minHumidity * 100,
			maxHumidity: maxHumidity * 100,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: historicData.daily.data[ 0 ].windSpeed
		}];
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {

		const localKey = keyToUse( this.API_KEY, pws);

		const forecastUrl = `https://api.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] }?units=us&exclude=minutely,hourly,alerts`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from PirateWeather:", err );
			throw "An error occurred while retrieving weather information from PirateWeather."
		}

		if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
			throw "Necessary field(s) were missing from weather information returned by PirateWeather.";
		}

		const weather: WeatherData = {
			weatherProvider: "PirateWeather",
			temp: Math.floor( forecast.currently.temperature ),
			humidity: Math.floor( forecast.currently.humidity * 100 ),
			wind: Math.floor( forecast.currently.windSpeed ),
			raining: forecast.currently.precipIntensity > 0,
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
				precip: forecast.daily.data[ index ].precipIntensity * 24,
				date: forecast.daily.data[ index ].time,
				icon: this.getOWMIconCode( forecast.daily.data[ index ].icon ),
				description: forecast.daily.data[ index ].summary
			} );
		}

		return weather;
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
