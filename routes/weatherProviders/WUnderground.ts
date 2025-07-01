import * as moment from "moment-timezone";

import { GeoCoordinates, PWS, WeatherData, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { httpJSONRequest } from "../weather";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class WUnderground extends WeatherProvider {

	async getWateringData( coordinates: GeoCoordinates, pws?: PWS ): Promise< ZimmermanWateringData[] > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getWateringData request for coordinates: %s", coordinates);

		const historicUrl = `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${ pws.id }&format=json&units=e&apiKey=${ pws.apiKey }`;
		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const hours = historicData.observations;

		// Cut hours into 24 hour sections up to most recent
		hours.splice(0, hours.length % 24);
		const daysInHours = [];
		for (let i = 0; i < hours.length; i+=24){
			daysInHours.push(hours.slice(i, i+24));
		}

		// Fail if not enough data is available.
		if ( daysInHours.length < 1 || daysInHours[0].length !== 24 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const data = [];
		for ( let i = 0; i < daysInHours.length; i++ ){
			const totals = { temp: 0, humidity: 0, precip: 0 };
			for ( const hour of daysInHours[i] ) {
				totals.temp += hour.imperial.tempAvg;
				totals.humidity += hour.humidityAvg;
				// Each hour is accumulation to present, not per hour precipitation. Using greatest value means last hour of each day is used.
				totals.precip = totals.precip > hour.imperial.precipTotal ? totals.precip : hour.imperial.precipTotal;
			}

			data.push( {
				weatherProvider: "WU",
				temp: totals.temp / 24,
				humidity: totals.humidity / 24,
				precip: totals.precip,
				raining: daysInHours[i][ daysInHours[i].length - 1 ].imperial.precipRate > 0
			} );
		}

		return data;

	}

	public async getWeatherData( coordinates: GeoCoordinates, pws?: PWS ): Promise< WeatherData > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getWeatherData request for coordinates: %s", coordinates);

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

		const icon = forecast.daypart[0].iconCode[0];

		const maxTemp = forecast.temperatureMax[0];

		const weather: WeatherData = {
			weatherProvider: "WUnderground",
			temp: Math.floor( current.imperial.temp ),
			humidity: Math.floor( current.humidity ),
			wind: Math.floor( current.imperial.windSpeed ),
			description: forecast.narrative[0],
			icon: this.getWUIconCode( (icon === null) ? -1 : icon ), //Null after 3pm

			region: current.country,
			city: "",
			minTemp: Math.floor( forecast.temperatureMin[0] ),
			maxTemp: Math.floor( (maxTemp === null ) ? current.imperial.temp : maxTemp ), //Null after 3pm
			precip: forecast.qpf[0] + forecast.qpfSnow[0],
			forecast: []
		};

		for ( let index = 0; index < forecast.dayOfWeek.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( forecast.temperatureMin[index] ),
				temp_max: Math.floor( forecast.temperatureMax[index] ),
				date: forecast.validTimeUtc[index],
				icon: this.getWUIconCode( forecast.daypart[0].iconCode[index] ),
				description: forecast.narrative[index]
			} );
		}

		return weather;
	}

	public async getEToData( coordinates: GeoCoordinates, pws?: PWS ): Promise< EToData[] > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getEToData request for coordinates: %s %s", coordinates, pws.id);

		//Calling for data from last 7 days
		const historicUrl = `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${ pws.id }&format=json&units=e&numericPrecision=decimal&apiKey=${ pws.apiKey }`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch (err) {
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData || !historicData.observations ) {
			throw "Necessary field(s) were missing from weather information returned by Wunderground.";
		}

		const hours = historicData.observations;

		// Cut hours into 24 hour sections
		hours.splice(0, hours.length % 24);
		const daysInHours = [];
		for (let i = 0; i < hours.length; i+=24){
			daysInHours.push(hours.slice(i, i+24));
		}

		const data = [];
		for ( let i = 0; i < daysInHours.length; i++ ){
			let minHumidity: number = undefined, maxHumidity: number = undefined;
			let minTemp: number = undefined, maxTemp: number = undefined
			let precip: number = 0;
			let wind: number = 0, solar: number = 0;

			for ( const hour of daysInHours[i] ) {

				minTemp = minTemp < hour.imperial.tempLow ? minTemp : hour.imperial.tempLow;
				maxTemp = maxTemp > hour.imperial.tempHigh ? maxTemp : hour.imperial.tempHigh;

				// Each hour is accumulation to present, not per hour precipitation. Using greatest value means last hour of each day is used.
				precip = precip > hour.imperial.precipTotal ? precip: hour.imperial.precipTotal;

				if (hour.imperial.windspeedAvg != null && hour.imperial.windspeedAvg > wind)
					wind = hour.imperial.windspeedAvg;

				if (hour.solarRadiationHigh != null)
					solar += hour.solarRadiationHigh;

				minHumidity = minHumidity < hour.humidityLow ? minHumidity : hour.humidityLow;
				maxHumidity = maxHumidity > hour.humidityHigh ? maxHumidity : hour.humidityHigh;
			}

			solar = solar / 1000; //Watts/m2 in 24h -->KWh/m2 (Total per day, not average)

			const result : EToData = {
				weatherProvider: "WU",
				periodStartTime: daysInHours[i][0].epoch,
				minTemp: minTemp,
				maxTemp: maxTemp,
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				solarRadiation: solar,
				// Assume wind speed measurements are taken at 2 meters.
				windSpeed: wind,
				precip: precip,
			}

			data.push(result);

			// console.log("WU 3: precip:%s solar:%s minTemp:%s maxTemp:%s minHum:%s maxHum:%s wind:%s n:%s nig:%s",
			// 	(this.inch2mm(precip)).toPrecision(3),
			// 	solar.toPrecision(3),
			// 	(this.F2C(minTemp)).toPrecision(3), (this.F2C(maxTemp)).toPrecision(3), minHumidity, maxHumidity, (this.mph2kmh(wind)).toPrecision(4), n, nig);
		}

		return data;
	}

	public shouldCacheWateringScale(): boolean {
		return false;
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