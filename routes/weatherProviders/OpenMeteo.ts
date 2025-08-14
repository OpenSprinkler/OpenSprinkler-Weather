import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";

import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";

export default class OpenMeteoWeatherProvider extends WeatherProvider {

	/**
	 * Api Docs from here: https://open-meteo.com/en/docs
	 */
	public constructor() {
		super();
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		//console.log("OM getWateringData request for coordinates: %s", coordinates);
		const historicUrl = `https://api.open-meteo.com/v1/forecast?latitude=${ coordinates[ 0 ] }&longitude=${ coordinates[ 1 ] }&hourly=temperature_2m,relativehumidity_2m,precipitation,direct_radiation,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&past_days=7&timezone=auto&timeformat=unixtime&forecast_days=1`;

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

		// Cut data down to 7 days previous (midnight to midnight)
		const tz = geoTZ.find(coordinates[0], coordinates[1])[0];
		const startOfDay = moment().tz(tz).startOf("day").unix();

		const historicCutoff = historicData.hourly.time.findIndex( function( time ) {
			return time > startOfDay;
		} );

		for (const arr in historicData.hourly) {
			historicData.hourly[arr].length = historicCutoff;
			historicData.hourly[arr].splice(0, historicData.hourly[arr].length % 24);
		}

		const data: WateringData[] = [];

		for(let i = 0; i < 7; i++){ //
			let temp: number = 0, humidity: number = 0, precip: number = 0,
				minHumidity: number = undefined, maxHumidity: number = undefined,
				minTemp: number = undefined, maxTemp: number = undefined,
				wind: number = 0, solar: number = 0;

			for (let index = i*24; index < (i+1)*24; index++ ) {
				temp += historicData.hourly.temperature_2m[index];
				humidity += historicData.hourly.relativehumidity_2m[index];
				precip += historicData.hourly.precipitation[index] || 0;

				minTemp = minTemp < historicData.hourly.temperature_2m[index] ? minTemp : historicData.hourly.temperature_2m[index];
				maxTemp = maxTemp > historicData.hourly.temperature_2m[index] ? maxTemp : historicData.hourly.temperature_2m[index];

				if (historicData.hourly.windspeed_10m[index] > wind)
					wind = historicData.hourly.windspeed_10m[index];

				minHumidity = minHumidity < historicData.hourly.relativehumidity_2m[index] ? minHumidity : historicData.hourly.relativehumidity_2m[index];
				maxHumidity = maxHumidity > historicData.hourly.relativehumidity_2m[index] ? maxHumidity : historicData.hourly.relativehumidity_2m[index];

				solar += historicData.hourly.direct_radiation[index];
			}

			const result: WateringData = {
				weatherProvider: "OpenMeteo",
				temp: temp / 24,
				humidity: humidity / 24,
				precip: precip,
				periodStartTime: historicData.hourly.time[i*24],
				minTemp: minTemp,
				maxTemp: maxTemp,
				minHumidity: minHumidity,
				maxHumidity: maxHumidity,
				solarRadiation: solar / 1000, // API gives in Watts
				windSpeed: wind
			}

			/*console.log("OM 1: temp:%s humidity:%s precip:%s raining:%s",
				this.F2C(result.temp),
				result.humidity,
				this.inch2mm(result.precip),
				result.raining);*/

			data.push(result);
		}

		return data.reverse();
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {

		//console.log("OM getWeatherData request for coordinates: %s", coordinates);

		const currentDate: number = moment().unix();
		const timezone = geoTZ.find( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ];

		const currentUrl = `https://api.open-meteo.com/v1/forecast?latitude=${ coordinates[ 0 ] }&longitude=${ coordinates[ 1 ] }&timezone=${ timezone }&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&timeformat=unixtime`;
		//console.log(currentUrl);

		let current;
		try {
			current = await httpJSONRequest( currentUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from OpenMeteo:", err );
			throw "An error occurred while retrieving weather information from OpenMeteo."
		}

		if ( !current || !current.daily || !current.current_weather ) {
			throw "Necessary field(s) were missing from weather information returned by OpenMeteo.";
		}

		const weather: WeatherData = {
			weatherProvider: "OpenMeteo",
			temp: current.current_weather.temperature,
			humidity: 0,
			wind: current.current_weather.windspeed,
			raining: current.daily.precipitation_sum[0] > 0,
			description: this.getWMOIconCode(current.current_weather.weathercode).desc,
			icon: this.getWMOIconCode(current.current_weather.weathercode).icon,

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
				icon: this.getWMOIconCode( current.daily.weathercode[day] ).icon,
				description: this.getWMOIconCode( current.daily.weathercode[day] ).desc,
			} );
		}

		/*console.log("OM 2: temp:%s humidity:%s wind:%s",
			this.F2C(weather.temp),
			weather.humidity,
			this.mph2kmh(weather.wind));*/

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
				return {"icon": "02d", desc: "Mainly cloudy"};
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
