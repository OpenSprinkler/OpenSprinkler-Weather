import { expect } from "chai";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import MockDate from "mockdate";

process.env.WEATHER_PROVIDER = "OWM";

import {
	buildWeatherSensorResponse,
	fetchWeatherSensorData,
	getWateringData,
} from "./weather";
import { CachedResult } from "../cache";
import { GeoCoordinates, WeatherData, WateringData, PWS } from "../types";
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
				solarRadiation: 4.5,
				windSpeed: 3,
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
			wateringResult
		);

		expect(result.c).to.eql({ at: 1557748800, t: 0, h: 0, r: 0 });
		expect(result.f).to.eql({ at: 1557705600, lo: 32, hi: 50, p: 0 });
		expect(result.h.p).to.equal(0);
		expect(result.h.eto).to.be.a("number");
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
});

function createExpressMocks(method: number) {
	const request = new MockRequestConstructor({
		method: "GET",
		url: `/${method}?loc=${location}`,
		query: {
			loc: location,
			format: "json",
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
