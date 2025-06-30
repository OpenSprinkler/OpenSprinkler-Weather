import * as moment from "moment-timezone";

import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class DWDWeatherProvider extends WeatherProvider {

	public constructor() {
		super();
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData[] > {

		const start: string = moment().subtract( 10, "day" ).utc().format("YYYY-MM-DD");
		const end: string = moment().subtract(0, "day" ).utc().format("YYYY-MM-DD");
		//console.log("DWD getWateringData request for coordinates: %s", coordinates);

		const historicUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ start }&last_date=${ end }`
		//console.log("1: %s", yesterdayUrl);

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Bright Sky:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData.weather ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const hours = historicData.weather;

		//console.log("2: %s", samples.len);

		// Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if ( hours.length < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		// Cut down to 24 hour sections
		hours.splice(0, hours.length % 24);
		const daysInHours = [];
		for ( let i = 0; i < hours.length; i+=24 ){
			daysInHours.push(hours.slice(i, i+24));
		}

		const data = [];

		for(let i = 0; i < daysInHours.length; i++){
			const totals = { temp: 0, humidity: 0, precip: 0 };
			for ( const hour of daysInHours[i] ) {
				/*
				* If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
				* calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
				* calculated when data is missing from some samples (since they follow diurnal cycles and will be
				* significantly skewed if data is missing for several consecutive hours).
				*/
				totals.temp += hour.temperature;
				totals.humidity += hour.relative_humidity;
				// This field may be missing from the response if it is snowing.
				totals.precip += hour.precipitation || 0;
			}

			const length = daysInHours[i].length;

			const result : ZimmermanWateringData = {
				weatherProvider: "DWD",
				temp: this.C2F(totals.temp / length),
				humidity: totals.humidity / length,
				precip: this.mm2inch(totals.precip),
				raining: (i < daysInHours.length - 1) ? false : daysInHours[i][length-1].precipitation > 0
			}

			data.push(result);

			// console.log("DWD 1: temp:%s humidity:%s precip:%s raining:%s",
			// 	totals.temp / samples.length,
			// 	totals.humidity / samples.length,
			// 	totals.precip,
			// 	samples[ samples.length - 1 ].precipitation > 0);
		}

		return data;
	}

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {

		//console.log("DWD getWeatherData request for coordinates: %s", coordinates);

		const currentDate: string = moment().format("YYYY-MM-DD");

		const currentUrl = `https://api.brightsky.dev/current_weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }`;

		let current;
		try {
			current = await httpJSONRequest( currentUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Bright Sky:", err );
			throw "An error occurred while retrieving weather information from Bright Sky."
		}

		if ( !current || !current.weather ) {
			throw "Necessary field(s) were missing from weather information returned by Bright Sky.";
		}

		const weather: WeatherData = {
			weatherProvider: "DWD",
			temp: this.C2F(current.weather.temperature),
			humidity: current.weather.relative_humidity,
			wind: this.kmh2mph(current.weather.wind_speed_30),
			description: current.weather.condition,
			icon: this.getOWMIconCode( current.weather.icon ),

			region: "",
			city: current.sources[0].station_name,
			minTemp: 0,
			maxTemp: 0,
			precip: 0,
			forecast: [],
		};

		for ( let day = 0; day < 7; day++ ) {

			const date: number = moment().add(day, "day").unix();
			const dateStr: string = moment().add(day, "day").format("YYYY-MM-DD");

			const forecastUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ dateStr }`;

			let forecast;
			try {
				forecast = await httpJSONRequest( forecastUrl );
			} catch ( err ) {
				console.error( "Error retrieving weather information from Bright Sky:", err );
				throw "An error occurred while retrieving weather information from Bright Sky."
			}
			if ( !forecast || !forecast.weather ) {
				throw "Necessary field(s) were missing from weather information returned by Bright Sky.";
			}

			let minTemp: number = undefined, maxTemp: number = undefined, precip: number = 0;
			let condition: string = "dry", icon: string = "", condIdx = 0;
			const allowed = "dry.fog.rain.sleet.snow.hail.thunderstorm";
			for ( const hour of forecast.weather ) {
				minTemp = minTemp < hour.temperature ? minTemp : hour.temperature;
				maxTemp = maxTemp > hour.temperature ? maxTemp : hour.temperature;
				precip += hour.precipitation;
				let idx: number = allowed.indexOf(hour.condition);
				if ( idx > condIdx ) {
					condIdx = idx;
					condition = hour.condition;
					icon = hour.icon;
				}
			}
			if ( day == 0 ) {
				weather.minTemp = this.C2F(minTemp);
				weather.maxTemp = this.C2F(maxTemp);
				weather.precip  = this.mm2inch(precip);
			}
			weather.forecast.push( {
				temp_min: this.C2F(minTemp),
				temp_max: this.C2F(maxTemp),
				date: date,
				icon: this.getOWMIconCode( icon ),
				description: condition,
			} );
		}

		console.log("DWD 2: temp:%s humidity:%s wind:%s desc:%s city:%s",
			current.weather.temperature,
			current.weather.relative_humidity,
			current.weather.wind_speed_30,
			current.weather.condition,
			current.sources[0].station_name);

		return weather;
	}

	public async getEToData( coordinates: GeoCoordinates ): Promise< EToData[] > {

		const start: string = moment().subtract( 10, "day" ).utc().format("YYYY-MM-DD");
		const end: string = moment().subtract( 0, "day" ).utc().format("YYYY-MM-DD");
		const historicUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ start }&last_date=${ end }`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch (err) {
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData || !historicData.weather ) {
			throw "Necessary field(s) were missing from weather information returned by Bright Sky.";
		}

		const hours = historicData.weather;
		// Cut down to 24 hour sections
		hours.splice(0, hours.length % 24);
		const daysInHours = [];
		for ( let i = 0; i < hours.length; i+=24 ){
			daysInHours.push(hours.slice(i, i+24));
		}

		const data = [];

		for(let i = 0; i < daysInHours.length; i++){
			const cloudCoverInfo: CloudCoverInfo[] = daysInHours[i].map( ( hour ): CloudCoverInfo => {

				const result : CloudCoverInfo = {
					startTime: moment( hour.timestamp ),
					endTime: moment( hour.timestamp ).add( 1, "hours" ),
					cloudCover: hour.cloud_cover / 100.0,
				};

				return result;
			} );

			let minHumidity: number = undefined, maxHumidity: number = undefined;
			let minTemp: number = undefined, maxTemp: number = undefined, precip: number = 0;
			let wind: number = 0;
			for ( const hour of daysInHours[i] ) {

				minTemp = minTemp < hour.temperature ? minTemp : hour.temperature;
				maxTemp = maxTemp > hour.temperature ? maxTemp : hour.temperature;

				precip += hour.precipitation;
				wind += hour.wind_speed;

				// Skip hours where humidity measurement does not exist to prevent result from being NaN.

				if ( hour.relative_humidity === undefined || hour.relative_humidity === null) {
					continue;
				}

				// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
				minHumidity = minHumidity < hour.relative_humidity ? minHumidity : hour.relative_humidity;
				maxHumidity = maxHumidity > hour.relative_humidity ? maxHumidity : hour.relative_humidity;
			}

			let solar = approximateSolarRadiation( cloudCoverInfo, coordinates );

			const result : EToData = {
				weatherProvider: "DWD",
				periodStartTime: moment( daysInHours[ i ].timestamp).unix(), //"2022-05-02T21:30:00+00:00"
				minTemp: this.C2F(minTemp),
				maxTemp: this.C2F(maxTemp),
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				solarRadiation: solar,
				// Assume wind speed measurements are taken at 2 meters.
				windSpeed: this.kmh2mph(wind / daysInHours[ i ].length),
				precip: this.mm2inch(precip),
			}

			// console.log("DWD 3: precip:%s solar:%s minTemp:%s maxTemp:%s minHum:%s maxHum:%s wind:%s",
			// 	precip.toPrecision(3),
			// 	solar.toPrecision(3),
			// 	minTemp, maxTemp, minHumidity, maxHumidity, wind / historicData.weather.length);
			if ( minTemp === undefined || maxTemp === undefined || minHumidity === undefined || maxHumidity === undefined || solar === undefined || wind === undefined || precip === undefined ) {
				throw "Information missing from BrightSky.";
			}

			data.push(result);
		}

		return data;
	}

	public shouldCacheWateringScale(): boolean {
		return false;
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

	//Grad Celcius to Fahrenheit:
	private C2F(celsius: number): number {
		return celsius * 1.8 + 32;
	}

	//kmh to mph:
	private kmh2mph(kmh : number): number {
		return kmh / 1.609344;
	}

	//mm to inch:
	private mm2inch(mm : number): number {
		return mm / 25.4;
	}
}
