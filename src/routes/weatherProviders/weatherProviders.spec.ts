import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import AccuWeatherProvider from "./AccuWeather";
import AppleWeatherProvider from "./Apple";
import LocalWeatherProvider, {
	buildLocalWateringData,
	buildLocalWateringDataHistory,
	captureWUStream,
	writeJsonAtomically,
} from "./local";
import OpenMeteoProvider from "./OpenMeteo";
import PirateWeatherProvider from "./PirateWeather";
import WUndergroundProvider from "./WUnderground";
import DWDProvider from "./DWD";
import OWMProvider from "./OWM";
import { GeoCoordinates, WeatherData, WateringData } from "../../types";
import MockDate from "mockdate";
import { getUnixTime, startOfDay, subDays } from "date-fns";
import { localTime } from "../weather";
import { standardizeWindSpeed } from "../adjustmentMethods/EToAdjustmentMethod";
import {
	averageFinite,
	completeHistoricalHourlyDays,
	groupByLocalDay,
	hasTimeSeriesCoverage,
	hasWindowCoverage,
	localDayWindow,
	maximumTimeGap,
	timeWeightedAverage,
	timeWeightedAverageInWindow,
} from "./providerUtils";
import { httpJSONRequest } from "../weather";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";

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
		delete process.env.APPLE_PRIVATE_KEY;
		delete process.env.APPLE_TEAM_ID;
		delete process.env.APPLE_SERVICE_ID;
		delete process.env.APPLE_KEY_ID;
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
					weather_code: [61],
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

	it("uses AccuWeather total liquid forecast amount", async () => {
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
					Day: { Rain: { Value: 0.1 }, TotalLiquid: { Value: 0.4 }, PrecipitationIntensity: "Light", Icon: 1, ShortPhrase: "Clear" },
					Night: { Rain: { Value: 0.2 }, TotalLiquid: { Value: 0.5 } },
					EpochDate: 1557705600,
				};
			return jsonResponse({
				DailyForecasts: [day, day, day, day, day],
			});
		}) as typeof globalThis.fetch;

		const weather = await new TestAccuWeatherProvider().readWeather(coordinates);
		expect(weather.precip).to.be.closeTo(0.9, 0.0001);
	});

	it("uses HTTPS and excludes missing AccuWeather wind samples from the mean", async () => {
		const firstHour = 1000;
		const history = sequence(24, i => ({
			EpochTime: firstHour + (23 - i) * 60 * 60,
			Temperature: { Imperial: { Value: 70 } },
			RelativeHumidity: 50,
			Wind: { Speed: { Imperial: { Value: i === 0 ? undefined : 10 } } },
			CloudCover: 0,
			PrecipitationSummary: { Past24Hours: { Imperial: { Value: 0.1 } } },
			TemperatureSummary: { Past24HourRange: {
				Minimum: { Imperial: { Value: 60 } },
				Maximum: { Imperial: { Value: 80 } },
			} },
		}));
		let historyUrl = "";
		globalThis.fetch = (async (url: string | URL) => {
			const path = String(url);
			if (path.includes("locations")) return jsonResponse({ Key: "location" });
			historyUrl = path;
			return jsonResponse(history);
		}) as typeof globalThis.fetch;

		const data = await new TestAccuWeatherProvider().readWatering(coordinates);
		expect(historyUrl).to.match(/^https:\/\//);
		expect(data[0].windSpeed).to.equal(10);
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

	it("normalizes Pirate Weather humidity, liquid precipitation, and mean wind", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		process.env.PIRATEWEATHER_API_KEY = "test-key";
		const firstHour = getUnixTime(subDays(startOfDay(localTime(coordinates)), 1));
		const hourly = sequence(24, i => ({
			time: firstHour + i * 60 * 60,
			temperature: 20,
			humidity: i === 0 ? undefined : 0.5,
			dewPoint: i === 0 ? 20 : 10,
			liquidAccumulation: 0.1,
			cloudCover: 0,
			windSpeed: i + 1,
		}));

		let requestedUrl = "";
		globalThis.fetch = (async (url: string | URL) => {
			requestedUrl = String(url);
			return jsonResponse({
			hourly: { data: hourly },
			daily: { data: [{}] },
			});
		}) as typeof globalThis.fetch;

		const data = await new TestPirateWeatherProvider().readWatering(coordinates);
		expect(requestedUrl).to.contain("timemachine.pirateweather.net");
		expect(requestedUrl).to.contain("version=2");
		expect(data[0].humidity).to.be.closeTo(52.0833, 0.001);
		expect(data[0].precip).to.be.closeTo(2.4 / 2.54, 0.0001);
		expect(data[0].windSpeed).to.be.closeTo(12.5 * 0.621371, 0.0001);
		expect(data[0].solarRadiation).to.be.greaterThan(0);
	});

	it("accepts a complete 23-hour Pirate Weather DST day", async () => {
		MockDate.set("2026-03-09T12:00:00Z");
		process.env.PIRATEWEATHER_API_KEY = "test-key";
		const window = localDayWindow("2026-03-08", "America/New_York");
		const hourly = sequence(23, hour => ({
			time: window.start.getTime() / 1000 + hour * 60 * 60,
			temperature: 20,
			humidity: 0.5,
			liquidAccumulation: 0,
			cloudCover: 0,
			windSpeed: 5,
		}));
		globalThis.fetch = (async () => jsonResponse({ hourly: { data: hourly } })) as typeof globalThis.fetch;

		const data = await new TestPirateWeatherProvider().readWatering(coordinates);
		expect(data).to.have.length(1);
		expect(data[0].periodStartTime).to.equal(window.start.getTime() / 1000);
	});

	it("uses Weather Underground daily mean wind and cumulative liquid precipitation", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const firstHour = getUnixTime(startOfDay(localTime(coordinates))) - 24 * 60 * 60;
		const observations = sequence(24, i => ({
			epoch: firstHour + i * 60 * 60,
			tz: "America/New_York",
			humidityAvg: 50,
			humidityLow: 40,
			humidityHigh: 60,
			solarRadiationHigh: 100,
			imperial: {
				tempAvg: 70,
				tempLow: 60,
				tempHigh: 80,
				precipTotal: i / 100,
				windspeedAvg: i + 1,
			},
		}));

		globalThis.fetch = (async () => jsonResponse({ observations })) as typeof globalThis.fetch;
		const data = await new TestWUndergroundProvider().readWatering(coordinates);
		expect(data[0].windSpeed).to.equal(12.5);
		expect(data[0].precip).to.equal(0.23);
		expect(data[0].solarRadiation).to.equal(2.4);
	});

	it("uses Bright Sky measured solar energy and standardized 10-meter wind", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const firstHour = getUnixTime(startOfDay(localTime(coordinates))) - 24 * 60 * 60;
		const weather = sequence(24, i => ({
			timestamp: new Date((firstHour + i * 60 * 60) * 1000).toISOString(),
			temperature: 20,
			relative_humidity: 50,
			precipitation: 1,
			wind_speed: 36,
			solar: 0.1,
			cloud_cover: 100,
		}));
		globalThis.fetch = (async () => jsonResponse({ weather })) as typeof globalThis.fetch;

		const data = await new TestDWDProvider().readWatering(coordinates);
		expect(data[0].solarRadiation).to.be.closeTo(2.4, 0.0001);
		expect(data[0].windSpeed).to.be.closeTo(standardizeWindSpeed(36 / 1.609344, 32.81), 0.0001);
	});

	it("retrieves a Bright Sky forecast with one timezone-aware range request", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const firstHour = getUnixTime(startOfDay(localTime(coordinates)));
		const forecastHours = sequence(48, i => ({
			timestamp: new Date((firstHour + i * 60 * 60) * 1000).toISOString(),
			temperature: 20,
			precipitation: 0,
			condition: "dry",
			icon: "clear-day",
		}));
		const urls: string[] = [];
		globalThis.fetch = (async (url: string | URL) => {
			urls.push(String(url));
			if (String(url).includes("current_weather")) {
				return jsonResponse({
					weather: { temperature: 20, relative_humidity: 50, wind_speed_30: 5, precipitation_60: 0, condition: "dry", icon: "clear-day" },
					sources: [],
				});
			}
			return jsonResponse({ weather: forecastHours });
		}) as typeof globalThis.fetch;

		const weather = await new TestDWDProvider().readWeather(coordinates);
		expect(urls).to.have.length(2);
		expect(urls[1]).to.contain("last_date=2026-08-14");
		expect(urls[1]).to.contain("tz=America/New_York");
		expect(weather.forecast).to.have.length(2);
	});

	it("does not add snow depth to Weather Underground liquid forecast", async () => {
		globalThis.fetch = (async (url: string | URL) => {
			if (String(url).includes("forecast")) {
				return jsonResponse(weatherUndergroundForecast());
			}
			return jsonResponse({ observations: [{
				country: "US",
				humidity: 50,
				imperial: { temp: 70, windSpeed: 5, precipRate: 0 },
			}] });
		}) as typeof globalThis.fetch;

		const weather = await new TestWUndergroundProvider().readWeather(coordinates);
		expect(weather.precip).to.equal(0.2);
		expect(weather.forecast[1].precip).to.equal(0.3);
		// Day 2 uses daypart index 2, not the preceding night's index 1.
		expect(weather.forecast[1].icon).to.equal("09d");
	});

	it("averages Apple historical hourly wind", async () => {
		MockDate.set("2026-08-07T12:00:00Z");
		const firstHour = getUnixTime(subDays(startOfDay(localTime(coordinates)), 1));
		const hours = sequence(24, i => ({
			forecastStart: new Date((firstHour + i * 60 * 60) * 1000).toISOString(),
			temperature: 20,
			humidity: 0.5,
			cloudCover: 0,
			windSpeed: i + 1,
		}));
		const forecastStart = new Date(firstHour * 1000).toISOString();

		globalThis.fetch = (async () => jsonResponse({
			forecastHourly: { hours },
			forecastDaily: { days: [{
				forecastStart,
				temperatureMin: 10,
				temperatureMax: 25,
				precipitationAmount: 0,
			}] },
		})) as typeof globalThis.fetch;

		const data = await new TestAppleWeatherProvider().readWatering(coordinates);
		expect(data[0].windSpeed).to.be.closeTo(12.5 * 0.621371, 0.0001);
	});

	it("returns Apple attribution with displayed weather", async () => {
		globalThis.fetch = (async () => jsonResponse({
			currentWeather: {
				temperature: 20,
				humidity: 0.5,
				windSpeed: 10,
				precipitationIntensity: 0,
				conditionCode: "Clear",
				metadata: {
					attributionURL: "https://weather.example/attribution",
					providerName: "Weather Provider",
					providerLogo: "https://weather.example/logo.png",
				},
			},
			forecastDaily: { days: [{
				forecastStart: "2026-08-07T00:00:00-04:00",
				temperatureMin: 10,
				temperatureMax: 25,
				precipitationAmount: 0,
				conditionCode: "Clear",
			}] },
		})) as typeof globalThis.fetch;

		const weather = await new TestAppleWeatherProvider().readWeather(coordinates);
		expect(weather.attribution).to.deep.equal({
			name: "Weather Provider",
			url: "https://weather.example/attribution",
			logo: "https://weather.example/logo.png",
		});
	});

	it("reports missing Apple credentials explicitly", async () => {
		let error: any;
		try {
			await new MissingKeyAppleProvider().readWeather(coordinates);
		} catch (caught) {
			error = caught;
		}
		expect(error?.errCode).to.equal(35);
	});

	it("generates Apple tokens with issued-at and without jti", async () => {
		const { privateKey } = await generateKeyPair("ES256", { extractable: true });
		process.env.APPLE_PRIVATE_KEY = await exportPKCS8(privateKey);
		process.env.APPLE_TEAM_ID = "team";
		process.env.APPLE_SERVICE_ID = "service";
		process.env.APPLE_KEY_ID = "key";
		const payload = decodeJwt(await new TokenAppleProvider().token());
		expect(payload.iat).to.be.a("number");
		expect(payload).not.to.have.property("jti");
	});

	it("includes OpenWeather snow in current and forecast precipitation", async () => {
		globalThis.fetch = (async () => jsonResponse({
			current: {
				temp: 32,
				humidity: 80,
				wind_speed: 5,
				snow: { "1h": 2.54 },
				weather: [{ description: "snow", icon: "13d" }],
			},
			daily: [{
				dt: 1,
				temp: { min: 30, max: 35 },
				rain: 2.54,
				snow: 2.54,
				weather: [{ description: "mixed", icon: "13d" }],
			}],
		})) as typeof globalThis.fetch;

		const weather = await new TestOWMProvider().readWeather(coordinates);
		expect(weather.raining).to.equal(true);
		expect(weather.precip).to.be.closeTo(0.2, 0.0001);
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

	it("allows local Zimmerman data without wind or solar measurements", () => {
		const windowStart = Date.parse("2026-01-14T00:00:00Z") / 1000;
		const windowEnd = Date.parse("2026-01-15T00:00:00Z") / 1000;
		const observations = sequence(24, hour => ({
			timestamp: windowStart + hour * 60 * 60,
			temp: 70,
			humidity: 50,
			precip: 0,
		}));

		const data = buildLocalWateringData(observations, windowStart, windowEnd);
		expect(data.temp).to.equal(70);
		expect(data.humidity).to.equal(50);
		expect(data.precip).to.equal(0);
		expect(data.windSpeed).to.equal(undefined);
		expect(data.solarRadiation).to.equal(undefined);
	});

	it("returns seven contiguous local calendar days newest-first", () => {
		const timezone = "America/New_York";
		const observations = Array.from({ length: 8 }, (_, index) => {
			const day = 8 + index;
			const window = localDayWindow(`2026-01-${String(day).padStart(2, "0")}`, timezone);
			return sequence((window.end.getTime() - window.start.getTime()) / (60 * 60 * 1000), hour => ({
				timestamp: window.start.getTime() / 1000 + hour * 60 * 60,
				temp: day,
				humidity: 50,
				precip: 0,
			}));
		}).flat();

		const data = buildLocalWateringDataHistory(observations, coordinates, new Date("2026-01-16T12:00:00Z"));
		expect(data).to.have.length(7);
		expect(data.map(day => day.temp)).to.deep.equal([15, 14, 13, 12, 11, 10, 9]);
	});

	it("stops local multiday history at the first missing calendar day", () => {
		const timezone = "America/New_York";
		const observations = [13, 14, 15].flatMap(day => {
			const window = localDayWindow(`2026-01-${day}`, timezone);
			return sequence(24, hour => ({
				timestamp: window.start.getTime() / 1000 + hour * 60 * 60,
				temp: day,
				humidity: 50,
				precip: 0,
			}));
		});
		const withoutMiddleDay = observations.filter(observation => {
			const middle = localDayWindow("2026-01-14", timezone);
			return observation.timestamp < middle.start.getTime() / 1000 || observation.timestamp >= middle.end.getTime() / 1000;
		});

		const data = buildLocalWateringDataHistory(withoutMiddleDay, coordinates, new Date("2026-01-16T12:00:00Z"));
		expect(data.map(day => day.temp)).to.deep.equal([15]);
	});

	it("creates persistence directories and replaces state atomically", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "os-weather-"));
		const fileName = path.join(directory, "state", "observations.json");
		try {
			writeJsonAtomically(fileName, { observations: [1] });
			writeJsonAtomically(fileName, { observations: [2] });
			expect(JSON.parse(fs.readFileSync(fileName, "utf8"))).to.deep.equal({ observations: [2] });
			expect(fs.readdirSync(path.dirname(fileName))).to.deep.equal(["observations.json"]);
		} finally {
			if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
			if (fs.existsSync(path.dirname(fileName))) fs.rmdirSync(path.dirname(fileName));
			if (fs.existsSync(directory)) fs.rmdirSync(directory);
		}
	});

	it("rejects non-success HTTP responses without exposing the request URL", async () => {
		globalThis.fetch = (async () => jsonResponse({ message: "bad key" }, 401)) as typeof globalThis.fetch;

		let error: any;
		try {
			await httpJSONRequest("https://example.invalid/weather?apiKey=secret");
		} catch (caught) {
			error = caught;
		}

		expect(error).to.be.instanceOf(Error);
		expect(error.errCode).to.equal(12);
		expect(error.message).to.equal("Weather provider returned HTTP 401.");
		expect(error.message).not.to.contain("secret");
	});

	it("groups 23-hour and 25-hour DST days by local calendar date", () => {
		const timezone = "America/New_York";
		const spring = sequence(23, hour => new Date(Date.UTC(2026, 2, 8, 5 + hour)));
		const fall = sequence(25, hour => new Date(Date.UTC(2026, 10, 1, 4 + hour)));
		const records = [...spring, ...fall].map(time => ({ time }));

		const groups = groupByLocalDay(records, record => record.time, timezone);
		expect(groups.map(group => group.records.length)).to.deep.equal([23, 25]);
		expect(completeHistoricalHourlyDays(records, record => record.time, timezone, new Date("2026-03-09T12:00:00Z")))
			.to.have.length(1);
		expect(completeHistoricalHourlyDays(records, record => record.time, timezone, new Date("2026-11-02T12:00:00Z")))
			.to.have.length(1);
	});

	it("returns only contiguous complete history ending yesterday", () => {
		const makeDay = (day: number) => sequence(24, hour => ({
			time: new Date(Date.UTC(2026, 0, day, hour)),
		}));
		const complete = [...makeDay(12), ...makeDay(13), ...makeDay(14)];
		const before = new Date("2026-01-15T12:00:00Z");

		expect(completeHistoricalHourlyDays(complete, record => record.time, "UTC", before))
			.to.have.length(3);
		expect(completeHistoricalHourlyDays(
			complete.filter(record => record.time.getTime() !== Date.UTC(2026, 0, 13, 12)),
			record => record.time,
			"UTC",
			before
		)).to.have.length(1);
		expect(completeHistoricalHourlyDays(
			complete.filter(record => record.time.getTime() !== Date.UTC(2026, 0, 14, 12)),
			record => record.time,
			"UTC",
			before
		)).to.have.length(0);
	});

	it("rejects duplicate hourly slots that conceal a missing hour", () => {
		const records = sequence(24, hour => ({ time: new Date(Date.UTC(2026, 0, 14, hour)) }));
		records[12] = { time: records[11].time };
		expect(completeHistoricalHourlyDays(
			records,
			record => record.time,
			"UTC",
			new Date("2026-01-15T12:00:00Z")
		)).to.have.length(0);
	});

	it("accepts one provider sample anywhere within each hourly slot", () => {
		const records = sequence(24, hour => ({
			time: new Date(Date.UTC(2026, 0, 14, hour, 5)),
		}));
		expect(completeHistoricalHourlyDays(
			records,
			record => record.time,
			"UTC",
			new Date("2026-01-15T12:00:00Z")
		)).to.have.length(1);
	});

	it("averages finite values without treating missing samples as zero", () => {
		expect(averageFinite([0, undefined, NaN, 6])).to.equal(3);
		expect(averageFinite([undefined, NaN])).to.equal(undefined);
	});

	it("time-weights irregular local PWS samples and detects long gaps", () => {
		const records = [
			{ time: 0, value: 0 },
			{ time: 60, value: 10 },
			{ time: 240, value: 10 },
		];
		expect(timeWeightedAverage(records, record => record.time, record => record.value)).to.equal(8.75);
		expect(maximumTimeGap(records, record => record.time)).to.equal(180);
		expect(hasTimeSeriesCoverage(records, record => record.time, record => record.value, 180)).to.equal(true);
		expect(hasTimeSeriesCoverage(records, record => record.time, record => record.value, 120)).to.equal(false);
	});

	it("time-weights a bounded window and checks its edges", () => {
		const records = [
			{ time: 60, value: 0 },
			{ time: 120, value: 10 },
			{ time: 240, value: 10 },
		];
		expect(hasWindowCoverage(records, record => record.time, record => record.value, 0, 300, 120))
			.to.equal(true);
		expect(hasWindowCoverage(records, record => record.time, record => record.value, 0, 300, 59))
			.to.equal(false);
		expect(timeWeightedAverageInWindow(records, record => record.time, record => record.value, 0, 300))
			.to.equal(7);
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

	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
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
	protected getApiKey(): Promise<string> {
		return Promise.resolve("test-token");
	}

	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
	}

	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class TestDWDProvider extends DWDProvider {
	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, undefined);
	}

	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class MissingKeyAppleProvider extends AppleWeatherProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class TokenAppleProvider extends AppleWeatherProvider {
	token(): Promise<string> {
		return this.getApiKey();
	}
}

class TestOWMProvider extends OWMProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, undefined);
	}
}

class TestWUndergroundProvider extends WUndergroundProvider {
	readWeather(value: GeoCoordinates): Promise<WeatherData> {
		return this.getWeatherDataInternal(value, { id: "station", apiKey: "key" });
	}

	readWatering(value: GeoCoordinates): Promise<WateringData[]> {
		return this.getWateringDataInternal(value, { id: "station", apiKey: "key" });
	}
}

function weatherUndergroundForecast() {
	return {
		dayOfWeek: ["Friday", "Saturday"],
		temperatureMin: [60, 61],
		temperatureMax: [80, 81],
		qpf: [0.2, 0.3],
		qpfSnow: [4, 5],
		validTimeUtc: [1, 2],
		narrative: ["Rain", "Showers"],
		daypart: [{ iconCode: [12, 31, 11, 31] }],
	};
}

function sequence<T>(length: number, value: (index: number) => T): T[] {
	return Array.from({ length }, (_, index) => value(index));
}

function jsonResponse(value: unknown, status: number = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: async () => value,
	} as Response;
}
