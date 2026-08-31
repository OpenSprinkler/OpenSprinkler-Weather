import { expect } from "chai";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import MockDate from "mockdate";

process.env.WEATHER_PROVIDER = "OWM";

import {
	buildWeatherSensorResponse,
	checkCaliforniaRestriction,
	checkMinTempRestriction,
	checkRainRestriction,
	fetchForecastWeatherData,
	fetchWeatherSensorData,
	getWateringData,
	getWeatherData,
	mergeForecastWeatherData,
} from "./weather";
import { CachedResult } from "../cache";
import { GeoCoordinates, WeatherData, WeatherDataForecast, WateringData, PWS } from "../types";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import ZimmermanAdjustmentMethod from "./adjustmentMethods/ZimmermanAdjustmentMethod";

const location = "42,-75";
const MockRequestConstructor = MockExpressRequest as unknown as new (options: object) => any;

describe("Watering Data", () => {
	beforeEach(() => MockDate.set("2019-05-13T12:00:00Z"));
	afterEach(() => {
		MockDate.reset();
	});

	it("returns time data without calling a provider for manual adjustment", async () => {
		const { request, response } = createExpressMocks(0);
		await getWateringData(request, response);

		const result = response._getJSON();
		expect(result.errCode).to.equal(0);
		expect(result.rawData).to.eql({ wp: "Manual" });
		expect(result.scale).to.equal(undefined);
		expect(result.sunrise).to.be.a("number");
		expect(result.sunset).to.be.a("number");
	});

	it("returns adjustment errors as JSON when requested", async () => {
		const { request, response } = createExpressMocks(9);
		await getWateringData(request, response);

		expect(response._getJSON()).to.eql({ errCode: 41, scale: 100 });
	});

	it("preserves the legacy adjustment error format by default", async () => {
		const { request, response } = createExpressMocks(9, false);
		await getWateringData(request, response);

		expect(response._getString()).to.equal("&errCode=41&scale=100");
	});

	it("honors JSON format for errors after selecting an adjustment method", async () => {
		const { request, response } = createExpressMocks(1);
		request.query.wto = '"provider":';
		await getWateringData(request, response);

		expect(response._getJSON()).to.eql({ errCode: 50, scale: 100 });
	});

	it("calculates Zimmerman adjustment from normalized historical data", async () => {
		const provider = new MockWeatherProvider({
			wateringData: [{
				weatherProvider: "mock",
				temp: 58.333,
				humidity: 50,
				precip: 0,
				periodStartTime: 1557622800,
				minTemp: 50,
				maxTemp: 70,
				minHumidity: 50,
				maxHumidity: 50,
			}],
		});

		const result = await ZimmermanAdjustmentMethod.calculateWateringScale(
			{} as any,
			[42, -75],
			provider
		);

		expect(result.scale).to.equal(33);
		expect(result.scales).to.eql([33]);
		expect(result.rawData).to.eql({ wp: "mock", h: 50, p: 0, t: 58.3 });
	});

	it("calculates Zimmerman adjustment without wind or solar measurements", async () => {
		const provider = new MockWeatherProvider({
			wateringData: [{
				weatherProvider: "mock",
				temp: 70,
				humidity: 30,
				precip: 0,
				periodStartTime: 1557622800,
				minTemp: 60,
				maxTemp: 80,
				minHumidity: 20,
				maxHumidity: 40,
			}],
		});

		const result = await ZimmermanAdjustmentMethod.calculateWateringScale(
			{} as any,
			[42, -75],
			provider
		);

		expect(result.scale).to.equal(100);
	});

	it("sorts daily history newest-first before calculating rolling averages", async () => {
		const makeDay = (periodStartTime: number, temp: number): WateringData => ({
			weatherProvider: "mock",
			periodStartTime,
			temp,
			humidity: 30,
			precip: 0,
			minTemp: temp,
			maxTemp: temp,
			minHumidity: 30,
			maxHumidity: 30,
		});
		const provider = new MockWeatherProvider({ wateringData: [
			makeDay(Date.parse("2026-01-13T05:00:00Z") / 1000, 65),
			makeDay(Date.parse("2026-01-15T05:00:00Z") / 1000, 70),
			makeDay(Date.parse("2026-01-14T05:00:00Z") / 1000, 75),
		] });

		const result = await ZimmermanAdjustmentMethod.calculateWateringScale(
			{} as any,
			[42, -75],
			provider
		);

		expect(result.scales).to.eql([100, 110, 100]);
		expect(result.rawData).to.include({ t: 70 });
	});
});

