import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { getTZ, httpJSONRequest, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";
import { format, getUnixTime, startOfDay, subDays } from "date-fns";
import { standardizeWindSpeed } from "../adjustmentMethods/EToAdjustmentMethod";
import {
	averageFinite,
	completeHistoricalHourlyDays,
	maxFinite,
	minFinite,
	sumFinite,
} from "./providerUtils";

const WIND_MEASUREMENT_HEIGHT_FEET = 10 * 3.281;

export default class OpenMeteoWeatherProvider extends WeatherProvider {

	/**
	 * Api Docs from here: https://open-meteo.com/en/docs
	 */
	public constructor() {
		super();
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		const tz = getTZ(coordinates);

        const currentDay = startOfDay(localTime(coordinates));

        const startTimestamp = format(subDays(currentDay, 7), "yyyy-MM-dd");
        const endTimestamp = format(currentDay, "yyyy-MM-dd");


		const historicUrl = `https://api.open-meteo.com/v1/forecast?latitude=${ coordinates[ 0 ] }&longitude=${ coordinates[ 1 ] }&hourly=temperature_2m,relative_humidity_2m,precipitation,shortwave_radiation,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&start_date=${startTimestamp}&end_date=${endTimestamp}&timezone=${tz}&timeformat=unixtime`;

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from OpenMeteo:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData || !historicData.hourly ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const sampleCount = historicData.hourly.time?.length || 0;
		const samples = Array.from({ length: sampleCount }, (_, index) => ({
			time: historicData.hourly.time[index],
			temperature: historicData.hourly.temperature_2m?.[index],
			humidity: historicData.hourly.relative_humidity_2m?.[index],
			precipitation: historicData.hourly.precipitation?.[index],
			solarRadiation: historicData.hourly.shortwave_radiation?.[index],
			windSpeed: historicData.hourly.wind_speed_10m?.[index],
		}));
		const days = completeHistoricalHourlyDays(
			samples,
			sample => sample.time * 1000,
			tz,
			startOfDay(localTime(coordinates)),
			7
		);
		if (!days.length) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		const data: WateringData[] = [];

		for (const day of days) {
			const records = day.records;
			const temp = averageFinite(records.map(record => record.temperature));
			const humidity = averageFinite(records.map(record => record.humidity));
			const precip = sumFinite(records.map(record => record.precipitation));
			const minTemp = minFinite(records.map(record => record.temperature));
			const maxTemp = maxFinite(records.map(record => record.temperature));
			const minHumidity = minFinite(records.map(record => record.humidity));
			const maxHumidity = maxFinite(records.map(record => record.humidity));
			const wind = averageFinite(records.map(record => record.windSpeed));
			const solar = sumFinite(records.map(record => record.solarRadiation));
			if ([temp, humidity, precip, minTemp, maxTemp, minHumidity, maxHumidity, wind, solar]
				.some(value => !Number.isFinite(value))) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}

			const result: WateringData = {
				weatherProvider: "OpenMeteo",
				temp,
				humidity,
				precip: precip,
				periodStartTime: records[0].time,
				minTemp: minTemp,
				maxTemp: maxTemp,
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				// Each value is the preceding hour's mean W/m2, so summing and dividing by
				// 1000 produces daily kWh/m2.
				solarRadiation: solar / 1000,
				windSpeed: standardizeWindSpeed(wind, WIND_MEASUREMENT_HEIGHT_FEET)
			}

			data.push(result);
		}

		return data.reverse();
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		const timezone = getTZ(coordinates);

		const currentUrl = `https://api.open-meteo.com/v1/forecast?latitude=${ coordinates[ 0 ] }&longitude=${ coordinates[ 1 ] }&timezone=${ timezone }&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime`;

		let current;
		try {
			current = await httpJSONRequest( currentUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from OpenMeteo:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if ( !current || !current.daily || !current.current ) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const weather: WeatherData = {
			weatherProvider: "OpenMeteo",
			temp: current.current.temperature_2m,
			humidity: current.current?.relative_humidity_2m,
			wind: current.current.wind_speed_10m,
			raining: typeof current.current?.precipitation === "number" ? current.current.precipitation > 0 : undefined,
			description: this.getWMOIconCode(current.current.weather_code).desc,
			icon: this.getWMOIconCode(current.current.weather_code).icon,

			region: "",
			city: "",
			minTemp: current.daily.temperature_2m_min[0],
			maxTemp: current.daily.temperature_2m_max[0],
			precip: current.daily.precipitation_sum[0],
			forecast: [],
		};

		for ( let day = 0; day < current.daily.time.length; day++ ) {
			weather.forecast.push( {
				temp_min: current.daily.temperature_2m_min[day],
				temp_max: current.daily.temperature_2m_max[day],
				precip: current.daily.precipitation_sum[day],
				date: current.daily.time[day],
				icon: this.getWMOIconCode( current.daily.weather_code[day] ).icon,
				description: this.getWMOIconCode( current.daily.weather_code[day] ).desc,
			} );
		}

		return weather;
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

	/**
	 * See https://open-meteo.com/en/docs
	 * @param code
	 * @returns
	 */
	private getWMOIconCode(code: number) {
		switch(code) {
			case 0:
				//0 	Clear sky
				return {"icon": "01d", desc: "Clear Sky"};
			case 1:
				//1, 2, 3 	Mainly clear, partly cloudy, and overcast
				return {"icon": "02d", desc: "Mainly clear"};
			case 2:
				return {"icon": "03d", desc: "Partly cloudy"};
			case 3:
				return {"icon": "04d", desc: "Overcast"};
			case 45:
				//45, 48 	Fog and depositing rime fog
				return {"icon": "50d", desc: "Fog"};
			case 48:
				return {"icon": "50d", desc: "Deposing rime fog"};
			case 51:
				//51, 53, 55 	Drizzle: Light, moderate, and dense intensity
				return {"icon": "50d", desc: "Drizzle: light"};
			case 53:
				return {"icon": "50d", desc: "Drizzle: moderate"};
			case 55:
				return {"icon": "50d", desc: "Drizzle: dense"}; // or "09d"?
			case 56:
				//56, 57 	Freezing Drizzle: Light and dense intensity
				return {"icon": "50d", desc: "Freezing Drizzle: light"};
			case 57:
				return {"icon": "50d", desc: "Freezing Drizzle: dense"}; // or "09d"?
			case 61:
				//61, 63, 65 	Rain: Slight, moderate and heavy intensity
				return {"icon": "10d", desc: "Rain: slight"};
			case 63:
				return {"icon": "09d", desc: "Rain: moderate"};
			case 65:
				return {"icon": "11d", desc: "Rain: heavy"};
			case 66:
				//66, 67 	Freezing Rain: Light and heavy intensity
				return {"icon": "09d", desc: "Freezing Rain: light"};
			case 67:
				return {"icon": "11d", desc: "Freezing Rain: heavy"};
			case 71:
				//71, 73, 75 	Snow fall: Slight, moderate, and heavy intensity
				return {"icon": "13d", desc: "Snow fall: slight"};
			case 73:
				return {"icon": "13d", desc: "Snow fall: moderate"};
			case 75:
				return {"icon": "13d", desc: "Snow fall: heavy"};
			case 77:
				//77 	Snow grains
				return {"icon": "13d", desc: "Snow grains"};
			case 80:
				//80, 81, 82 	Rain showers: Slight, moderate, and violent
				return {"icon": "11d", desc: "Rain showers: slight"};
			case 81:
				return {"icon": "11d", desc: "Rain showers: moderate"};
			case 82:
				return {"icon": "11d", desc: "Rain showers: violent"};
			case 85:
				//85, 86 	Snow showers slight and heavy
				return {"icon": "13d", desc: "Snow showers: slight"};
			case 86:
				return {"icon": "13d", desc: "Snow showers: heavy"};
			case 95:
				//95 	Thunderstorm: Slight or moderate
				return {"icon": "11d", desc: "Thunderstorm: Slight or moderate"};
			case 96:
				//96, 99 	Thunderstorm with slight and heavy hail
				return {"icon": "13d", desc: "Thunderstorm: slight hail"};
			case 99:
				return {"icon": "13d", desc: "Thunderstorm: heavy hail"}; // or "11d"?
			default:
				return {"icon": "01d", desc: "Clear sky"};
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
