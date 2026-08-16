import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { getTZ, httpJSONRequest, localTime } from "../weather";
import { CodedError, ErrorCode } from "../../errors";
import { averageFinite, completeHistoricalHourlyDays, maxFinite, minFinite, sumFinite } from "./providerUtils";

export default class WUndergroundWeatherProvider extends WeatherProvider {

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		const historicUrl = `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${ pws.id }&format=json&units=e&numericPrecision=decimal&apiKey=${ pws.apiKey }`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData || !historicData.observations ) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const hours: any[] = historicData.observations;
		const timezone = hours[0]?.tz || getTZ(coordinates);
		const daysInHours = completeHistoricalHourlyDays(
			hours,
			hour => hour.epoch * 1000,
			timezone,
			localTime(coordinates),
			7
		).map(group => group.records);

		// Fail if not enough data is available.
		if (!daysInHours.length) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const data: WateringData[] = [];
		for ( let i = 0; i < daysInHours.length; i++ ){
			const day = daysInHours[i];
			const temp = averageFinite(day.map(hour => hour.imperial?.tempAvg));
			const humidity = averageFinite(day.map(hour => hour.humidityAvg));
			const precip = maxFinite(day.map(hour => hour.imperial?.precipTotal));
			const minTemp = minFinite(day.map(hour => hour.imperial?.tempLow));
			const maxTemp = maxFinite(day.map(hour => hour.imperial?.tempHigh));
			const wind = averageFinite(day.map(hour => hour.imperial?.windspeedAvg));
			const solar = sumFinite(day.map(hour => hour.solarRadiationHigh));
			const minHumidity = minFinite(day.map(hour => hour.humidityLow));
			const maxHumidity = maxFinite(day.map(hour => hour.humidityHigh));

			if ([temp, humidity, precip, minTemp, maxTemp, minHumidity, maxHumidity]
				.some(value => !Number.isFinite(value))) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}

			const wateringData: WateringData = {
				weatherProvider: "WU",
				temp: temp,
				humidity: humidity,
				precip: precip,
				periodStartTime: daysInHours[i][0].epoch,
				minTemp: minTemp,
				maxTemp: maxTemp,
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
			};
			if (typeof solar === "number" && Number.isFinite(solar)) {
				// The API exposes hourly peak irradiance, not an hourly mean. Treating each peak
				// as a one-hour mean is retained as a documented approximation.
				wateringData.solarRadiation = solar / 1000;
			}
			if (typeof wind === "number" && Number.isFinite(wind)) {
				// PWS anemometer height is installation-specific.
				wateringData.windSpeed = wind;
			}
			data.push(wateringData);
		}

		return data.reverse();

	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		const forecastURL = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${ coordinates[ 0 ] },${ coordinates[ 1 ] }&format=json&language=en-US&units=e&apiKey=${ pws.apiKey }`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastURL );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const currentURL = `https://api.weather.com/v2/pws/observations/current?stationId=${ pws.id }&format=json&units=e&apiKey=${ pws.apiKey }`;

		let data;
		try {
			data = await httpJSONRequest( currentURL );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const current = data.observations[0];

		const icon = this.getDaypartValue(forecast.daypart[0].iconCode as number[], 0);

		const maxTemp = forecast.temperatureMax[0];

		const weather: WeatherData = {
			weatherProvider: "WUnderground",
			temp: Math.floor( current.imperial.temp ),
			humidity: Math.floor( current.humidity ),
			wind: Math.floor( current.imperial.windSpeed ),
			raining: current.imperial.precipRate > 0,
			description: forecast.narrative[0],
			icon: this.getWUIconCode(icon == null ? -1 : icon), // Null after 3pm

			region: current.country,
			city: "",
			minTemp: Math.floor( forecast.temperatureMin[0] ),
			maxTemp: Math.floor( (maxTemp === null ) ? current.imperial.temp : maxTemp ), //Null after 3pm
			precip: forecast.qpf[0],
			forecast: []
		};

		for ( let index = 0; index < forecast.dayOfWeek.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( forecast.temperatureMin[index] ),
				temp_max: Math.floor( forecast.temperatureMax[index] ),
				precip: forecast.qpf[index],
				date: forecast.validTimeUtc[index],
				icon: this.getWUIconCode(this.getDaypartValue(forecast.daypart[0].iconCode as number[], index) ?? -1),
				description: forecast.narrative[index]
			} );
		}

		return weather;
	}

	public shouldCacheWateringScale(): boolean {
		return false;
	}

	private getDaypartValue<T>(values: T[], day: number): T | undefined {
		return values[day * 2] ?? values[day * 2 + 1];
	}

	private getWUIconCode(code: number) {
		const mapping = [
			"50d", // Tornado
			"09d", // Tropical Storm
			"09d", // Hurricane
			"11d", // Strong Storms
			"11d", // Thunderstorms
			"13d", // Rain + Snow
			"13d", // Rain + Sleet
			"13d", // Wintry Mix
			"13d", // Freezing Drizzle
			"09d", // Drizzle
			"13d", // Freezing Rain
			"09d", // Showers
			"09d", // Rain
			"13d", // Flurries
			"13d", // Snow Showers
			"13d", // Blowing/Drifting Snow
			"13d", // Snow
			"13d", // Hail
			"13d", // Sleet
			"50d", // Blowing Dust/Sand
			"50d", // Foggy
			"50d", // Haze
			"50d", // Smoke
			"50d", // Breezy
			"50d", // Windy
			"13d", // Frigid/Ice Crystals
			"04d", // Cloudy
			"03n", // Mostly Cloudy (night)
			"03d", // Mostly Cloudy (day)
			"02n", // Partly Cloudy (night)
			"02d", // Partly Cloudy (day)
			"01n", // Clear night
			"01d", // Sunny
			"02n", // Mostly clear night
			"02d", // Mostly sunny
			"13d", // Rain and Hail
			"01d", // Hot
			"11d", // Isolated thunderstorms (Day)
			"11d", // Scattered thunderstorms (Day)
			"09d", // Scattered showers (Day)
			"09d", // Heavy rain
			"13d", // Scattered snow shower (Day)
			"13d", // Heavy snow
			"13d", // Blizzard
			"01d", // Not available
			"09n", // Scattered showers (Night)
			"13n", // Scattered snow shower (Night)
			"09n" // Scattered thunderstorm (Night)
		];
		return (code >= 0 && code < mapping.length) ? mapping[code] : "50d";
	}

	// Fahrenheit to Grad Celcius:
	private F2C(fahrenheit: number): number {
		return (fahrenheit-32) / 1.8;
	}

	//mph to kmh:
	private mph2kmh(mph : number): number {
		return mph * 1.609344;
	}

	//inch to mm:
	private inch2mm(inch : number): number {
		return inch * 25.4;
	}
}