describe("Weather Data (getWeatherData)", () => {
	const mainWeather: WeatherData = {
		weatherProvider: "local",
		temp: 68,
		humidity: 55,
		wind: 4,
		raining: false,
		description: "",
		icon: "01d",
		region: undefined,
		city: undefined,
		minTemp: undefined,
		maxTemp: undefined,
		precip: undefined,
		forecast: [],
	};
	const forecastWeather: WeatherData = {
		weatherProvider: "OpenMeteo",
		description: "",
		icon: "01d",
		region: undefined,
		city: undefined,
		minTemp: 55,
		maxTemp: 72,
		precip: 0.25,
		forecast: [{
			temp_min: 54,
			temp_max: 71,
			precip: 0.2,
			date: 1557705600,
			icon: "rain",
			description: "Rain",
		}],
	};

	describe("mergeForecastWeatherData", () => {
		it("merges forecast, precip, minTemp, and maxTemp while keeping other fields from the main provider", () => {
			const result = mergeForecastWeatherData(mainWeather, forecastWeather);

			// Unchanged: still sourced from the main provider (local).
			expect(result.weatherProvider).to.equal("local");
			expect(result.temp).to.equal(68);
			expect(result.humidity).to.equal(55);
			expect(result.wind).to.equal(4);
			expect(result.raining).to.equal(false);

			// Merged in: now sourced from the forecast provider (OpenMeteo).
			expect(result.forecast).to.eql(forecastWeather.forecast);
			expect(result.precip).to.equal(0.25);
			expect(result.minTemp).to.equal(55);
			expect(result.maxTemp).to.equal(72);
		});

		it("fails open and returns the weather data unchanged when no forecast was fetched", () => {
			expect(mergeForecastWeatherData(mainWeather, undefined)).to.equal(mainWeather);
		});
	});

	describe("fetchForecastWeatherData", () => {
		it("returns the forecast provider's weather data on success", async () => {
			const provider = new MockWeatherProvider({ weatherData: forecastWeather });

			const result = await fetchForecastWeatherData([42, -75], provider);

			expect(result).to.eql(forecastWeather);
		});

		it("fails open and returns undefined when the forecast provider throws", async () => {
			// The base WeatherProvider's default getWeatherDataInternal() throws "not supported", which is enough
			// to exercise the failure path without a real network call.
			const provider = new WeatherProvider();

			const result = await fetchForecastWeatherData([42, -75], provider);

			expect(result).to.equal(undefined);
		});
	});

	function createWeatherDataMocks(query: { [key: string]: string } = {}) {
		const request = new MockRequestConstructor({
			method: "GET",
			url: "/weatherData",
			query: { loc: location, ...query },
		});

		return { request, response: new MockExpressResponse({ request }) };
	}

	// These exercise getWeatherData's pre-existing early-return paths (malformed options, an unresolvable
	// location, and a failed main-provider fetch), all of which return before the new forecast fetch is ever
	// reached — so they stay deterministic and network-free while still guarding that the refactor didn't
	// change this existing error handling.
	describe("getWeatherData", () => {
		it("returns an error for malformed adjustment options", async () => {
			const { request, response } = createWeatherDataMocks({ wto: '"provider":' });
			await getWeatherData(request, response);

			expect(response._getString()).to.equal("&errCode=50&scale=100");
		});

		it("returns an error for an unresolvable location", async () => {
			const { request, response } = createWeatherDataMocks({ loc: "" });
			await getWeatherData(request, response);

			expect(response._getString()).to.match(/^Error: Unable to resolve location/);
		});

		it("returns an error when the main provider fetch fails, without reaching the forecast fetch", async () => {
			// "local" has no queued observations in this test environment, so its fetch throws deterministically.
			const { request, response } = createWeatherDataMocks({ wto: '"provider":"local"' });
			await getWeatherData(request, response);

			expect(response._getString()).to.match(/^Error: /);
		});
	});
});

