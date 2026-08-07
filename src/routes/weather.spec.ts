import { expect } from "chai";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import MockDate from "mockdate";

process.env.WEATHER_PROVIDER = "OWM";

import { getWateringData } from "./weather";
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
