import { expect } from "chai";
import AccuWeatherProvider from "./AccuWeather";
import AppleWeatherProvider from "./Apple";
import LocalWeatherProvider, { captureWUStream } from "./local";
import OpenMeteoProvider from "./OpenMeteo";
import PirateWeatherProvider from "./PirateWeather";
import { GeoCoordinates, WeatherData, WateringData } from "../../types";
import MockDate from "mockdate";
import { getUnixTime, startOfDay, subDays } from "date-fns";
import { localTime } from "../weather";
import { standardizeWindSpeed } from "../adjustmentMethods/EToAdjustmentMethod";

const coordinates: GeoCoordinates = [42, -75];

describe("Weather provider normalization", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		MockDate.reset();
		delete process.env.PIRATEWEATHER_API_KEY;
	});

	it("preserves zero humidity and uses current rain for OpenMeteo", async () => {
		let requestedUrl = "";
		globalThis.fetch = (async (url: string | URL) => {
			requestedUrl = String(url);
			return jsonResponse({
				current: {
					temperature_2m: 32,
					relative_humidity_2m: 0,
					precipitation: 0,
					wind_speed_10m: 0,
					weather_code: 0,
				},
				daily: {
					weathercode: [61],
					temperature_2m_min: [30],
					temperature_2m_max: [40],
					precipitation_sum: [1],
					time: [1557705600],
				},
			});
		}) as typeof globalThis.fetch;

		const weather = await new TestOpenMeteoProvider().readWeather(coordinates);
		expect(weather.humidity).to.equal(0);
		expect(weather.wind).to.equal(0);
		expect(weather.raining).to.equal(false);
		expect(weather.precip).to.equal(1);
		expect(requestedUrl).to.contain("current=temperature_2m,relative_humidity_2m,precipitation");
		expect(requestedUrl).not.to.contain("current_weather=true");
	});

	it("uses AccuWeather forecast rain amount rather than intensity", async () => {
		globalThis.fetch = (async (url: string | URL) => {
			const path = String(url);
			if (path.includes("locations")) {
				return jsonResponse({ Key: "location", Region: { EnglishName: "Region" }, EnglishName: "City" });
			}
			if (path.includes("currentconditions")) {
				return jsonResponse([{
					Temperature: { Imperial: { Value: 70 } },
					RelativeHumidity: 50,
					Wind: { Speed: { Imperial: { Value: 5 } } },
					Precip1hr: { Imperial: { Value: 0 } },
					WeatherText: "Clear",
					WeatherIcon: 1,
				}]);
			}
			const day = {
					Temperature: { Minimum: { Value: 60 }, Maximum: { Value: 80 } },
					Day: { Rain: { Value: 0.1 }, PrecipitationIntensity: "Light", Icon: 1, ShortPhrase: "Clear" },
					Night: { Rain: { Value: 0.2 } },
					EpochDate: 1557705600,
				};
			return jsonResponse({
				DailyForecasts: [day, day, day, day, day],
			});
		}) as typeof globalThis.fetch;

		const weather = await new TestAccuWeatherProvider().readWeather(coordinates);
		expect(weather.precip).to.be.closeTo(0.3, 0.0001);
	});

	it("uses global radiation and mean 2-meter wind for OpenMeteo ETo data", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const currentDay = getUnixTime(startOfDay(localTime(coordinates)));
		const firstHour = currentDay - 7 * 24 * 60 * 60;
		const sampleCount = 8 * 24;
		let requestedUrl = "";

		globalThis.fetch = (async (url: string | URL) => {
			requestedUrl = String(url);
			return jsonResponse({
				hourly: {
					time: sequence(sampleCount, i => firstHour + i * 60 * 60),
					temperature_2m: sequence(sampleCount, () => 70),
					relative_humidity_2m: sequence(sampleCount, () => 50),
					precipitation: sequence(sampleCount, () => 0),
					shortwave_radiation: sequence(sampleCount, () => 100),
					wind_speed_10m: sequence(sampleCount, () => 10),
				},
			});
		}) as typeof globalThis.fetch;

		const data = await new TestOpenMeteoProvider().readWatering(coordinates);
		expect(requestedUrl).to.contain("shortwave_radiation");
		expect(requestedUrl).not.to.contain("direct_radiation");
		expect(requestedUrl).to.contain("wind_speed_unit=mph");
		expect(data[0].solarRadiation).to.equal(2.4);
		expect(data[0].windSpeed).to.be.closeTo(standardizeWindSpeed(10, 32.81), 0.0001);
	});

	it("uses one-hour cloud windows for Pirate Weather radiation", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		process.env.PIRATEWEATHER_API_KEY = "test-key";
		const firstHour = getUnixTime(subDays(startOfDay(localTime(coordinates)), 1));
		const hourly = sequence(24, i => ({
			time: firstHour + i * 60 * 60,
			temperature: 20,
			humidity: 0.5,
			dewPoint: 10,
			precipAccumulation: 0,
			cloudCover: 0,
		}));

		globalThis.fetch = (async () => jsonResponse({
			hourly: { data: hourly },
			daily: { data: [{ temperatureMin: 10, temperatureMax: 25, windSpeed: 10 }] },
		})) as typeof globalThis.fetch;

		const data = await new TestPirateWeatherProvider().readWatering(coordinates);
		expect(data[0].solarRadiation).to.be.greaterThan(0);
	});

	it("averages Apple daytime and overnight wind", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const firstHour = getUnixTime(subDays(startOfDay(localTime(coordinates)), 1));
		const hours = sequence(24, i => ({
			forecastStart: new Date((firstHour + i * 60 * 60) * 1000).toISOString(),
			temperature: 20,
			humidity: 0.5,
			cloudCover: 0,
		}));
		const forecastStart = new Date(firstHour * 1000).toISOString();

		globalThis.fetch = (async () => jsonResponse({
			forecastHourly: { hours },
			forecastDaily: { days: [{
				forecastStart,
				temperatureMin: 10,
				temperatureMax: 25,
				precipitationAmount: 0,
				daytimeForecast: { windSpeed: 10 },
				overnightForecast: { windSpeed: 20 },
			}] },
		})) as typeof globalThis.fetch;

		const data = await new TestAppleWeatherProvider().readWatering(coordinates);
		expect(data[0].windSpeed).to.be.closeTo(9.32057, 0.0001);
	});

	it("preserves valid zero measurements from a local station", async () => {
		await captureWUStream({
			query: {
				dateutc: "now",
				tempf: "0",
				humidity: "0",
				windspeedmph: "0",
				dailyrainin: "0",
				rainin: "0",
			},
		} as any, { send() {} } as any);

		const weather = await new TestLocalWeatherProvider().readWeather(coordinates);
		expect(weather.temp).to.equal(0);
		expect(weather.humidity).to.equal(0);
		expect(weather.wind).to.equal(0);
		expect(weather.raining).to.equal(false);
		expect(weather.precip).to.equal(undefined);
	});
});

class TestOpenMeteoProvider extends OpenMeteoProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}

	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
	}
}

class TestAccuWeatherProvider extends AccuWeatherProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class TestLocalWeatherProvider extends LocalWeatherProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class TestPirateWeatherProvider extends PirateWeatherProvider {
	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
	}
}

class TestAppleWeatherProvider extends AppleWeatherProvider {
	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
	}
}

function sequence<T>(length: number, value: (index: number) => T): T[] {
	return Array.from({ length }, (_, index) => value(index));
}

function jsonResponse(value: unknown): Response {
	return { json: async () => value } as Response;
}
