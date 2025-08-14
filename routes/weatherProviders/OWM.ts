import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { httpJSONRequest, keyToUse } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";
import { CodedError, ErrorCode } from "../../errors";

export default class OWMWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.OWM_API_KEY;
	}

	protected async getWateringDataInternal(coordinates: GeoCoordinates, pws: PWS | undefined): Promise<WateringData[]> {

		const localKey = keyToUse(this.API_KEY, pws);

		//Get previous date by using UTC
		const tz = geoTZ.find(coordinates[0], coordinates[1])[0];
		const yesterdayTimestamp: string = moment().tz(tz).startOf("day").subtract( 1, "day" ).format("YYYY-MM-DD");

		// TODO: specific tz to make sure it's using the correct time zone
		const yesterdayUrl = `https://api.openweathermap.org/data/3.0/onecall/day_summary?units=imperial&appid=${ localKey }&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&date=${yesterdayTimestamp}`;

		// Perform the HTTP request to retrieve the weather data
		let historicData;
		try {
			historicData = await httpJSONRequest(yesterdayUrl);
		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Indicate watering data could not be retrieved if the forecast data is incomplete.
		if ( !historicData ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		let clouds = (new Array(24)).fill(historicData.cloud_cover.afternoon);

		// TODO: need
		const cloudCoverInfo: CloudCoverInfo[] = clouds.map( ( sample, i ): CloudCoverInfo => {
			const start = moment().tz(tz).startOf('day').subtract(1, 'day').add(i, 'hour');
			if( sample === undefined ) {
				return {
					startTime: start,
					endTime: start,
					cloudCover: 0
				}
			}
			return {
				startTime: start,
				endTime: start.clone().add( 1, "hour" ),
				cloudCover: sample / 100
			}
		});

		let temp = historicData.temperature;

		let totalTemp = temp.min + temp.max + temp.afternoon + temp.night + temp.evening + temp.morning;

		return [{
			weatherProvider: "OWM",
			temp: totalTemp / 6,
			humidity: historicData.humidity.afternoon,
			// OWM always returns precip in mm, so it must be converted.
			precip: historicData.precipitation.total / 25.4,
			periodStartTime: Number(moment().subtract(1, "day").format("X")),
			minTemp: historicData.temperature.min,
			maxTemp: historicData.temperature.max,
			minHumidity: historicData.humidity.afternoon,
			maxHumidity: historicData.humidity.afternoon,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			// Use max of yesterday divided by 2 as ballpark estimate since the API only provides max and not min
			windSpeed: historicData.wind.max.speed / 2,
		}];
	}

	protected async getWeatherDataInternal(coordinates: GeoCoordinates, pws: PWS | undefined): Promise<WeatherData> {

		const localKey = keyToUse(this.API_KEY, pws);

		// The OWM free API options changed so need to use the new API method
		const weatherDataUrl = `https://api.openweathermap.org/data/3.0/onecall?units=imperial&lat=${ coordinates[ 0 ] }&lon=${ coordinates[ 1 ] }&exclude=minutely,hourly,alerts&appid=${ localKey }`

		let weatherData;
		try {
			weatherData = await httpJSONRequest(weatherDataUrl);

		} catch ( err ) {
			console.error( "Error retrieving weather information from OWM:", err );
			throw "An error occurred while retrieving weather information from OWM."
		}

		// Indicate weather data could not be retrieved if the forecast data is incomplete.
		if (!weatherData || !weatherData.current || !weatherData.daily) {
			throw "Necessary field(s) were missing from weather information returned by OWM.";
		}

		const weather: WeatherData = {
			weatherProvider: "OWM",
			temp: weatherData.current.temp,
			humidity: weatherData.current.humidity,
			wind: weatherData.current.wind_speed,
			raining: weatherData.current.rain,
			description: weatherData.current.weather[0].description,
			icon: weatherData.current.weather[0].icon,

			region: "",
			city: "",
			minTemp: weatherData.daily[0].temp.min,
			maxTemp: weatherData.daily[0].temp.max,
			precip: (weatherData.daily[0].rain ? weatherData.daily[0].rain : 0) / 25.4,
			forecast: []
		};

		for (let index = 0; index < weatherData.daily.length; index++) {
			weather.forecast.push({
				temp_min: weatherData.daily[index].temp.min,
				temp_max: weatherData.daily[index].temp.max,
				precip: (weatherData.daily[index].rain ? weatherData.daily[index].rain : 0) / 25.4,
				date: weatherData.daily[index].dt,
				icon: weatherData.daily[index].weather[0].icon,
				description: weatherData.daily[index].weather[0].description
			});
		}

		return weather;
	}

	pad(number: number){
		return (number<10 ? "0" + number.toString() : number.toString());
	}
}
