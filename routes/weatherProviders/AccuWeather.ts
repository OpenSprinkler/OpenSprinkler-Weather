import * as moment from "moment-timezone";

import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { httpJSONRequest, keyToUse } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class AccuWeatherWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.ACCUWEATHER_API_KEY;
	}

	public async getWateringData( coordinates: GeoCoordinates, pws?: PWS ): Promise< WateringData[] > {

		const localKey = keyToUse(this.API_KEY, pws);

		const locationUrl = `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${ localKey }&q=${ coordinates[ 0 ] },${ coordinates[ 1 ] }`;

		let locationData;
		try {
			locationData = await httpJSONRequest( locationUrl );
		} catch ( err ) {
			console.error( "Error retrieving location information from AccuWeather:", err );
		}

		const historicUrl = `http://dataservice.accuweather.com/currentconditions/v1/${ locationData.Key }/historical/24?apikey=${ localKey }&details=true`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from AccuWeather:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		let dataLen = historicData.length;
		if ( typeof dataLen !== "number" ) {
			throw "Necessary field(s) were missing from weather information returned by AccuWeather.";
		}
		if ( dataLen < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const cloudCoverInfo: CloudCoverInfo[] = historicData.map( ( hour ): CloudCoverInfo => {
			//return empty interval if measurement does not exist
			if(hour.CloudCover === undefined ){
				return {
					startTime: moment.unix( hour.EpochTime ),
					endTime: moment.unix( hour.EpochTime ),
					cloudCover: 0
				}
			}
			return {
				startTime: moment.unix( hour.EpochTime ),
				endTime: moment.unix( hour.EpochTime ).add( 1, "hours" ),
				cloudCover: hour.CloudCover / 100
			};
		} );

		let temp: number = 0, humidity: number = 0,
			minHumidity: number = undefined, maxHumidity: number = undefined, avgWindSpeed: number = 0;
		for ( const hour of historicData ) {
			/*
			 * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
			 * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
			 * calculated when data is missing from some samples (since they follow diurnal cycles and will be
			 * significantly skewed if data is missing for several consecutive hours).
			 */
			temp += hour.Temperature.Imperial.Value;
			humidity += hour.RelativeHumidity;

			// Skip hours where humidity measurement does not exist to prevent ETo result from being NaN.
			if ( hour.RelativeHumidity !== undefined ) {
				// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
				minHumidity = minHumidity < hour.RelativeHumidity ? minHumidity : hour.RelativeHumidity;
				maxHumidity = maxHumidity > hour.RelativeHumidity ? maxHumidity : hour.RelativeHumidity;
			}

			avgWindSpeed += hour.Wind.Speed.Imperial.Value || 0;
		}

		// Accuweather returns data in reverse chronological order by hour
		return [{
			weatherProvider: "AW",
			temp: temp / dataLen,
			humidity: humidity / dataLen,
			precip: historicData[0].PrecipitationSummary.Past24Hours.Imperial.Value,
			raining: historicData[0].Precip1hr.Imperial.Value > 0,
			periodStartTime: historicData[dataLen - 1].EpochTime,
			minTemp: historicData[0].TemperatureSummary.Past24HourRange.Minimum.Imperial.Value,
			maxTemp: historicData[0].TemperatureSummary.Past24HourRange.Maximum.Imperial.Value,
			minHumidity: minHumidity,
			maxHumidity: maxHumidity,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: avgWindSpeed
		}];
	}

	public async getWeatherData( coordinates: GeoCoordinates, pws?: PWS ): Promise< WeatherData > {

		const localKey = keyToUse(this.API_KEY, pws);

		const locationUrl = `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${ localKey }&q=${ coordinates[ 0 ] },${ coordinates[ 1 ] }`;

		let locationData;
		try {
			locationData = await httpJSONRequest( locationUrl );
		} catch ( err ) {
			console.error( "Error retrieving location information from AccuWeather:", err );
		}

		const currentUrl = `https://dataservice.accuweather.com/currentconditions/v1/${ locationData.Key }?apikey=${ localKey }&details=true`;
		const forecastUrl = `https://dataservice.accuweather.com/forecasts/v1/daily/5day/${ locationData.Key }?apikey=${ localKey }&details=true`;

		let currentData, forecast;
		try {
			currentData = await httpJSONRequest( currentUrl );
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from AccuWeawther:", err );
			throw "An error occurred while retrieving weather information from AccuWeather."
		}

		let current = currentData[0];
		let daily = forecast.DailyForecasts;
		if ( !current || !daily || daily.length < 5) {
			throw "Necessary field(s) were missing from weather information returned by AccuWeather.";
		}

		const weather: WeatherData = {
			weatherProvider: "AccuWeather",
			temp: Math.floor( current.Temperature.Imperial.Value ),
			humidity: Math.floor( current.RelativeHumidity ),
			wind: Math.floor( current.Wind.Speed.Imperial.Value ),
			raining: current.Precip1hr.Imperial.Value > 0,
			description: current.WeatherText,
			icon: this.getOWMIconCode( current.WeatherIcon ),

			region: locationData.Region.EnglishName,
			city: locationData.EnglishName,
			minTemp: Math.floor( daily[ 0 ].Temperature.Minimum.Value ),
			maxTemp: Math.floor( daily[ 0 ].Temperature.Maximum.Value ),
			precip: daily[ 0 ].Day.PrecipitationIntensity,
			forecast: []
		};

		for ( let index = 0; index < daily.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( daily[ index ].Temperature.Minimum.Value ),
				temp_max: Math.floor( daily[ index ].Temperature.Maximum.Value ),
				date: daily[ index ].EpochDate,
				icon: this.getOWMIconCode( daily[ index ].Day.Icon ),
				description: daily[ index ].Day.ShortPhrase
			} );
		}

		return weather;
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

// See https://developer.accuweather.com/weather-icons
	private getOWMIconCode(code: number) {
		const mapping = [ "01d", // code = 0
		"01d", // 1: sunny
		"02d",
		"03d",
		"04d",
		"02d", // 5: hazy sunshine
		"03d", // 6: mostly cloudy
		"03d", // 7: cloudy
		"03d", // 8: overcast
		"03d", // 9: undefined
		"03d", // 10: undefined
		"50d", // 11: fog
		"09d", // 12: shower
		"09d", // 13: mostly cloudy w/ shower
		"09d", // 14: partly sunny w/ shower
		"11d", // 15: thunderstorm
		"11d", // 16: mostly cloudy w/ t-storm
		"11d", // 17: partly summy w/ t-storm
		"10d", // 18: rain
		"13d", // 19: flurries
		"13d", // 20
		"13d", // 21
		"13d", // 22: snow
		"13d", // 23:
		"13d", // 24
		"13d", // 25
		"13d", // 26
		"13d", // 27
		"13d", // 28
		"13d", // 29
		"01d", // 30: hot
		"01d", // 31: cold
		"01d", // 32: windy
		"01n", // 33: clear (night)
		"02n", // 34
		"03n", // 35
		"04n", // 36
		"02n", // 37: hazy (night)
		"03n", // 38: mostly cloud (night)
		"09n", // 39: shower (night)
		"09n", // 40: shower (night)
		"11n", // 41: t-storm (night)
		"11n", // 42: t-storm (night)
		"13n", // 43: flurries (night)
		"13n", // 44: snow (night)
		];
		return (code>0 && code<45) ? mapping[code] : "01d";
	}
}
