import * as moment from "moment-timezone";
import * as jwt from "jsonwebtoken";

import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class AppleWeatherProvider extends WeatherProvider {

	private readonly API_KEY: string;

	public constructor() {
		super();

        if (!process.env.APPLE_PRIVATE_KEY) {
			throw "APPLE_PRIVATE_KEY environment variable is not defined.";
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

	public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData > {
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp: string = moment().subtract( 1, "day" ).toISOString();

        const yesterdayUrl = `https://weatherkit.apple.com/api/v1/weather/en/${ coordinates[ 0 ] }/${ coordinates[ 1 ] }?dataSets=forecastHourly&hourlyStart=${yesterdayTimestamp}&timezone=UTC`

		let yesterdayData;
		try {
			yesterdayData = await httpJSONRequest( yesterdayUrl, {Authorization: `Bearer ${this.API_KEY}`} );
		} catch ( err ) {
			console.error( "Error retrieving weather information from Apple:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !yesterdayData.forecastHourly || !yesterdayData.forecastHourly.hours ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		const samples = [
			...yesterdayData.forecastHourly.hours
		];

        // Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if ( samples.length < 23 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const totals = { temp: 0, humidity: 0, precip: 0 };
		for ( const sample of samples ) {
			/*
			 * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
			 * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
			 * calculated when data is missing from some samples (since they follow diurnal cycles and will be
			 * significantly skewed if data is missing for several consecutive hours).
			 */
			totals.temp += this.celsiusToFahrenheit(sample.temperature);
			totals.humidity += sample.humidity;
			// This field may be missing from the response if it is snowing.
			totals.precip += this.mmToInchesPerHour(sample.precipitationIntensity || 0);
		}

		return {
			weatherProvider: "Apple",
			temp: totals.temp / samples.length,
			humidity: totals.humidity / samples.length * 100,
			precip: totals.precip,
			raining: samples[ samples.length - 1 ].precipitationIntensity > 0
		};
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
			description: forecast.currentWeather.conditionCode,
			icon: this.getOWMIconCode( forecast.currentWeather.conditionCode ),

			region: "",
			city: "",
			minTemp: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ 0 ].temperatureMin ) ),
			maxTemp: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ 0 ].temperatureMax ) ),
			precip: this.mmToInchesPerHour( forecast.currentWeather.precipitationIntensity ) * 24,
			forecast: []
		};

		for ( let index = 0; index < forecast.forecastDaily.days.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ index ].temperatureMin ) ),
				temp_max: Math.floor( this.celsiusToFahrenheit( forecast.forecastDaily.days[ index ].temperatureMax ) ),
				date: moment(forecast.forecastDaily.days[ index ].forecastStart).unix(),
				icon: this.getOWMIconCode( forecast.forecastDaily.days[ index ].conditionCode ),
				description: forecast.forecastDaily.days[ index ].conditionCode
			} );
		}

		return weather;
	}

	public async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp: string = moment().subtract( 1, "day" ).toISOString();

        const yesterdayUrl = `https://weatherkit.apple.com/api/v1/weather/en/${ coordinates[ 0 ] }/${ coordinates[ 1 ] }?dataSets=forecastHourly,forecastDaily&hourlyStart=${yesterdayTimestamp}&dailyStart=${yesterdayTimestamp}&dailyEnd=${moment().toISOString()}&timezone=UTC`

		let historicData;
		try {
			historicData = await httpJSONRequest( yesterdayUrl, {Authorization: `Bearer ${this.API_KEY}`} );
		} catch (err) {
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const cloudCoverInfo: CloudCoverInfo[] = historicData.forecastHourly.hours.map( ( hour ): CloudCoverInfo => {
			return {
				startTime: moment( hour.forecastStart ),
				endTime: moment( hour.forecastStart ).add( 1, "hours" ),
				cloudCover: hour.cloudCover
			};
		} );

		let minHumidity: number = undefined, maxHumidity: number = undefined;
		for ( const hour of historicData.forecastHourly.hours ) {
			// Skip hours where humidity measurement does not exist to prevent result from being NaN.
			if ( hour.humidity === undefined ) {
				continue;
			}

			// If minHumidity or maxHumidity is undefined, these comparisons will yield false.
			minHumidity = minHumidity < hour.humidity ? minHumidity : hour.humidity;
			maxHumidity = maxHumidity > hour.humidity ? maxHumidity : hour.humidity;
		}

		return {
			weatherProvider: "Apple",
			periodStartTime: moment(historicData.forecastHourly.hours[ 0 ].forecastStart).unix(),
			minTemp: this.celsiusToFahrenheit( historicData.forecastDaily.days[ 0 ].temperatureMin ),
			maxTemp: this.celsiusToFahrenheit( historicData.forecastDaily.days[ 0 ].temperatureMax ),
			minHumidity: minHumidity * 100,
			maxHumidity: maxHumidity * 100,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: this.kphToMph( historicData.forecastDaily.days[ 0 ].windSpeed ),
			precip: this.mmToInchesPerHour( historicData.forecastDaily.days[ 0 ].precipIntensity || 0 ) * 24
		};
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
