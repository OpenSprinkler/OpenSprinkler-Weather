import { expect } from "chai";
import { createRequire } from "module";

const load = createRequire(import.meta.url);
const {
	addCrossProviderWarnings,
	buildCases,
	makeUrl,
	parseArgs,
	parseLegacy,
	redactUrl,
	validateCase,
} = load("../tools/weather-live-test.js");

describe("Weather live test runner", () => {
	it("parses profiles and rejects unsafe concurrency", () => {
		expect(parseArgs(["--profile", "full", "--concurrency", "3"]).profile).to.equal("full");
		expect(() => parseArgs(["--concurrency", "20"])).to.throw("Concurrency");
	});

	it("parses legacy controller responses", () => {
		expect(parseLegacy('&scale=100&rawData={"wp":"OpenMeteo"}&errCode=0')).to.deep.equal({
			scale: 100,
			rawData: { wp: "OpenMeteo" },
			errCode: 0,
		});
	});

	it("redacts API keys embedded in weather options", () => {
		const url = new URL("http://localhost/weatherData");
		url.searchParams.set("wto", '"provider":"WU","key":"0123456789abcdef"');
		const redacted = redactUrl(url.toString());
		expect(redacted).not.to.contain("0123456789abcdef");
		expect(redacted).to.contain("REDACTED");
	});

	it("constructs controller-compatible provider options", () => {
		const provider = {
			provider: "OpenMeteo",
			aliases: ["OpenMeteo"],
		};
		const url = makeUrl(
			"http://localhost:3000",
			{ path: "/3", kind: "eto" },
			provider,
			{ lat: 42, lon: -75 }
		);
		expect(url.pathname).to.equal("/3");
		expect(url.searchParams.get("loc")).to.equal("42,-75");
		expect(url.searchParams.get("wto")).to.contain('"provider":"OpenMeteo"');
		expect(url.searchParams.get("wto")).to.contain('"baseETo":0.2');
	});

	it("builds a bounded smoke matrix", () => {
		const { cases } = buildCases(parseArgs(["--profile", "smoke", "--providers", "OpenMeteo,DWD"]));
		expect(cases.length).to.be.greaterThan(10);
		expect(cases.some(testCase => testCase.id.includes("OpenMeteo:new-york:weather-data"))).to.equal(true);
		expect(cases.some(testCase => testCase.id.includes("DWD:berlin:eto"))).to.equal(true);
	});

	it("rejects implausible weather responses", () => {
		const testCase = {
			expectedStatus: 200,
			provider: { aliases: ["OpenMeteo"] },
			endpoint: { kind: "weather" },
		};
		const validation = validateCase(testCase, {
			status: 200,
			body: {
				weatherProvider: "OpenMeteo",
				temp: 70,
				humidity: 150,
				wind: 5,
				minTemp: 60,
				maxTemp: 80,
				precip: 0,
				forecast: [{ temp_min: 60, temp_max: 80, precip: 0, date: 100 }],
			},
		});
		expect(validation.errors.join(" ")).to.contain("humidity");
	});

	it("accepts current-only weather from a provider without forecasts", () => {
		const provider = { aliases: ["local"], forecast: false };
		const weatherValidation = validateCase({
			expectedStatus: 200,
			provider,
			endpoint: { kind: "weather" },
		}, {
			status: 200,
			body: { weatherProvider: "local", temp: 70, humidity: 50, wind: 2, forecast: [] },
		});
		const sensorValidation = validateCase({
			expectedStatus: 200,
			provider,
			endpoint: { kind: "sensor", scope: "cfh" },
		}, {
			status: 200,
			body: {
				v: 1,
				u: "us",
				wp: "local",
				e: {},
				c: { at: 1, t: 70, h: 50, w: 2, r: 0 },
				h: { at: 1, t: 70, h: 50, p: 0, w: 2, sr: 5, eto: 0.1 },
			},
		});

		expect(weatherValidation.errors).to.deep.equal([]);
		expect(sensorValidation.errors).to.deep.equal([]);
	});

	it("rejects implausible ETo and solar-radiation scales", () => {
		const testCase = {
			expectedStatus: 200,
			provider: { aliases: ["OpenMeteo"] },
			endpoint: { kind: "sensor", scope: "h" },
		};
		const validation = validateCase(testCase, {
			status: 200,
			body: {
				v: 1,
				u: "us",
				wp: "OpenMeteo",
				e: {},
				h: { at: 100, t: 70, h: 50, p: 0, w: 5, sr: 15, eto: 1 },
			},
		});
		expect(validation.errors.join(" ")).to.contain("h.sr");
		expect(validation.errors.join(" ")).to.contain("h.eto");
	});

	it("flags gross cross-provider outliers for a shared location", () => {
		const result = (provider: string, precip: number) => ({
			id: `${provider}:new-york:sensor-all`,
			status: "pass",
			provider,
			location: "New York",
			locationId: "new-york",
			warnings: [],
			response: {
				body: {
					c: { t: 70, h: 50 },
					h: { p: precip, w: 5, sr: 5 },
				},
			},
		});
		const results = [result("OpenMeteo", 0.05), result("PW", 0.5)];
		const warnings = addCrossProviderWarnings(results);

		expect(warnings).to.have.length(1);
		expect(warnings[0]).to.contain("historical precipitation");
		expect(results[0].status).to.equal("warn");
	});
});
