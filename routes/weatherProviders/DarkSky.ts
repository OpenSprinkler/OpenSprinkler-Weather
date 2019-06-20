import * as moment from "moment-timezone";

import { GeoCoordinates, WateringData, WeatherData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";

export default class DarkSkyWeatherProvider extends WeatherProvider {

	public async getWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp: number = moment().subtract( 1, "day" ).unix();
		const todayTimestamp: number = moment().unix();

		const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
			yesterdayUrl = `https://api.darksky.net/forecast/${ DARKSKY_API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ yesterdayTimestamp }?exclude=currently,minutely,daily,alerts,flags`,
			todayUrl = `https://api.darksky.net/forecast/${ DARKSKY_API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ todayTimestamp }?exclude=currently,minutely,daily,alerts,flags`;

		let yesterdayData, todayData;
		try {
			yesterdayData = await httpJSONRequest( yesterdayUrl );
			todayData = await httpJSONRequest( todayUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Dark Sky:", err );
			throw "An error occurred while retrieving weather information from Dark Sky."
		}

		if ( !todayData.hourly || !todayData.hourly.data || !yesterdayData.hourly || !yesterdayData.hourly.data ) {
			throw "Necessary field(s) were missing from weather information returned by Dark Sky.";
		}

		/* The number of hourly forecasts to use from today's data. This will only include elements that contain historic
			data (not forecast data). */
		// Find the first element that contains forecast data.
		const todayElements = Math.min( 24, todayData.hourly.data.findIndex( ( data ) => data.time > todayTimestamp - 60 * 60 ) );

		/* Take as much data as possible from the first elements of today's data and take the remaining required data from
			the remaining data from the last elements of yesterday's data. */
		const samples = [
			...yesterdayData.hourly.data.slice( todayElements - 24 ),
			...todayData.hourly.data.slice( 0, todayElements )
		];

		// Fail if not enough data is available.
		if ( samples.length !== 24 ) {
			throw "Insufficient data was returned by Dark Sky.";
		}

		const totals = { temp: 0, humidity: 0, precip: 0 };
		for ( const sample of samples ) {
			totals.temp += sample.temperature;
			totals.humidity += sample.humidity;
			totals.precip += sample.precipIntensity
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
		const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
			forecastUrl = `https://api.darksky.net/forecast/${ DARKSKY_API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] }?exclude=minutely,alerts,flags`;

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
			// TODO set this
			icon: "",

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
				// TODO set this
				icon: "",
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
			throw "An error occurred while retrieving weather information from Dark Sky."
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
}
