import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { getTZ, httpJSONRequest, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import {
	approximateSolarRadiation,
	CloudCoverInfo,
	standardizeWindSpeed,
} from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addDays, addHours, format, getUnixTime, startOfDay, subDays } from "date-fns";
import { TZDate } from "@date-fns/tz";
import {
	averageFinite,
	completeHistoricalHourlyDays,
	groupByLocalDay,
	maxFinite,
	minFinite,
	sumFinite,
} from "./providerUtils";

const WIND_MEASUREMENT_HEIGHT_FEET = 10 * 3.281;

export default class DWDWeatherProvider extends WeatherProvider {

	public constructor() {
		super();
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
        const tz = getTZ(coordinates);
		const currentDay = startOfDay(localTime(coordinates));

		const startTimestamp = format(subDays(currentDay, 7), "yyyy-MM-dd");
		const endTimestamp = format(currentDay, "yyyy-MM-dd");

		const historicUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ startTimestamp }&last_date=${ endTimestamp }&tz=${tz}`

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

		const hours: any[] = historicData.weather;

		// Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if ( hours.length < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const daysInHours = completeHistoricalHourlyDays(
			hours,
			hour => hour.timestamp,
			tz,
			currentDay,
			7
		).map(group => group.records);
		if (!daysInHours.length) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
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

			const day = daysInHours[i];
			const temp = averageFinite(day.map(hour => hour.temperature));
			const humidity = averageFinite(day.map(hour => hour.relative_humidity));
			const precip = sumFinite(day.map(hour => hour.precipitation));
			const minHumidity = minFinite(day.map(hour => hour.relative_humidity));
			const maxHumidity = maxFinite(day.map(hour => hour.relative_humidity));
			const minTemp = minFinite(day.map(hour => hour.temperature));
			const maxTemp = maxFinite(day.map(hour => hour.temperature));
			const wind = averageFinite(day.map(hour => hour.wind_speed));
			const directSolar = day.every(hour => Number.isFinite(hour.solar))
				? sumFinite(day.map(hour => hour.solar))
				: undefined;
			const solarRadiation = directSolar ?? approximateSolarRadiation(cloudCoverInfo, coordinates);

			const result : WateringData = {
				weatherProvider: "DWD",
				temp: this.C2F(temp),
				humidity: humidity,
				precip: this.mm2inch(precip),
				periodStartTime: getUnixTime(new TZDate(daysInHours[i][0].timestamp)),
				minTemp: this.C2F(minTemp),
				maxTemp: this.C2F(maxTemp),
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				solarRadiation,
				windSpeed: standardizeWindSpeed(this.kmh2mph(wind), WIND_MEASUREMENT_HEIGHT_FEET)
			}

			if ([temp, humidity, minTemp, maxTemp, minHumidity, maxHumidity, result.solarRadiation, wind, precip]
				.some(value => !Number.isFinite(value))) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}

			data.push(result);
		}

		return data.reverse();
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		const tz = getTZ(coordinates);

		const currentUrl = `https://api.brightsky.dev/current_weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&tz=${tz}`;

		let current;
		try {
			current = await httpJSONRequest( currentUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Bright Sky:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if ( !current || !current.weather ) {
			throw new CodedError(ErrorCode.MissingWeatherField);
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
			city: current.sources?.[0]?.station_name || "",
			minTemp: 0,
			maxTemp: 0,
			precip: 0,
			forecast: [],
		};

		const local = localTime(coordinates);
		const startDate = format(local, "yyyy-MM-dd");
		// last_date is the timestamp of the final record, so request through the next midnight
		// and keep the first seven complete calendar-day groups.
		const endDate = format(addDays(local, 7), "yyyy-MM-dd");
		const forecastUrl = `https://api.brightsky.dev/weather?lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${ startDate }&last_date=${ endDate }&tz=${tz}`;
		let forecast;
		try {
			forecast = await httpJSONRequest(forecastUrl);
		} catch (err) {
			console.error("Error retrieving weather information from Bright Sky:", err);
			throw new CodedError(ErrorCode.WeatherApiError);
		}
		if (!forecast || !forecast.weather) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}
		const forecastHours: any[] = forecast.weather;
		const forecastDays = groupByLocalDay(forecastHours, hour => hour.timestamp, tz).slice(0, 7);
		if (!forecastDays.length) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		for (let day = 0; day < forecastDays.length; day++) {
			const records = forecastDays[day].records;

			const minTemp = minFinite(records.map(hour => hour.temperature));
			const maxTemp = maxFinite(records.map(hour => hour.temperature));
			const precip = sumFinite(records.map(hour => hour.precipitation));
			if (![minTemp, maxTemp, precip].every(Number.isFinite)) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}
			let condition: string = "dry", icon: string = "", condIdx = 0;
			const allowed = ["dry", "fog", "rain", "sleet", "snow", "hail", "thunderstorm"];
			for (const hour of records) {
				const idx = allowed.indexOf(hour.condition);
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
				date: getUnixTime(new TZDate(records[0].timestamp, tz)),
				icon: this.getOWMIconCode( icon ),
				description: condition,
			} );
		}

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