describe("Weather Restrictions", () => {
	const makeForecast = (precip: number): WeatherDataForecast => ({
		temp_min: 40,
		temp_max: 60,
		precip,
		date: 1557705600,
		icon: "clear",
		description: "Clear",
	});

	describe("checkCaliforniaRestriction", () => {
		it("triggers when the last two days of precipitation exceed 0.1\"", () => {
			const wateringData: WateringData[] = [
				{ ...({} as WateringData), precip: 0.05 },
				{ ...({} as WateringData), precip: 0.1 },
			];
			expect(checkCaliforniaRestriction(true, wateringData)).to.equal(true);
		});

		it("does not trigger when disabled, even with heavy recent rain", () => {
			const wateringData: WateringData[] = [{ ...({} as WateringData), precip: 5 }];
			expect(checkCaliforniaRestriction(false, wateringData)).to.equal(false);
		});

		it("does not trigger without watering data", () => {
			expect(checkCaliforniaRestriction(true, undefined)).to.equal(false);
			expect(checkCaliforniaRestriction(true, [])).to.equal(false);
		});
	});

	describe("checkMinTempRestriction", () => {
		it("triggers when the current temperature is below the threshold", () => {
			expect(checkMinTempRestriction(35, 30)).to.equal(true);
		});

		it("does not trigger when the current temperature is at or above the threshold", () => {
			expect(checkMinTempRestriction(35, 35)).to.equal(false);
		});

		it("is disabled via the -40 sentinel", () => {
			expect(checkMinTempRestriction(-40, -100)).to.equal(false);
		});

		it("fails open when no temperature was fetched (e.g. the provider request failed)", () => {
			expect(checkMinTempRestriction(35, undefined)).to.equal(false);
		});
	});

	describe("checkRainRestriction", () => {
		it("triggers when forecasted precipitation over rainDays exceeds rainAmt", () => {
			const forecast = [makeForecast(0.5), makeForecast(0.4), makeForecast(10)];
			expect(checkRainRestriction(0.8, 2, forecast)).to.equal(true);
		});

		it("only sums the configured number of forecast days", () => {
			const forecast = [makeForecast(0.05), makeForecast(10)];
			expect(checkRainRestriction(0.1, 1, forecast)).to.equal(false);
		});

		it("stays inactive against an empty forecast, matching today's local-provider behavior", () => {
			// FORECAST_WEATHER_PROVIDER=local reports forecast: [] since a local PWS stream has no forecast data.
			expect(checkRainRestriction(0.1, 2, [])).to.equal(false);
		});

		it("fails open when no forecast was fetched (e.g. FORECAST_WEATHER_PROVIDER is unset or the request failed)", () => {
			expect(checkRainRestriction(0.1, 2, undefined)).to.equal(false);
		});
	});

});

