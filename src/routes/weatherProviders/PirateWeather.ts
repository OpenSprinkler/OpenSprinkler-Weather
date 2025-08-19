import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { httpJSONRequest, keyToUse, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addDays, fromUnixTime, getUnixTime, startOfDay, subDays } from "date-fns";

export default class PirateWeatherWeatherProvider extends WeatherProvider {

	private API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.PIRATEWEATHER_API_KEY;
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		// The Unix timestamp of 24 hours ago.
        const yesterday = subDays(startOfDay(localTime(coordinates)), 1);

		const localKey = keyToUse(this.API_KEY, pws);

		// PW's timemachine API is broken currently, so we have to use the forecast API, which only gives the most recent 24 hours
		// const yesterdayUrl = `https://timemachine.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ getUnixTime(yesterday) }?exclude=currently,minutely,alerts`;
		const yesterdayUrl = `https://api.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ getUnixTime(subDays(new Date(), 1)) }?exclude=currently,minutely,alerts`;

		let historicData;
		try {
			historicData = await httpJSONRequest( yesterdayUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from PirateWeather:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData.hourly || !historicData.hourly.data ) {
			throw new CodedError( ErrorCode.MissingWeatherField );
		}

		let samples = [
			...historicData.hourly.data
		];

		// Fail if not enough data is available.
		if ( samples.length < 24 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		//returns 48 hours (first 24 are historical so only loop those)
		samples = samples.slice(0,24);

		const cloudCoverInfo: CloudCoverInfo[] = samples.map( ( hour ): CloudCoverInfo => {
            const startTime = fromUnixTime(hour.time);
			return {
				startTime,
				endTime: addDays(startTime, 1),
				cloudCover: hour.cloudCover
			};
		} );

		let temp: number = 0, humidity: number = 0, precip: number = 0,
			minHumidity: number = undefined, maxHumidity: number = undefined;
		for ( const hour of samples ) {
			/*
			 * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
			 * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
			 * calculated when data is missing from some samples (since they follow diurnal cycles and will be
			 * significantly skewed if data is missing for several consecutive hours).
			 */

			temp += hour.temperature;
            const currentHumidity = hour.humidity || this.humidityFromDewPoint(hour.temperature, hour.dewPoint);
            console.log(hour.humidity, this.humidityFromDewPoint(hour.temperature, hour.dewPoint));
			humidity += currentHumidity;
			// This field may be missing from the response if it is snowing.
			precip += hour.precipAccumulation || 0;

			// Skip hours where humidity measurement does not exist to prevent ETo result from being NaN.
			if ( currentHumidity !== undefined ) {
				minHumidity = minHumidity < currentHumidity ? minHumidity : currentHumidity;
				maxHumidity = maxHumidity > currentHumidity ? maxHumidity : currentHumidity;
			}
		}

		return [{
			weatherProvider: "PW",
			temp: temp / samples.length,
			humidity: humidity / samples.length * 100,
			precip: this.mmToInchesPerHour(precip),
			periodStartTime: historicData.hourly.data[ 0 ].time,
			minTemp: this.celsiusToFahrenheit(historicData.daily.data[ 0 ].temperatureMin),
			maxTemp: this.celsiusToFahrenheit(historicData.daily.data[ 0 ].temperatureMax),
			minHumidity: minHumidity * 100,
			maxHumidity: maxHumidity * 100,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: this.kphToMph(historicData.daily.data[ 0 ].windSpeed)
		}];
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {

		const localKey = keyToUse( this.API_KEY, pws);

		const forecastUrl = `https://api.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] }?units=us&exclude=minutely,hourly,alerts`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from PirateWeather:", err );
			throw "An error occurred while retrieving weather information from PirateWeather."
		}

		if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
			throw "Necessary field(s) were missing from weather information returned by PirateWeather.";
		}

		const weather: WeatherData = {
			weatherProvider: "PirateWeather",
			temp: Math.floor( forecast.currently.temperature ),
			humidity: Math.floor( forecast.currently.humidity * 100 ),
			wind: Math.floor( forecast.currently.windSpeed ),
			raining: forecast.currently.precipIntensity > 0,
			description: forecast.currently.summary,
			icon: this.getOWMIconCode( forecast.currently.icon ),

			region: "",
			city: "",
			minTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMin ),
			maxTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMax ),
			precip: forecast.daily.data[ 0 ].precipIntensity * 24,
			forecast: []
		};

		for ( let index = 0; index < forecast.daily.data.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( forecast.daily.data[ index ].temperatureMin ),
				temp_max: Math.floor( forecast.daily.data[ index ].temperatureMax ),
				precip: forecast.daily.data[ index ].precipIntensity * 24,
				date: forecast.daily.data[ index ].time,
				icon: this.getOWMIconCode( forecast.daily.data[ index ].icon ),
				description: forecast.daily.data[ index ].summary
			} );
		}

		return weather;
	}

	public shouldCacheWateringScale(): boolean {
		return true;
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

    private celsiusToFahrenheit(celsius: number): number {
		return (celsius * 9) / 5 + 32;
	}

	private mmToInchesPerHour(mmPerHour: number): number {
		return mmPerHour * 0.03937007874;
	}

	private kphToMph(kph: number): number {
		return kph * 0.621371;
	}

    //https://www.npl.co.uk/resources/q-a/dew-point-and-relative-humidity
    private eLn(temperature: number, a: number, b: number): number {
        return Math.log(611.2) + ((a * temperature) / (b + temperature));
    }

    private eWaterLn(temperature: number): number {
        return this.eLn(temperature, 17.62, 243.12);
    }
    private eIceLn(temperature: number): number {
        return this.eLn(temperature, 22.46, 272.62);
    }

    private humidityFromDewPoint(temperature: number, dewPoint: number): number {
        if (isNaN(temperature)) return temperature;
        if (isNaN(dewPoint)) return dewPoint;

        let eFn: (temp: number) => number;

        if (temperature > 0) {
            eFn = (temp: number) => this.eWaterLn(temp);
        } else {
            eFn = (temp: number) => this.eIceLn(temp);
        }

        return 100 * Math.exp(eFn(dewPoint) - eFn(temperature));
    }
}
