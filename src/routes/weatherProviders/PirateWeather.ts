import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { getTZ, httpJSONRequest, keyToUse, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addHours, fromUnixTime, getUnixTime, startOfDay, subDays } from "date-fns";
import { averageFinite, completeHistoricalHourlyDays, finiteValues, maxFinite, minFinite, sumFinite } from "./providerUtils";

interface PirateWeatherHour {
	time: number;
	temperature?: number;
	humidity?: number;
	dewPoint?: number;
	liquidAccumulation?: number;
	cloudCover?: number;
	windSpeed?: number;
}

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

		const yesterdayUrl = `https://timemachine.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] },${ getUnixTime(yesterday) }?exclude=currently,minutely,alerts&units=ca&version=2`;

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

		const days = completeHistoricalHourlyDays<PirateWeatherHour>(
			historicData.hourly.data as PirateWeatherHour[],
			hour => hour.time * 1000,
			getTZ(coordinates),
			startOfDay(localTime(coordinates)),
			1
		);
		if (!days.length) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}
		const samples = days[0].records;

		const cloudCoverInfo: CloudCoverInfo[] = samples.map( ( hour ): CloudCoverInfo => {
            const startTime = fromUnixTime(hour.time);
			return {
				startTime,
				endTime: addHours(startTime, 1),
				cloudCover: hour.cloudCover
			};
		} );

		const temperatures = finiteValues(samples.map(hour => hour.temperature));
		const humidities = finiteValues(samples.map(hour => Number.isFinite(hour.humidity)
			? hour.humidity
			: this.humidityFromDewPoint(hour.temperature, hour.dewPoint)));
		const windSpeeds = finiteValues(samples.map(hour => hour.windSpeed));
		const liquidAccumulation = sumFinite(samples.map(hour => hour.liquidAccumulation ?? 0));

		if (temperatures.length !== samples.length || humidities.length !== samples.length ||
			windSpeeds.length === 0 || liquidAccumulation === undefined) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		return [{
			weatherProvider: "PW",
			temp: this.celsiusToFahrenheit(averageFinite(temperatures)),
			humidity: averageFinite(humidities) * 100,
			precip: this.cmToInches(liquidAccumulation),
			periodStartTime: samples[0].time,
			minTemp: this.celsiusToFahrenheit(minFinite(temperatures)),
			maxTemp: this.celsiusToFahrenheit(maxFinite(temperatures)),
			minHumidity: minFinite(humidities) * 100,
			maxHumidity: maxFinite(humidities) * 100,
			solarRadiation: approximateSolarRadiation( cloudCoverInfo, coordinates ),
			// Pirate Weather does not document the measurement height for this field.
			windSpeed: this.kphToMph(averageFinite(windSpeeds))
		}];
	}

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {

		const localKey = keyToUse( this.API_KEY, pws);

		const forecastUrl = `https://api.pirateweather.net/forecast/${ localKey }/${ coordinates[ 0 ] },${ coordinates[ 1 ] }?units=us&exclude=minutely,hourly,alerts&version=2`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastUrl );
		} catch ( err ) {
			console.error( "Error retrieving weather information from PirateWeather:", err );
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
			throw new CodedError(ErrorCode.MissingWeatherField);
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
			precip: forecast.daily.data[ 0 ].liquidAccumulation ?? forecast.daily.data[ 0 ].precipIntensity * 24,
			forecast: []
		};

		for ( let index = 0; index < forecast.daily.data.length; index++ ) {
			weather.forecast.push( {
				temp_min: Math.floor( forecast.daily.data[ index ].temperatureMin ),
				temp_max: Math.floor( forecast.daily.data[ index ].temperatureMax ),
				precip: forecast.daily.data[ index ].liquidAccumulation ?? forecast.daily.data[ index ].precipIntensity * 24,
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

	private cmToInches(cm: number): number {
		return cm / 2.54;
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

		return Math.exp(eFn(dewPoint) - eFn(temperature));
    }
}