describe("Weather Sensor Data", () => {
	const weatherData: WeatherData = {
		weatherProvider: "mock",
		temp: 0,
		humidity: 0,
		wind: undefined,
		raining: false,
		description: "Clear",
		icon: "clear",
		region: "Test",
		city: "Test",
		minTemp: 32,
		maxTemp: 50,
		precip: 0,
		forecast: [{
			temp_min: 31,
			temp_max: 51,
			precip: 0.1,
			date: 1557705600,
			icon: "clear",
			description: "Clear",
		}],
	};
	const wateringData: WateringData = {
		weatherProvider: "mock",
		precip: 0,
		temp: 45,
		humidity: 60,
		periodStartTime: 1557622800,
		minTemp: 35,
		maxTemp: 55,
		minHumidity: 40,
		maxHumidity: 80,
		solarRadiation: 4.5,
		windSpeed: 3,
	};

	it("preserves zero values and omits unavailable fields", () => {
		const weatherResult: CachedResult<WeatherData> = {
			value: weatherData,
			ttl: 1000,
			cachedAt: 1557748800000,
		};
		const wateringResult: CachedResult<readonly WateringData[]> = {
			value: [wateringData],
			ttl: 1000,
			cachedAt: 1557748800000,
		};

		const result = buildWeatherSensorResponse(
			[42, -75],
			{ current: true, forecast: true, historical: true },
			weatherResult,
			wateringResult,
			600,
			weatherResult
		);

		expect(result.c).to.eql({ at: 1557748800, t: 0, h: 0, r: 0 });
		expect(result.f).to.eql({ at: 1557705600, lo: 32, hi: 50, p: 0 });
		expect(result.h.p).to.equal(0);
		expect(result.h.eto).to.be.a("number");
	});

	it("omits invalid ETo without discarding other historical values", () => {
		const wateringResult: CachedResult<readonly WateringData[]> = {
			value: [{ ...wateringData, maxHumidity: 101 }],
			ttl: 1000,
			cachedAt: 1557748800000,
		};

		const result = buildWeatherSensorResponse(
			[42, -75],
			{ current: false, forecast: false, historical: true },
			undefined,
			wateringResult
		);

		expect(result.h.t).to.equal(45);
		expect(result.h.eto).to.equal(undefined);
	});

	it("omits unavailable local ETo fields without discarding core history", () => {
		const wateringResult: CachedResult<readonly WateringData[]> = {
			value: [{ ...wateringData, windSpeed: undefined, solarRadiation: undefined }],
			ttl: 1000,
			cachedAt: 1557748800000,
		};

		const result = buildWeatherSensorResponse(
			[42, -75],
			{ current: false, forecast: false, historical: true },
			undefined,
			wateringResult
		);

		expect(result.h).to.include({ t: 45, h: 60, p: 0 });
		expect(result.h).not.to.have.property("w");
		expect(result.h).not.to.have.property("sr");
		expect(result.h).not.to.have.property("eto");
	});

	it("fetches only the provider data required by scope", async () => {
		const provider = new CountingMockWeatherProvider({
			weatherData,
			wateringData: [wateringData],
		});

		await fetchWeatherSensorData(
			provider,
			[42, -75],
			{ current: true, forecast: false, historical: false }
		);

		expect(provider.weatherCalls).to.equal(1);
		expect(provider.wateringCalls).to.equal(0);
	});

	it("shares provider caches across weather sensor scopes and direct consumers", async () => {
		const provider = new CountingMockWeatherProvider({
			weatherData,
			wateringData: [wateringData],
		});
		const coordinates: GeoCoordinates = [42, -75];

		await fetchWeatherSensorData(provider, coordinates, { current: true, forecast: false, historical: false });
		await fetchWeatherSensorData(provider, coordinates, { current: false, forecast: true, historical: false }, undefined, provider);
		await fetchWeatherSensorData(provider, coordinates, { current: true, forecast: true, historical: true }, undefined, provider);
		await provider.getWeatherData(coordinates);
		await provider.getWateringData(coordinates);

		expect(provider.weatherCalls).to.equal(1);
		expect(provider.wateringCalls).to.equal(1);
	});

	it("builds the forecast from FORECAST_WEATHER_PROVIDER, independent of a main provider with no forecast data", () => {
		// Simulates WEATHER_PROVIDER=local (which always reports forecast: []) with FORECAST_WEATHER_PROVIDER set to
		// a provider that does supply forecast data (e.g. OpenMeteo).
		const localWeatherResult: CachedResult<WeatherData> = {
			value: { ...weatherData, weatherProvider: "local", forecast: [] },
			ttl: 1000,
			cachedAt: 1557748800000,
		};
		const forecastResult: CachedResult<WeatherData> = {
			value: {
				...weatherData,
				weatherProvider: "OpenMeteo",
				minTemp: 55,
				maxTemp: 72,
				precip: 0.25,
				forecast: [{
					temp_min: 54,
					temp_max: 71,
					precip: 0.2,
					date: 1557705600,
					icon: "rain",
					description: "Rain",
				}],
			},
			ttl: 1000,
			cachedAt: 1557748800000,
		};

		const result = buildWeatherSensorResponse(
			[42, -75],
			{ current: true, forecast: true, historical: false },
			localWeatherResult,
			undefined,
			600,
			forecastResult
		);

		expect(result.wp).to.equal("local");
		expect(result.f).to.eql({ at: 1557705600, lo: 55, hi: 72, p: 0.25 });
	});

	it("omits the forecast instead of showing NaN when the forecast fetch fails", () => {
		const localWeatherResult: CachedResult<WeatherData> = {
			value: { ...weatherData, weatherProvider: "local", forecast: [] },
			ttl: 1000,
			cachedAt: 1557748800000,
		};

		const result = buildWeatherSensorResponse(
			[42, -75],
			{ current: true, forecast: true, historical: false },
			localWeatherResult,
			undefined,
			600,
			undefined
		);

		expect(result.f).to.equal(undefined);
	});

	it("fails open on a failed forecast fetch without blocking current or historical data", async () => {
		// The base WeatherProvider's default getWeatherDataInternal() throws "not supported", which is enough to
		// exercise the forecast fetch's failure path without a real network call.
		const provider = new CountingMockWeatherProvider({ weatherData, wateringData: [wateringData] });
		const forecastProvider = new WeatherProvider();

		const result = await fetchWeatherSensorData(
			provider,
			[42, -75],
			{ current: true, forecast: true, historical: true },
			undefined,
			forecastProvider
		);

		expect(result.weatherResult).to.not.equal(undefined);
		expect(result.wateringResult).to.not.equal(undefined);
		expect(result.forecastResult).to.equal(undefined);
		expect(result.forecastError).to.not.equal(undefined);
	});
});

