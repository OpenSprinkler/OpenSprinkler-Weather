import { expect } from "chai";
import AccuWeatherProvider from "./AccuWeather";
import LocalWeatherProvider, { captureWUStream } from "./local";
import OpenMeteoProvider from "./OpenMeteo";
import { GeoCoordinates, WeatherData } from "../../types";

const coordinates: GeoCoordinates = [42, -75];

describe("Weather provider normalization", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
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

function jsonResponse(value: unknown): Response {
	return { json: async () => value } as Response;
}
