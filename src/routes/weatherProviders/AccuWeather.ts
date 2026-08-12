import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { getTZ, httpJSONRequest, keyToUse } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addHours, fromUnixTime } from "date-fns";
import { tz } from "@date-fns/tz";
import { averageFinite, maxFinite, minFinite } from "./providerUtils";

export default class AccuWeatherWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.ACCUWEATHER_API_KEY;
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		const localKey = keyToUse(this.API_KEY, pws);

		const locationUrl = `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${ localKey }&q=${ coordinates[ 0 ] },${ coordinates[ 1 ] }`;

		let locationData;
		try {
			locationData = await httpJSONRequest( locationUrl );
		} catch ( err ) {
			console.error( "Error retrieving location information from AccuWeather:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if (!locationData?.Key) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const historicUrl = `https://dataservice.accuweather.com/currentconditions/v1/${ locationData.Key }/historical/24?apikey=${ localKey }&details=true`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from AccuWeather:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		let dataLen = historicData.length;
		if ( typeof dataLen !== "number" ) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}
		if ( dataLen < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const cloudCoverInfo: CloudCoverInfo[] = historicData.map( ( hour ): CloudCoverInfo => {
			//return empty interval if measurement does not exist
            const time = fromUnixTime( hour.EpochTime, {in: tz(getTZ(coordinates))} );
			if(hour.CloudCover === undefined ){
				return {
					startTime: time,
					endTime: time,
					cloudCover: 0
				}
			}
			return {
				startTime: time,
				endTime: addHours(time, 1),
				cloudCover: hour.CloudCover / 100
			};
		} );

		const temp = averageFinite(historicData.map(hour => hour.Temperature?.Imperial?.Value));
		const humidity = averageFinite(historicData.map(hour => hour.RelativeHumidity));
		const minHumidity = minFinite(historicData.map(hour => hour.RelativeHumidity));
		const maxHumidity = maxFinite(historicData.map(hour => hour.RelativeHumidity));
		const avgWindSpeed = averageFinite(historicData.map(hour => hour.Wind?.Speed?.Imperial?.Value));
		if ([temp, humidity, minHumidity, maxHumidity, avgWindSpeed].some(value => !Number.isFinite(value))) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		// Accuweather returns data in reverse chronological order by hour
		return [{
			weatherProvider: "AW",
			temp,
			humidity,
			precip: historicData[0].PrecipitationSummary.Past24Hours.Imperial.Value,
			periodStartTime: historicData[dataLen - 1].EpochTime,
			minTemp: historicData[0].TemperatureSummary.Past24HourRange.Minimum.Imperial.Value,
			maxTemp: historicData[0].TemperatureSummary.Past24HourRange.Maximum.Imperial.Value,
			minHumidity: minHumidity,
			maxHumidity: maxHumidity,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// AccuWeather does not document the measurement height for this field.
			windSpeed: avgWindSpeed
		}];
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		const localKey = keyToUse(this.API_KEY, pws);

		const locationUrl = `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${ localKey }&q=${ coordinates[ 0 ] },${ coordinates[ 1 ] }`;

		let locationData;
		try {
			locationData = await httpJSONRequest( locationUrl );
		} catch ( err ) {
			console.error( "Error retrieving location information from AccuWeather:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}
		if (!locationData?.Key) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const currentUrl = `https://dataservice.accuweather.com/currentconditions/v1/${ locationData.Key }?apikey=${ localKey }&details=true`;
		const forecastUrl = `https://dataservice.accuweather.com/forecasts/v1/daily/5day/${ locationData.Key }?apikey=${ localKey }&details=true`;

		let currentData, forecast;
		try {
			currentData = await httpJSONRequest( currentUrl );
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from AccuWeawther:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		let current = currentData[0];
		let daily = forecast.DailyForecasts;
		if ( !current || !daily || daily.length < 5) {
			throw new CodedError(ErrorCode.MissingWeatherField);
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
			precip: this.getDailyLiquid(daily[0]),
			forecast: []
		};

		for ( let index = 0; index < daily.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( daily[ index ].Temperature.Minimum.Value ),
				temp_max: Math.floor( daily[ index ].Temperature.Maximum.Value ),
				precip: this.getDailyLiquid(daily[index]),
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

	private getDailyLiquid(day: any): number {
		const daytime = day.Day?.TotalLiquid?.Value ?? day.Day?.Rain?.Value;
		const nighttime = day.Night?.TotalLiquid?.Value ?? day.Night?.Rain?.Value;
		return (Number.isFinite(daytime) ? daytime : 0) + (Number.isFinite(nighttime) ? nighttime : 0);
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
