import { importPKCS8, SignJWT } from "jose";

import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { getTZ, httpJSONRequest, localTime } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import {
	approximateSolarRadiation,
	CloudCoverInfo,
} from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { addHours, getUnixTime, startOfDay, subDays } from "date-fns";
import { TZDate } from "@date-fns/tz";
import {
	averageFinite,
	completeHistoricalHourlyDays,
	localDateKey,
	maxFinite,
	minFinite,
} from "./providerUtils";

type UnitsSystem = "m";
type MoonPhase = "new" | "waxingCrescent" | "firstQuarter" | "waxingGibbous" | "full" | "waningGibbous" | "thirdQuarter" | "waningCrescent";
type PrecipitationType = "clear" | "precipitation" | "rain" | "snow" | "sleet" | "hail" | "mixed";
type PressureTrend = "rising" | "falling" | "steady";
type Certainty = "observed" | "likely" | "possible" | "unlikely" | "unknown";
type AlertResponseType = "shelter" | "evacuate" | "prepare" | "execute" | "avoid" | "monitor" | "assess" | "allClear" | "none";
type Severity = "extreme" | "severe" | "moderate" | "minor" | "unknown";
type Urgency = "immediate" | "expected" | "future" | "past" | "unknown";

interface Metadata {
  attributionURL?: string; // URL of the legal attribution for the data source
  expireTime: string; // ISO 8601 date-time; required
  language?: string; // ISO language code
  latitude: number; // Required
  longitude: number; // Required
  providerLogo?: string; // URL for provider logo
  providerName?: string; // Name of the data provider
  readTime: string; // ISO 8601 date-time; required
  reportedTime?: string; // ISO 8601 date-time
  temporarilyUnavailable?: boolean; // True if provider data is temporarily unavailable
  units?: UnitsSystem; // Units system (e.g., metric)
  version: number; // Required; format version
}

interface CurrentWeather {
    name: string,
    metadata: Metadata,
    asOf: string; // Required; ISO 8601 date-time
    cloudCover?: number; // Optional; 0 to 1
    conditionCode: string; // Required; enumeration of weather condition
    daylight?: boolean; // Optional; indicates daylight
    humidity: number; // Required; 0 to 1
    precipitationIntensity: number; // Required; in mm/h
    pressure: number; // Required; in millibars
    pressureTrend: PressureTrend; // Required; direction of pressure change
    temperature: number; // Required; in °C
    temperatureApparent: number; // Required; feels-like temperature in °C
    temperatureDewPoint: number; // Required; in °C
    uvIndex: number; // Required; UV radiation level
    visibility: number; // Required; in meters
    windDirection?: number; // Optional; in degrees
    windGust?: number; // Optional; max wind gust speed in km/h
    windSpeed: number; // Required; in km/h
}

interface DayPartForecast {
    cloudCover: number; // Required; 0 to 1
    conditionCode: string; // Required; enumeration of weather condition
    forecastEnd: string; // Required; ISO 8601 date-time
    forecastStart: string; // Required; ISO 8601 date-time
    humidity: number; // Required; 0 to 1
    precipitationAmount: number; // Required; in millimeters
    precipitationChance: number; // Required; as a percentage
    precipitationType: PrecipitationType; // Required
    snowfallAmount: number; // Required; in millimeters
    windDirection?: number; // Optional; in degrees
    windSpeed: number; // Required; in km/h
}

