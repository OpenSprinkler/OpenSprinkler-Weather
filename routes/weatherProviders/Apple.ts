import * as moment from "moment-timezone";
import * as jwt from "jsonwebtoken";

import { GeoCoordinates, WeatherData, WateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class AppleWeatherProvider extends WeatherProvider {

	private readonly API_KEY: string;

	public constructor() {
		super();

        if (!process.env.APPLE_PRIVATE_KEY) {
            return;
	}

		this.API_KEY = jwt.sign(
            { sub: process.env.APPLE_SERVICE_ID },
            process.env.APPLE_PRIVATE_KEY,
            {
              jwtid: `${process.env.APPLE_TEAM_ID}.${process.env.APPLE_SERVICE_ID}`,
              issuer: process.env.APPLE_TEAM_ID,
              expiresIn: "10y",
              keyid: process.env.APPLE_KEY_ID,
              algorithm: "ES256",
              header: { id: `${process.env.APPLE_TEAM_ID}.${process.env.APPLE_SERVICE_ID}` }
            }
          );
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< WateringData[] > {
		// The Unix timestamp of 10 days ago.
		const historicTimestamp: string = moment().subtract( 240, "hours" ).toISOString();

        const historicUrl = `https://weatherkit.apple.com/api/v1/weather/en/${ coordinates[ 0 ] }/${ coordinates[ 1 ] }?dataSets=forecastHourly,forecastDaily&hourlyStart=${historicTimestamp}&dailyStart=${historicTimestamp}&dailyEnd=${moment().toISOString()}&timezone=UTC`

		let historicData;
		try {
			historicData = await httpJSONRequest( historicUrl, {Authorization: `Bearer ${this.API_KEY}`} );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Apple:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData.forecastHourly || !historicData.forecastHourly.hours ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const hours = historicData.forecastHourly.hours;
		const days = historicData.forecastDaily.days;

        // Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if ( hours.length < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		// Cut hours down into full 24 hour section
		hours.splice(0, hours.length % 24);
		const daysInHours = [];
		for ( let i = 0; i < hours.length; i+=24 ){
			daysInHours.push(hours.slice(i, i+24));
		}

		// Cut days down to match number of hours
		days.splice(0, days.length - daysInHours.length);

		// Pull data for each day of the given interval
		const data = [];
		for ( let i = 0; i < daysInHours.length; i++ ){
			let temp: number = 0, humidity: number = 0,
				minHumidity: number = undefined, maxHumidity: number = undefined;

			const cloudCoverInfo: CloudCoverInfo[] = daysInHours[i].map( ( hour ): CloudCoverInfo => {
				return {
					startTime: moment( hour.forecastStart ),
					endTime: moment( hour.forecastStart ).add( 1, "hours" ),
					cloudCover: hour.cloudCover
				};
			} );

			for ( const hour of daysInHours[i] ) {
				/*
				* If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
				* calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
				* calculated when data is missing from some samples (since they follow diurnal cycles and will be
				* significantly skewed if data is missing for several consecutive hours).
				*/
				temp += this.celsiusToFahrenheit(hour.temperature);
				humidity += hour.humidity;

				// ETo should skip NaN humidity
				if ( hour.humidity === undefined ) {
					continue;
				}

				// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
				minHumidity = minHumidity < hour.humidity ? minHumidity : hour.humidity;
				maxHumidity = maxHumidity > hour.humidity ? maxHumidity : hour.humidity;
			}

			const length = daysInHours[i].length;
			const windSpeed = ( days[i].daytimeForecast.windSpeed + days[i].overnightForecast.windSpeed ) / 2;

			data.push({
				weatherProvider: "Apple",
				temp: temp / length,
				humidity: humidity / length * 100,
				raining: (i < daysInHours.length - 1) ? false : daysInHours[i][length-1].precipitationIntensity > 0,
				periodStartTime: moment(historicData.forecastDaily.days[ i ].forecastStart).unix(),
				minTemp: this.celsiusToFahrenheit( historicData.forecastDaily.days[ i ].temperatureMin ),
				maxTemp: this.celsiusToFahrenheit( historicData.forecastDaily.days[ i ].temperatureMax ),
				minHumidity: minHumidity * 100,
				maxHumidity: maxHumidity * 100,
				solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
				// Assume wind speed measurements are taken at 2 meters.
				windSpeed: this.kphToMph( windSpeed ),
				precip: this.mmToInchesPerHour( historicData.forecastDaily.days[ i ].precipitationAmount || 0 )
			});
		}

		return data;

	}

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
        const forecastUrl = `https://weatherkit.apple.com/api/v1/weather/en/${ coordinates[ 0 ] }/${ coordinates[ 1 ] }?dataSets=currentWeather,forecastDaily&timezone=UTC`

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl, {Authorization: `Bearer ${this.API_KEY}`} );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Apple:", err );
			throw "An error occurred while retrieving weather information from Apple."
		}

		if ( !forecast.currentWeather || !forecast.forecastDaily || !forecast.forecastDaily.days ) {
			throw "Necessary field(s) were missing from weather information returned by Apple.";
		}

		const weather: WeatherData = {
			weatherProvider: "Apple",
			temp: Math.floor( this.celsiusToFahrenheit( forecast.currentWeather.temperature ) ),
			humidity: Math.floor( forecast.currentWeather.humidity * 100 ),
			wind: Math.floor( this.kphToMph( forecast.currentWeather.windSpeed ) ),
			raining: forecast.currentWeather.precipitationIntensity > 0,
			description: forecast.currentWeather.conditionCode,
			icon: this.getOWMIconCode( forecast.currentWeather.conditionCode ),

			region: "",
			city: "",
			minTemp: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ 0 ].temperatureMin ) ),
			maxTemp: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ 0 ].temperatureMax ) ),
			precip: this.mmToInchesPerHour( forecast.forecastDaily.days[0].precipitationAmount ),
			forecast: []
		};

		for ( let index = 0; index < forecast.forecastDaily.days.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ index ].temperatureMin ) ),
				temp_max: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ index ].temperatureMax ) ),
				precip: this.mmToInchesPerHour( forecast.forecastDaily.days[ index ].precipitationAmount),
				date: moment(forecast.forecastDaily.days[ index ].forecastStart).unix(),
				icon: this.getOWMIconCode( forecast.forecastDaily.days[ index ].conditionCode ),
				description: forecast.forecastDaily.days[ index ].conditionCode
			} );
		}

		return weather;
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

	private getOWMIconCode(icon: string) {
		switch(icon.toLowerCase()) {
            case "mostlyclear":
			case "partlycloudy":
				return "02n";
            case "mostlycloudy":
			case "cloudy":
            case "smokey":
				return "03d";
			case "foggy":
            case "haze":
			case "windy":
            case "breezy":
				return "50d";
			case "sleet":
			case "snow":
            case "frigid":
            case "hail":
            case "flurries":
            case "sunflurries":
            case "wintrymix":
            case "blizzard":
            case "blowingsnow":
            case "freezingdrizzle":
            case "freezingrain":
            case "heavysnow":
				return "13d";
			case "rain":
            case "drizzle":
            case "heavyrain":
            case "isolatedthunderstorms":
            case "sunshowers":
            case "scatteredthunderstorms":
            case "strongstorms":
            case "thunderstorms":
				return "10d";
			case "clear":
			default:
				return "01d";
		}
	}

    private celsiusToFahrenheit(celsius) {
        return (celsius * 9/5) + 32;
    }

    private mmToInchesPerHour(mmPerHour) {
        return  mmPerHour * 0.03937007874;
    }

    private kphToMph(kph) {
        return kph * 0.621371;
      }

}
