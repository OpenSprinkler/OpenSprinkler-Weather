import { GeoCoordinates, PWS, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest, keyToUse } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { normalizeWeatherData } from "./normalizeWeatherData";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import moment from "moment";
import geoTZ from "geo-tz";
import { CodedError, ErrorCode } from "../../errors";

export default class OWMWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.OWM_API_KEY;
	}

	public async getWateringData(coordinates: GeoCoordinates, pws?: PWS): Promise<ZimmermanWateringData> {

		const localKey = keyToUse(this.API_KEY, pws);

		// The OWM free API options changed so need to use the new API method
		//Get previous date by using UTC
		const timezone = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ] ).utcOffset();
		let time = Date.now();
		time -= (86400000 + timezone * 60000);
		const date = new Date(time);
		let day = this.pad(date.getUTCDate());
		let month = this.pad(date.getUTCMonth() + 1);
		const yesterdayUrl = `https://api.openweathermap.org/data/3.0/onecall/day_summary?units=imperial&appid=${ localKey }&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${date.getUTCFullYear()}-${month}-${day}`;
		const todayUrl = `https://api.openweathermap.org/data/3.0/onecall?units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&exclude=minutely,hourly,daily,alerts&appid=${ localKey }`;

		// Perform the HTTP request to retrieve the weather data
		let yesterdayData, todayData;
		try {
			yesterdayData = await httpJSONRequest(yesterdayUrl);
			todayData = await httpJSONRequest(todayUrl);

		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate watering data could not be retrieved if the forecast data is incomplete.
		if ( !yesterdayData || !todayData ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		let temp = yesterdayData.temperature;

		let totalTemp = temp.min + temp.max + temp.afternoon + temp.night + temp.evening + temp.morning;

		return {
			weatherProvider: "OWM",
			temp: totalTemp / 6,
			humidity: (yesterdayData.humidity.afternoon + todayData.current.humidity) / 2,
			precip: yesterdayData.precipitation.total / 25.4,
			raining: (todayData.current.weather.main === "Rain")
		};
	}

	public async getWeatherData(coordinates: GeoCoordinates, pws?: PWS): Promise<WeatherData> {

		const localKey = keyToUse(this.API_KEY, pws);

		// The OWM free API options changed so need to use the new API method
		const weatherDataUrl = `https://api.openweathermap.org/data/3.0/onecall?units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&exclude=minutely,alerts&appid=${ localKey }`

		let weatherData;
		try {
			weatherData = await httpJSONRequest(weatherDataUrl);

		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate weather data could not be retrieved if the forecast data is incomplete.
		if (!weatherData || !weatherData.current || !weatherData.daily) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const finite = ( value: any ): value is number => typeof value === "number" && Number.isFinite( value );

		const weather: WeatherData = {
			weatherProvider: "OWM",
			temp: weatherData.current.temp,
			humidity: weatherData.current.humidity,
			wind: weatherData.current.wind_speed,
			description: weatherData.current.weather[0].description,
			icon: weatherData.current.weather[0].icon,

			region: "",
			city: "",
			minTemp: weatherData.daily[0].temp.min,
			maxTemp: weatherData.daily[0].temp.max,
			precip: (weatherData.daily[0].rain ? weatherData.daily[0].rain : 0) / 25.4,
			forecast: [],
			...( finite( weatherData.current.dt ) ? { observedAt: weatherData.current.dt } : {} )
		};

		for (let index = 0; index < weatherData.daily.length; index++) {
			const daily = weatherData.daily[index];
			weather.forecast.push({
				temp_min: daily.temp.min,
				temp_max: daily.temp.max,
				date: daily.dt,
				icon: daily.weather[0].icon,
				description: daily.weather[0].description,
				// OWM reports rain in mm regardless of the units parameter.
				precip: (daily.rain ? daily.rain : 0) / 25.4,
				...(typeof daily.pop === "number" ? { pop: Math.round(daily.pop * 100) } : {}),
				...(typeof daily.humidity === "number" ? { humidity: daily.humidity } : {}),
				...(typeof daily.wind_speed === "number" ? { wind: daily.wind_speed } : {}),
				...(typeof daily.uvi === "number" ? { uv: daily.uvi } : {})
			});
		}

		if ( Array.isArray( weatherData.hourly ) ) {
			const hourly = [] as NonNullable< WeatherData["hourly"] >;
			for ( const hourlyData of weatherData.hourly.slice( 0, 24 ) ) {
				if ( !finite( hourlyData.dt ) || !finite( hourlyData.temp ) ) continue;
				const rain = finite( hourlyData.rain?.["1h"] ) ? hourlyData.rain["1h"] : 0;
				const snow = finite( hourlyData.snow?.["1h"] ) ? hourlyData.snow["1h"] : 0;
				const hour: NonNullable< WeatherData["hourly"] >[number] = {
					time: hourlyData.dt,
					temp: hourlyData.temp,
					// OWM reports hourly rain and snow in millimetres even with imperial units.
					precip: ( rain + snow ) / 25.4,
					icon: typeof hourlyData.weather?.[0]?.icon === "string" ? hourlyData.weather[0].icon : "50d"
				};
				if ( finite( hourlyData.pop ) ) hour.pop = Math.round( hourlyData.pop * 100 );
				hourly.push( hour );
			}
			if ( hourly.length > 0 ) weather.hourly = hourly;
		}

		return normalizeWeatherData( "OWM", weather );
	}

	async getEToData(coordinates: GeoCoordinates, pws?: PWS): Promise<EToData> {

		const localKey = keyToUse(this.API_KEY, pws);

		// The OWM API changed what you get on the free subscription so need to adjust the call and translate the data.
		//Get previous date by using UTC
		const timezone = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ] ).utcOffset();
		let time = Date.now();
		time -= (86400000 + timezone * 3600);
		const date = new Date(time);
		let day = this.pad(date.getUTCDate());
		let month = this.pad(date.getUTCMonth() + 1);

		const historicUrl = `https://api.openweathermap.org/data/3.0/onecall/day_summary?units=imperial&appid=${ localKey }&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${date.getUTCFullYear()}-${month}-${day}`;
		const todayUrl = `https://api.openweathermap.org/data/3.0/onecall?units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&exclude=minutely,hourly,daily,alerts&appid=${ localKey }`;


		// Perform the HTTP request to retrieve the weather data
		let historicData, todayData;
		try {
			historicData = await httpJSONRequest(historicUrl);
			todayData = await httpJSONRequest(todayUrl);
		} catch (err) {
			console.error( "Error retrieving ETo information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate ETo data could not be retrieved if the forecast data is incomplete.
		if ( !historicData || !todayData ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		let clouds = [historicData.cloud_cover.afternoon, todayData.current.clouds];

		const cloudCoverInfo: CloudCoverInfo[] = clouds.map( ( sample ): CloudCoverInfo => {
			if( sample === undefined ) {
				return {
					startTime: moment(),
					endTime: moment(),
					cloudCover: 0
				}
			}
			return {
				startTime: moment(),
				endTime: moment().add( 1, "hours" ),
				cloudCover: sample / 100
			}
		})

		return {
			weatherProvider: "OWM",
			periodStartTime: time,
			minTemp: historicData.temperature.min,
			maxTemp: historicData.temperature.max,
			minHumidity: (historicData.humidity.afternoon < todayData.current.humidity ? historicData.humidity.afternoon : todayData.current.humidity),
			maxHumidity: (historicData.humidity.afternoon > todayData.current.humidity ? historicData.humidity.afternoon : todayData.current.humidity),
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			// Use current wind speed as previous day only returns max for the day
			windSpeed: todayData.current.wind_speed,
			// OWM always returns precip in mm, so it must be converted.
			precip: historicData.precipitation.total / 25.4
		};
	}

	pad(number: number){
		return (number<10 ? "0" + number.toString() : number.toString());
	}
}