interface DailyForecastData {
  conditionCode: string; // Required; condition at the time
  daytimeForecast?: DayPartForecast; // Forecast between 7 AM and 7 PM
  forecastEnd: string; // Required; ISO 8601 date-time
  forecastStart: string; // Required; ISO 8601 date-time
  maxUvIndex: number; // Required; maximum UV index
  moonPhase: MoonPhase; // Required; phase of the moon
  moonrise?: string; // ISO 8601 date-time
  moonset?: string; // ISO 8601 date-time
  overnightForecast?: DayPartForecast; // Forecast between 7 PM and 7 AM
  precipitationAmount: number; // Required; in millimeters
  precipitationChance: number; // Required; as a percentage
  precipitationType: PrecipitationType; // Required
  snowfallAmount: number; // Required; in millimeters
  solarMidnight?: string; // ISO 8601 date-time
  solarNoon?: string; // ISO 8601 date-time
  sunrise?: string; // ISO 8601 date-time
  sunriseAstronomical?: string; // ISO 8601 date-time
  sunriseCivil?: string; // ISO 8601 date-time
  sunriseNautical?: string; // ISO 8601 date-time
  sunset?: string; // ISO 8601 date-time
  sunsetAstronomical?: string; // ISO 8601 date-time
  sunsetCivil?: string; // ISO 8601 date-time
  sunsetNautical?: string; // ISO 8601 date-time
  temperatureMax: number; // Required; in °C
  temperatureMin: number; // Required; in °C
}

interface DailyForecast {
    name: string,
    metadata: Metadata,
    days: DailyForecastData[];
}

interface HourWeatherConditions {
  cloudCover: number; // Required; 0 to 1
  conditionCode: string; // Required; enumeration of weather condition
  daylight?: boolean; // Indicates whether the hour is during day or night
  forecastStart: string; // Required; ISO 8601 date-time
  humidity: number; // Required; 0 to 1
  precipitationChance: number; // Required; 0 to 1
  precipitationType: PrecipitationType; // Required
  pressure: number; // Required; in millibars
  pressureTrend?: PressureTrend; // Optional; direction of pressure change
  snowfallIntensity?: number; // Optional; in mm/h
  temperature: number; // Required; in °C
  temperatureApparent: number; // Required; feels-like temperature in °C
  temperatureDewPoint?: number; // Optional; in °C
  uvIndex: number; // Required; UV radiation level
  visibility: number; // Required; in meters
  windDirection?: number; // Optional; in degrees
  windGust?: number; // Optional; max wind gust speed in km/h
  windSpeed: number; // Required; in km/h
  precipitationAmount?: number; // Optional; in mm
}

interface HourlyForecast {
    name: string,
    metadata: Metadata,
    hours: HourWeatherConditions[];
}

interface ForecastMinute {
  precipitationChance: number; // Required; probability of precipitation (0 to 1)
  precipitationIntensity: number; // Required; intensity in mm/h
  startTime: string; // Required; ISO 8601 date-time
}

interface ForecastPeriodSummary {
  condition: PrecipitationType; // Required; type of precipitation
  endTime?: string; // Optional; ISO 8601 date-time
  precipitationChance: number; // Required; probability of precipitation (0 to 1)
  precipitationIntensity: number; // Required; intensity in mm/h
  startTime: string; // Required; ISO 8601 date-time
}

interface NextHourForecast {
    name: string,
    metadata: Metadata,
    forecastEnd?: string; // ISO 8601 date-time
    forecastStart?: string; // ISO 8601 date-time
    minutes: ForecastMinute[]; // Required; array of forecast minutes
    summary: ForecastPeriodSummary[]; // Required; array of forecast summaries
}

interface WeatherAlertSummary {
    areaId?: string; // Official designation of the affected area
  areaName?: string; // Human-readable name of the affected area
  certainty: Certainty; // Required; likelihood of the event
  countryCode: string; // Required; ISO country code
  description: string; // Required; human-readable description
  detailsUrl?: string; // URL to detailed information
  effectiveTime: string; // Required; ISO 8601 date-time
  eventEndTime?: string; // ISO 8601 date-time
  eventOnsetTime?: string; // ISO 8601 date-time
  expireTime: string; // Required; ISO 8601 date-time
  id: string; // Required; UUID
  issuedTime: string; // Required; ISO 8601 date-time
  responses: AlertResponseType[]; // Required; recommended actions
  severity: Severity; // Required; danger level
  source: string; // Required; reporting agency
  urgency?: Urgency; // Optional; urgency of action
}

interface WeatherAlertCollection {
    name: string,
    metadata: Metadata,
    alerts: WeatherAlertSummary[];
}

