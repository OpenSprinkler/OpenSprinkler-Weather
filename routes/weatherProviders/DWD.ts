import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { getTZ, httpJSONRequest, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addDays, addHours, getUnixTime, startOfDay, subDays } from "date-fns";
import { TZDate } from "@date-fns/tz";

export default class DWDWeatherProvider extends WeatherProvider {

	public constructor() {
		super();
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
        const tz = getTZ(coordinates);
		const currentDay = startOfDay(localTime(coordinates));

        const startTimestamp = subDays(currentDay, 7).toISOString();
        const endTimestamp = currentDay.toISOString();

		const historicUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ startTimestamp }&last_date=${ endTimestamp }&tz=${tz}`

		//console.log("DWD getWateringData request for coordinates: %s", coordinates);
		//console.log("1: %s", yesterdayUrl);

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Bright Sky:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData || !historicData.weather ) {
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
		hours.length -= hours.length % 24;
		const daysInHours = [];
		for ( let i = 0; i < hours.length; i+=24 ){
			daysInHours.push(hours.slice(i, i+24));
		}

		const data = [];

		for(let i = 0; i < daysInHours.length; i++){
			const cloudCoverInfo: CloudCoverInfo[] = daysInHours[i].map( ( hour ): CloudCoverInfo => {
                const startTime = new TZDate(hour.timestamp, tz);
				const result : CloudCoverInfo = {
					startTime,
					endTime: addHours(startTime, 1),
					cloudCover: hour.cloud_cover / 100.0,
				};

				return result;
			} );

			let temp: number = 0, humidity: number = 0, precip: number = 0,
			minHumidity: number = undefined, maxHumidity: number = undefined,
			minTemp: number = undefined, maxTemp: number = undefined, wind: number = 0;
			for ( const hour of daysInHours[i] ) {
				/*
				* If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
				* calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
				* calculated when data is missing from some samples (since they follow diurnal cycles and will be
				* significantly skewed if data is missing for several consecutive hours).
				*/

				temp += hour.temperature;
				humidity += hour.relative_humidity;
				// This field may be missing from the response if it is snowing.
				precip += hour.precipitation || 0;

				minTemp = minTemp < hour.temperature ? minTemp : hour.temperature;
				maxTemp = maxTemp > hour.temperature ? maxTemp : hour.temperature;
				wind += hour.wind_speed;

				// Skip hours where humidity does not exist to prevent ETo from being NaN.
				if ( hour.relative_humidity === undefined || hour.relative_humidity === null)
					continue;
				// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
				minHumidity = minHumidity < hour.relative_humidity ? minHumidity : hour.relative_humidity;
				maxHumidity = maxHumidity > hour.relative_humidity ? maxHumidity : hour.relative_humidity;
			}

			const length = daysInHours[i].length;

			const result : WateringData = {
				weatherProvider: "DWD",
				temp: this.C2F(temp / length),
				humidity: humidity / length,
				precip: this.mm2inch(precip),
				periodStartTime: getUnixTime(new Date(daysInHours[ i ].timestamp)),
				minTemp: this.C2F(minTemp),
				maxTemp: this.C2F(maxTemp),
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
				// Assume wind speed measurements are taken at 2 meters.
				windSpeed: this.kmh2mph(wind / daysInHours[ i ].length)
			}

			if ( minTemp === undefined || maxTemp === undefined || minHumidity === undefined || maxHumidity === undefined || result.solarRadiation === undefined || wind === undefined || precip === undefined ) {
				throw "Information missing from BrightSky.";
			}

			data.push(result);

			// console.log("DWD 1: temp:%s humidity:%s precip:%s raining:%s",
			// 	totals.temp / samples.length,
			// 	totals.humidity / samples.length,
			// 	totals.precip,
			// 	samples[ samples.length - 1 ].precipitation > 0);
		}

		return data.reverse();
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {

		//console.log("DWD getWeatherData request for coordinates: %s", coordinates);

		const tz = getTZ(coordinates);

		const currentUrl = `https://api.brightsky.dev/current_weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&tz=${tz}`;

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
			raining: current.weather.precipitation_60 > 0,
			description: current.weather.condition,
			icon: this.getOWMIconCode( current.weather.icon ),

			region: "",
			city: current.sources[0].station_name,
			minTemp: 0,
			maxTemp: 0,
			precip: 0,
			forecast: [],
		};

        const local = localTime(coordinates);

		for ( let day = 0; day < 7; day++ ) {

			const date = addDays(local, day);

			const forecastUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ date.toISOString() }`;

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
				precip: this.mm2inch(precip),
				date: getUnixTime(date),
				icon: this.getOWMIconCode( icon ),
				description: condition,
			} );
		}

		/*console.log("DWD 2: temp:%s humidity:%s wind:%s desc:%s city:%s",
			current.weather.temperature,
			current.weather.relative_humidity,
			current.weather.wind_speed_30,
			current.weather.condition,
			current.sources[0].station_name);*/

		return weather;
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
