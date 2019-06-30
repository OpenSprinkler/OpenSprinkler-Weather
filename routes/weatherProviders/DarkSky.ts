import * as moment from "moment-timezone";

import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";

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
		const todayTimestamp: number = moment().unix();

		const yesterdayUrl = `https://api.darksky.net/forecast/${ this.API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ yesterdayTimestamp }?exclude=currently,minutely,daily,alerts,flags`,
			todayUrl = `https://api.darksky.net/forecast/${ this.API_KEY }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ todayTimestamp }?exclude=currently,minutely,daily,alerts,flags`;

		let yesterdayData, todayData;
		try {
			[ yesterdayData, todayData ] = await Promise.all( [ httpJSONRequest( yesterdayUrl ), httpJSONRequest( todayUrl ) ] );
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
}