interface AppleWeather {
  currentWeather: CurrentWeather; // The current weather for the requested location.
  forecastDaily: DailyForecast; // The daily forecast for the requested location.
  forecastHourly: HourlyForecast; // The hourly forecast for the requested location.
  forecastNextHour: NextHourForecast; // The next hour forecast for the requested location.
  weatherAlerts: WeatherAlertCollection; // Weather alerts for the requested location.
}

export default class AppleWeatherProvider extends WeatherProvider {
	private readonly API_KEY?: Promise<string>;

	public constructor() {
		super();

		if (!process.env.APPLE_PRIVATE_KEY) {
			return;
		}

		this.API_KEY = this.getKey();
	}

	private async getKey(): Promise<string> {
		const privateKey = await importPKCS8(
			process.env.APPLE_PRIVATE_KEY,
			"ES256"
		);

		return await new SignJWT({ sub: process.env.APPLE_SERVICE_ID })
			.setProtectedHeader({
				alg: "ES256",
				kid: process.env.APPLE_KEY_ID,
				id: `${process.env.APPLE_TEAM_ID}.${process.env.APPLE_SERVICE_ID}`, // custom header field
			})
			.setIssuer(process.env.APPLE_TEAM_ID)
			.setIssuedAt()
			.setExpirationTime("10y")
			.sign(privateKey);
	}

	protected getApiKey(): Promise<string> {
		if (!this.API_KEY) {
			throw new CodedError(ErrorCode.NoAPIKeyProvided);
		}
		return this.API_KEY;
	}

	protected async getWateringDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WateringData[]> {
		const currentDay = startOfDay(localTime(coordinates));

        const tz = getTZ(coordinates);

		const startTimestamp = new Date(+subDays(currentDay, 10)).toISOString();
		const endTimestamp = new Date(+currentDay).toISOString();

		const historicUrl = `https://weatherkit.apple.com/api/v1/weather/en/${
			coordinates[0]
		}/${
			coordinates[1]
		}?dataSets=forecastHourly,forecastDaily&currentAsOf=${endTimestamp}&hourlyStart=${startTimestamp}&hourlyEnd=${endTimestamp}&dailyStart=${startTimestamp}&dailyEnd=${endTimestamp}&timezone=${tz}`;

		const apiKey = await this.getApiKey();
		let historicData: AppleWeather;
		try {
			historicData = await httpJSONRequest(historicUrl, {
				Authorization: `Bearer ${apiKey}`,
			});
		} catch (err) {
			console.error("Error retrieving weather information from Apple:", err);
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if (!historicData.forecastHourly || !historicData.forecastHourly.hours) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const hours = historicData.forecastHourly.hours;
		const days = historicData.forecastDaily?.days;
		if (!days) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		// Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if (hours.length < 23) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		const daysInHours = completeHistoricalHourlyDays(
			hours,
			hour => hour.forecastStart,
			tz,
			currentDay,
			10
		);
		const dailyByDate = new Map(days.map(day => [localDateKey(day.forecastStart, tz), day]));
		if (!daysInHours.length) {
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		// Pull data for each day of the given interval
		const data = [];
		for (const dayGroup of daysInHours) {
			const day = dailyByDate.get(dayGroup.date);
			if (!day) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}
			const dayHours = dayGroup.records;
			const cloudCoverInfo: CloudCoverInfo[] = dayHours.map(
				(hour): CloudCoverInfo => {
                    const startTime = new TZDate(hour.forecastStart, tz);

					return {
						startTime,
						endTime: addHours(startTime, 1),
						cloudCover: hour.cloudCover,
					};
				}
			);
			const temp = averageFinite(dayHours.map(hour => hour.temperature));
			const humidity = averageFinite(dayHours.map(hour => hour.humidity));
			const minHumidity = minFinite(dayHours.map(hour => hour.humidity));
			const maxHumidity = maxFinite(dayHours.map(hour => hour.humidity));
			const windSpeed = averageFinite(dayHours.map(hour => hour.windSpeed));
			if ([temp, humidity, minHumidity, maxHumidity, windSpeed].some(value => !Number.isFinite(value))) {
				throw new CodedError(ErrorCode.InsufficientWeatherData);
			}

			data.push({
				weatherProvider: "Apple",
				temp: this.celsiusToFahrenheit(temp),
				humidity: humidity * 100,
				periodStartTime: getUnixTime(new Date(dayHours[0].forecastStart)),
				minTemp: this.celsiusToFahrenheit(day.temperatureMin),
				maxTemp: this.celsiusToFahrenheit(day.temperatureMax),
				minHumidity: minHumidity * 100,
				maxHumidity: maxHumidity * 100,
				solarRadiation: approximateSolarRadiation(cloudCoverInfo, coordinates),
				// WeatherKit does not document the measurement height for this field.
				windSpeed: this.kphToMph(windSpeed),
				precip: this.mmToInchesPerHour(day.precipitationAmount ?? 0),
			});
		}

		return data.reverse();
	}