function createExpressMocks(method: number, useJson = true) {
	const request = new MockRequestConstructor({
		method: "GET",
		url: `/${method}?loc=${location}`,
		query: {
			loc: location,
			format: useJson ? "json" : undefined,
		},
		params: [method],
		headers: {
			"x-forwarded-for": "127.0.0.1",
		},
	});

	return {
		request,
		response: new MockExpressResponse({ request }),
	};
}

/** Weather provider used by endpoint tests without external API calls. */
export class MockWeatherProvider extends WeatherProvider {
	private readonly mockData: MockWeatherData;

	public constructor(mockData: MockWeatherData) {
		super();
		this.mockData = mockData;
	}

	protected async getWateringDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WateringData[]> {
		return (await this.getData("wateringData")) as WateringData[];
	}

	protected async getWeatherDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WeatherData> {
		return (await this.getData("weatherData")) as WeatherData;
	}

	private async getData(type: "wateringData" | "weatherData") {
		const data = this.mockData[type];
		if (data instanceof Array) {
			data.forEach((entry) => {
				if (!entry.weatherProvider) entry.weatherProvider = "mock";
			});
		} else if (data && !data.weatherProvider) {
			data.weatherProvider = "mock";
		}

		return data;
	}
}

interface MockWeatherData {
	wateringData?: WateringData[];
	weatherData?: WeatherData;
}

class CountingMockWeatherProvider extends MockWeatherProvider {
	public weatherCalls = 0;
	public wateringCalls = 0;

	protected async getWeatherDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WeatherData> {
		this.weatherCalls++;
		return super.getWeatherDataInternal(coordinates, pws);
	}

	protected async getWateringDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WateringData[]> {
		this.wateringCalls++;
		return super.getWateringDataInternal(coordinates, pws);
	}
}
