import moment from "moment-timezone";
import * as jwt from "jsonwebtoken";

import { GeoCoordinates, WeatherData, ZimmermanWateringData, PWS } from "../../types"; // Added PWS for completeness, though not used by Apple provider directly
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import { normalizeWeatherData } from "./normalizeWeatherData";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class AppleWeatherProvider extends WeatherProvider {

	private readonly API_KEY: string | undefined; // API_KEY can now be undefined

	public constructor() {
		super();

		const privateKey = process.env.APPLE_PRIVATE_KEY;
		const serviceId = process.env.APPLE_SERVICE_ID;
		const teamId = process.env.APPLE_TEAM_ID;
		const keyId = process.env.APPLE_KEY_ID;

		if (!privateKey || !serviceId || !teamId || !keyId) {
			console.warn(
				"WARN: Apple Weather provider is not fully configured due to missing environment variables " +
				"(APPLE_PRIVATE_KEY, APPLE_SERVICE_ID, APPLE_TEAM_ID, APPLE_KEY_ID). " +
				"It will not function if selected."
			);
			// this.API_KEY remains undefined
			return; // Exit constructor early, DO NOT THROW
		}

		try {
			this.API_KEY = jwt.sign(
				{ sub: serviceId },
				privateKey,
				{
					jwtid: `${teamId}.${serviceId}`,
					issuer: teamId,
					expiresIn: "1h", // Changed from 10y to 1h
					keyid: keyId,
					algorithm: "ES256",
					header: { id: `${teamId}.${serviceId}` }
				}
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(
				"ERROR: Failed to generate Apple Weather API key (JWT). " +
				"This may be due to invalid or malformed Apple environment variables. " +
				`Message: ${error.message}`
			);
			// this.API_KEY remains undefined
		}
	}

	private ensureConfigured(): void {
		if (!this.API_KEY) {
			throw new CodedError(
				ErrorCode.NoAPIKeyProvided,
				"Apple Weather provider is not configured. Please ensure APPLE_PRIVATE_KEY, APPLE_SERVICE_ID, APPLE_TEAM_ID, and APPLE_KEY_ID are correctly set in environment variables, or that JWT generation was successful."
			);
		}
	}

	public async getWateringData(coordinates: GeoCoordinates): Promise<ZimmermanWateringData> {
		this.ensureConfigured();
		// The Unix timestamp of 24 hours ago.
		const yesterdayTimestamp: string = moment().subtract(1, "day").toISOString();

		const yesterdayUrl = `https://weatherkit.apple.com/api/v1/weather/en/${coordinates[0]}/${coordinates[1]}?dataSets=forecastHourly&hourlyStart=${yesterdayTimestamp}&timezone=UTC`;

		let yesterdayData;
		try {
			yesterdayData = await httpJSONRequest(yesterdayUrl, { Authorization: `Bearer ${this.API_KEY!}` });
		} catch (err) {
			console.error("Error retrieving weather information from Apple for getWateringData:", err);
			throw new CodedError(ErrorCode.WeatherApiError, "Failed to fetch watering data from Apple WeatherKit.");
		}

		if (!yesterdayData.forecastHourly || !yesterdayData.forecastHourly.hours) {
			throw new CodedError(ErrorCode.MissingWeatherField, "Necessary forecastHourly data missing from Apple WeatherKit response.");
		}

		const samples = yesterdayData.forecastHourly.hours as any[]; // Assuming structure based on original code

		// Fail if not enough data is available.
		// There will only be 23 samples on the day that daylight saving time begins.
		if (samples.length < 23) {
			throw new CodedError(ErrorCode.InsufficientWeatherData, `Insufficient hourly data from Apple WeatherKit: received ${samples.length} samples, need at least 23.`);
		}

		const totals = { temp: 0, humidity: 0, precip: 0 };
		for (const sample of samples) {
			if (sample.temperature === undefined || sample.humidity === undefined) {
				console.warn("WARN: Skipping sample in Apple getWateringData due to missing temperature or humidity.", sample);
				// Decide if this should throw an error or if skipping is acceptable
				// For now, let it potentially lead to NaN which might be caught by Zimmerman if it uses validateValues
			}
			totals.temp += this.celsiusToFahrenheit(sample.temperature);
			totals.humidity += sample.humidity; // humidity is a fraction 0-1
			totals.precip += this.mmToInchesPerHour(sample.precipitationIntensity || 0);
		}

		return {
			weatherProvider: "Apple",
			temp: totals.temp / samples.length,
			humidity: (totals.humidity / samples.length) * 100, // Convert average fraction to percentage
			precip: totals.precip,
			raining: (samples[samples.length - 1].precipitationIntensity || 0) > 0
		};
	}

	public async getWeatherData(coordinates: GeoCoordinates): Promise<WeatherData> {
		this.ensureConfigured();
		const forecastUrl = `https://weatherkit.apple.com/api/v1/weather/en/${coordinates[0]}/${coordinates[1]}?dataSets=currentWeather,forecastDaily&timezone=UTC`;

		let forecast;
		try {
			forecast = await httpJSONRequest(forecastUrl, { Authorization: `Bearer ${this.API_KEY!}` });
		} catch (err) {
			console.error("Error retrieving weather information from Apple for getWeatherData:", err);
			throw new CodedError(ErrorCode.WeatherApiError, "Failed to fetch current weather/forecast from Apple WeatherKit.");
		}

		if (!forecast.currentWeather || !forecast.forecastDaily || !forecast.forecastDaily.days || forecast.forecastDaily.days.length === 0) {
			throw new CodedError(ErrorCode.MissingWeatherField, "Necessary currentWeather or forecastDaily data missing from Apple WeatherKit response.");
		}

		const currentWeather = forecast.currentWeather;
		const dailyForecasts = forecast.forecastDaily.days as any[];
		const dailyPrecipMm = dailyForecasts[0].precipitationAmount;
		const precip = dailyPrecipMm !== undefined
			? this.mmToInchesPerHour(dailyPrecipMm)
			: this.mmToInchesPerHour(currentWeather.precipitationIntensity || 0) * 24;
		const observedAt = typeof currentWeather.asOf === "string" ? moment( currentWeather.asOf ).unix() : undefined;

		const weather: WeatherData = {
			weatherProvider: "Apple",
			temp: Math.floor(this.celsiusToFahrenheit(currentWeather.temperature)),
			humidity: Math.floor(currentWeather.humidity * 100),
			wind: Math.floor(this.kphToMph(currentWeather.windSpeed)),
			description: currentWeather.conditionCode, // This is a code, might need mapping to human-readable
			icon: this.getOWMIconCode(currentWeather.conditionCode),
			region: "", // Apple WeatherKit does not directly provide region/city names in this response
			city: "",
			minTemp: Math.floor(this.celsiusToFahrenheit(dailyForecasts[0].temperatureMin)),
			maxTemp: Math.floor(this.celsiusToFahrenheit(dailyForecasts[0].temperatureMax)),
			precip,
			forecast: [],
			...( Number.isFinite( observedAt ) ? { observedAt } : {} )
		};

		for (const dailyData of dailyForecasts) {
			weather.forecast.push({
				temp_min: Math.floor(this.celsiusToFahrenheit(dailyData.temperatureMin)),
				temp_max: Math.floor(this.celsiusToFahrenheit(dailyData.temperatureMax)),
				date: moment(dailyData.forecastStart).unix(),
				icon: this.getOWMIconCode(dailyData.conditionCode),
				description: dailyData.conditionCode // Also a code
			});
		}

		return normalizeWeatherData( "Apple", weather );
	}

	public async getEToData(coordinates: GeoCoordinates): Promise<EToData> {
		this.ensureConfigured();
		const yesterdayTimestamp: string = moment().subtract(1, "day").toISOString();
		const todayTimestamp: string = moment().toISOString(); // For daily forecast part

		// Fetch hourly for past 24h for cloud cover, and daily for min/max temp, humidity range, wind, precip
		const apiUrl = `https://weatherkit.apple.com/api/v1/weather/en/${coordinates[0]}/${coordinates[1]}?dataSets=forecastHourly,forecastDaily&hourlyStart=${yesterdayTimestamp}&hourlyEnd=${todayTimestamp}&dailyStart=${yesterdayTimestamp}&dailyEnd=${todayTimestamp}&timezone=UTC`;

		let historicData;
		try {
			historicData = await httpJSONRequest(apiUrl, { Authorization: `Bearer ${this.API_KEY!}` });
		} catch (err) {
			console.error("Error retrieving weather information from Apple for getEToData:", err);
			throw new CodedError(ErrorCode.WeatherApiError, "Failed to fetch ETo data from Apple WeatherKit.");
		}

		if (!historicData.forecastHourly || !historicData.forecastHourly.hours || historicData.forecastHourly.hours.length < 23 ||
			!historicData.forecastDaily || !historicData.forecastDaily.days || historicData.forecastDaily.days.length === 0) {
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Insufficient hourly or daily data from Apple WeatherKit for ETo calculation.");
		}

		const hourlySamples = historicData.forecastHourly.hours as any[];
		const dailySample = historicData.forecastDaily.days[0]; // Data for the 24h period ending 'today'

		const cloudCoverInfo: CloudCoverInfo[] = hourlySamples.map((hour): CloudCoverInfo => {
			return {
				startTime: moment(hour.forecastStart),
				endTime: moment(hour.forecastStart).add(1, "hours"),
				cloudCover: hour.cloudCover // fraction 0-1
			};
		});

		// Min/Max humidity from hourly data for the 24h period
		let minHumidity: number | undefined = undefined;
		let maxHumidity: number | undefined = undefined;
		for (const hour of hourlySamples) {
			if (hour.humidity !== undefined) { // humidity is fraction 0-1
				minHumidity = (minHumidity === undefined || hour.humidity < minHumidity) ? hour.humidity : minHumidity;
				maxHumidity = (maxHumidity === undefined || hour.humidity > maxHumidity) ? hour.humidity : maxHumidity;
			}
		}
		
		if (minHumidity === undefined || maxHumidity === undefined) {
			throw new CodedError(ErrorCode.MissingWeatherField, "Humidity data missing from Apple WeatherKit hourly forecast for ETo.");
		}


		// Average wind speed for the day (daytime + overnight / 2 might be from a different day's summary)
		// Using dailySample.daytimeForecast.windSpeed or similar if available for the specific 24h period.
		// The API call fetches dailyStart=yesterday and dailyEnd=today, so days[0] should be 'yesterday'.
		// Let's assume dailySample.daytimeForecast and dailySample.overnightForecast refer to the 24h period of 'dailySample.forecastStart'
		// For simplicity, if a single daily wind average is available, use that. Otherwise, average from hourly.
		let avgWindSpeedKph: number;
		if (dailySample.daytimeForecast && dailySample.overnightForecast) {
			avgWindSpeedKph = (dailySample.daytimeForecast.windSpeed + dailySample.overnightForecast.windSpeed) / 2;
		} else { // Fallback to averaging hourly wind speeds if daily average isn't structured as expected
			let windSum = 0;
			let windCount = 0;
			for (const hour of hourlySamples) {
				if (hour.windSpeed !== undefined) {
					windSum += hour.windSpeed; // kph
					windCount++;
				}
			}
			if (windCount === 0) throw new CodedError(ErrorCode.MissingWeatherField, "Wind speed data missing from Apple WeatherKit hourly forecast for ETo.");
			avgWindSpeedKph = windSum / windCount;
		}


		return {
			weatherProvider: "Apple",
			periodStartTime: moment(hourlySamples[0].forecastStart).unix(),
			minTemp: this.celsiusToFahrenheit(dailySample.temperatureMin),
			maxTemp: this.celsiusToFahrenheit(dailySample.temperatureMax),
			minHumidity: minHumidity * 100, // Convert fraction to percentage
			maxHumidity: maxHumidity * 100, // Convert fraction to percentage
			solarRadiation: approximateSolarRadiation(cloudCoverInfo, coordinates),
			windSpeed: this.kphToMph(avgWindSpeedKph),
			precip: this.mmToInchesPerHour(dailySample.precipitationAmount || 0) // precipitationAmount is total for the day
		};
	}

	public shouldCacheWateringScale(): boolean {
		return true;
	}

	// Icon mapping from Apple's condition codes to OWM-like icon codes
	private getOWMIconCode(appleConditionCode: string): string {
		const code = appleConditionCode.toLowerCase();
		// This mapping is illustrative and may need refinement based on Apple's full list of condition codes
		if (code.includes("mostlyclear") || code.includes("partlycloudy")) return code.includes("night") ? "02n" : "02d";
		if (code.includes("mostlycloudy") || code.includes("cloudy")) return code.includes("night") ? "04n" : "04d"; // OWM uses 03 for scattered, 04 for broken/overcast
		if (code.includes("fog") || code.includes("haze") || code.includes("dust")) return "50d";
		if (code.includes("windy") || code.includes("breezy")) return "50d"; // No direct OWM equivalent, using mist/fog icon
		if (code.includes("sleet") || code.includes("snow") || code.includes("flurries") || code.includes("wintrymix") || code.includes("blizzard") || code.includes("freezingrain") || code.includes("freezingdrizzle") || code.includes("hail")) return code.includes("night") ? "13n" : "13d";
		if (code.includes("rain") || code.includes("drizzle") || code.includes("showers")) return code.includes("night") ? "10n" : "10d";
		if (code.includes("thunderstorm") || code.includes("strongstorms")) return code.includes("night") ? "11n" : "11d";
		if (code.includes("clear") || code.includes("sunny")) return code.includes("night") ? "01n" : "01d";
		
		// Fallback for unknown codes
		console.warn(`Unknown Apple Weather condition code: ${appleConditionCode}`);
		return "01d"; // Default to sunny/clear
	}

	private celsiusToFahrenheit(celsius: number): number {
		return (celsius * 9 / 5) + 32;
	}

	private mmToInchesPerHour(mmPerHour: number): number {
		return mmPerHour * 0.03937007874;
	}

	private kphToMph(kph: number): number {
		return kph * 0.621371;
	}
}