	protected async getWeatherDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WeatherData> {
        const tz = getTZ(coordinates);

		const forecastUrl = `https://weatherkit.apple.com/api/v1/weather/en/${coordinates[0]}/${coordinates[1]}?dataSets=currentWeather,forecastDaily&timezone=${tz}`;

		const apiKey = await this.getApiKey();
		let forecast: AppleWeather;
		try {
			forecast = await httpJSONRequest(forecastUrl, {
				Authorization: `Bearer ${apiKey}`,
			});
		} catch (err) {
			console.error("Error retrieving weather information from Apple:", err);
			throw new CodedError(ErrorCode.WeatherApiError);
		}

		if (
			!forecast.currentWeather ||
			!forecast.forecastDaily ||
			!forecast.forecastDaily.days
		) {
			throw new CodedError(ErrorCode.MissingWeatherField);
		}

		const weather: WeatherData = {
			weatherProvider: "Apple",
			temp: Math.floor(
				this.celsiusToFahrenheit(forecast.currentWeather.temperature)
			),
			humidity: Math.floor(forecast.currentWeather.humidity * 100),
			wind: Math.floor(this.kphToMph(forecast.currentWeather.windSpeed)),
			raining: forecast.currentWeather.precipitationIntensity > 0,
			description: forecast.currentWeather.conditionCode,
			icon: this.getOWMIconCode(forecast.currentWeather.conditionCode),

			region: "",
			city: "",
			minTemp: Math.floor(
				this.celsiusToFahrenheit(forecast.forecastDaily.days[0].temperatureMin)
			),
			maxTemp: Math.floor(
				this.celsiusToFahrenheit(forecast.forecastDaily.days[0].temperatureMax)
			),
			precip: this.mmToInchesPerHour(
				forecast.forecastDaily.days[0].precipitationAmount
			),
			forecast: [],
			...this.getAttribution(forecast.currentWeather.metadata),
		};

		for (let index = 0; index < forecast.forecastDaily.days.length; index++) {
			weather.forecast.push({
				temp_min: Math.floor(
					this.celsiusToFahrenheit(
						forecast.forecastDaily.days[index].temperatureMin
					)
				),
				temp_max: Math.floor(
					this.celsiusToFahrenheit(
						forecast.forecastDaily.days[index].temperatureMax
					)
				),
				precip: this.mmToInchesPerHour(
					forecast.forecastDaily.days[index].precipitationAmount
				),
				date: getUnixTime(new TZDate(forecast.forecastDaily.days[index].forecastStart, tz)),
				icon: this.getOWMIconCode(
					forecast.forecastDaily.days[index].conditionCode
				),
				description: forecast.forecastDaily.days[index].conditionCode,
			});
		}

		return weather;
	}

	private getAttribution(metadata: Metadata): Pick<WeatherData, "attribution"> | {} {
		if (!metadata || !(metadata.attributionURL || metadata.providerLogo || metadata.providerName)) {
			return {};
		}
		return {
			attribution: {
				name: metadata.providerName,
				url: metadata.attributionURL,
				logo: metadata.providerLogo,
			},
		};
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

	private getOWMIconCode(icon: string) {
		switch (icon.toLowerCase()) {
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
		return (celsius * 9) / 5 + 32;
	}

	private mmToInchesPerHour(mmPerHour) {
		return mmPerHour * 0.03937007874;
	}

	private kphToMph(kph) {
		return kph * 0.621371;
	}
}
