#!/usr/bin/env node

/*
 * Live HTTP contract and differential test for the OpenSprinkler weather service.
 * This intentionally uses only Node built-ins so it can run after npm install
 * without adding another production or development dependency.
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const locations = JSON.parse(fs.readFileSync(
	path.join(__dirname, "..", "test", "live", "locations.json"),
	"utf8"
));

const PROVIDERS = {
	default: {
		label: "Default (expected Apple)",
		provider: undefined,
		aliases: ["Apple"],
		requiredEnv: ["APPLE_PRIVATE_KEY", "APPLE_KEY_ID", "APPLE_TEAM_ID", "APPLE_SERVICE_ID"],
		smokeLocations: ["new-york"],
		fullLocations: ["new-york", "phoenix", "berlin", "singapore", "sydney"],
	},
	OpenMeteo: {
		label: "Open-Meteo",
		provider: "OpenMeteo",
		aliases: ["OpenMeteo"],
		requiredEnv: [],
		smokeLocations: locations.filter(location => location.smoke).map(location => location.id),
		fullLocations: locations.map(location => location.id),
	},
	DWD: {
		label: "Bright Sky / DWD",
		provider: "DWD",
		aliases: ["DWD"],
		requiredEnv: [],
		smokeLocations: ["berlin"],
		fullLocations: ["berlin", "munich"],
	},
	Apple: {
		label: "Apple WeatherKit",
		provider: "Apple",
		aliases: ["Apple"],
		requiredEnv: ["APPLE_PRIVATE_KEY", "APPLE_KEY_ID", "APPLE_TEAM_ID", "APPLE_SERVICE_ID"],
		smokeLocations: [],
		fullLocations: ["new-york", "phoenix", "berlin", "singapore", "sydney"],
	},
	AW: {
		label: "AccuWeather",
		provider: "AW",
		aliases: ["AW", "AccuWeather"],
		requiredEnv: ["ACCUWEATHER_API_KEY"],
		smokeLocations: [],
		fullLocations: ["new-york", "berlin", "sydney"],
	},
	OWM: {
		label: "OpenWeather",
		provider: "OWM",
		aliases: ["OWM"],
		requiredEnv: ["OWM_API_KEY"],
		smokeLocations: [],
		fullLocations: ["new-york", "phoenix", "berlin", "singapore", "sydney"],
	},
	PW: {
		label: "Pirate Weather",
		provider: "PW",
		aliases: ["PW", "PirateWeather"],
		requiredEnv: ["PIRATEWEATHER_API_KEY"],
		smokeLocations: [],
		fullLocations: ["new-york", "phoenix", "berlin", "singapore", "sydney"],
	},
	WU: {
		label: "Weather Underground PWS",
		provider: "WU",
		aliases: ["WU", "WUnderground"],
		requiredEnv: ["WEATHER_TEST_WU_ID", "WEATHER_TEST_WU_KEY", "WEATHER_TEST_WU_LAT", "WEATHER_TEST_WU_LON"],
		smokeLocations: [],
		fullLocations: ["wu-station"],
	},
	local: {
		label: "Local PWS",
		provider: "local",
		aliases: ["local"],
		forecast: false,
		requiredEnv: [],
		smokeLocations: [],
		fullLocations: ["local-station"],
		optIn: "includeLocalPws",
	},
};

const CORE_ENDPOINTS = [
	{ id: "weather-data", path: "/weatherData", kind: "weather", compare: true },
	{ id: "sensor-current", path: "/weatherSensorData", kind: "sensor", scope: "c" },
	{ id: "sensor-forecast", path: "/weatherSensorData", kind: "sensor", scope: "f" },
	{ id: "sensor-history", path: "/weatherSensorData", kind: "sensor", scope: "h" },
	{ id: "sensor-all", path: "/weatherSensorData", kind: "sensor", scope: "cfh", compare: true },
	{ id: "zimmerman", path: "/1", kind: "zimmerman", compare: true },
	{ id: "rain-delay", path: "/2", kind: "rain" },
	{ id: "eto", path: "/3", kind: "eto", compare: true },
];

const LEGACY_ENDPOINTS = [
	{ id: "legacy-zimmerman", path: "/weather1.py", kind: "zimmerman", json: false },
	{ id: "legacy-rain-delay", path: "/weather2.py", kind: "rain", json: false },
	{ id: "legacy-eto", path: "/weather3.py", kind: "eto", json: false },
];

const COMPARISON_LIMITS = {
	temperature: 20,
	humidity: 35,
	wind: 30,
	precipitation: 5,
	solar: 8,
	eto: 0.5,
	scale: 100,
};

const PLAUSIBILITY_MAX = {
	eto: 0.6,
	solar: 12,
};

const CROSS_PROVIDER_LIMITS = {
	temperatureSpread: 15,
	humiditySpread: 20,
	windRatio: 3,
	windSpread: 5,
	precipitationRatio: 3,
	precipitationSpread: 0.1,
	solarRatio: 3,
	solarSpread: 1,
};

function parseArgs(argv) {
	const options = {
		baseUrl: "http://127.0.0.1:3000",
		compareUrl: undefined,
		profile: "smoke",
		providers: undefined,
		timeoutMs: 30000,
		concurrency: 2,
		delayMs: 0,
		includeLocalPws: false,
		includeUnconfigured: false,
		report: undefined,
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const next = () => {
			if (index + 1 >= argv.length) throw new Error(`Missing value after ${arg}`);
			return argv[++index];
		};
		switch (arg) {
			case "--base": options.baseUrl = next(); break;
			case "--compare": options.compareUrl = next(); break;
			case "--profile": options.profile = next(); break;
			case "--providers": options.providers = next().split(",").filter(Boolean); break;
			case "--timeout": options.timeoutMs = Number(next()); break;
			case "--concurrency": options.concurrency = Number(next()); break;
			case "--delay": options.delayMs = Number(next()); break;
			case "--report": options.report = next(); break;
			case "--include-local-pws": options.includeLocalPws = true; break;
			case "--include-unconfigured": options.includeUnconfigured = true; break;
			case "--help": options.help = true; break;
			default: throw new Error(`Unknown option: ${arg}`);
		}
	}

	if (!['smoke', 'full'].includes(options.profile)) throw new Error("Profile must be smoke or full");
	if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 10) {
		throw new Error("Concurrency must be an integer from 1 to 10");
	}
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) throw new Error("Timeout must be at least 1000 ms");
	return options;
}

function printHelp() {
	console.log(`Usage: npm run test:weather-live -- [options]

Options:
  --profile smoke|full       Select the bounded smoke or comprehensive matrix
  --base URL                 Service under test (default http://127.0.0.1:3000)
  --compare URL              Optional deployed service used for differential warnings
  --providers IDS            Comma-separated provider IDs (default,OpenMeteo,DWD,Apple,AW,OWM,PW,WU,local)
  --timeout MS               Per-request timeout (default 30000)
  --concurrency N            Maximum concurrent requests, 1-10 (default 2)
  --delay MS                 Delay before each request (default 0)
  --include-local-pws        Upload synthetic observations and test the local provider
  --include-unconfigured     Run keyed providers even when their test environment is absent
  --report FILE              JSON report path (default artifacts/weather-live-<time>.json)
  --help                     Show this help

The server must already be running. API credentials are read from .env. Reports redact
credential-like fields and never include request authorization headers.`);
}

function normalizedBase(value) {
	return value.replace(/\/$/, "");
}

function locationById(id) {
	if (id === "wu-station") {
		return {
			id,
			name: `WU station ${process.env.WEATHER_TEST_WU_ID || "unconfigured"}`,
			lat: Number(process.env.WEATHER_TEST_WU_LAT),
			lon: Number(process.env.WEATHER_TEST_WU_LON),
		};
	}
	if (id === "local-station") {
		return { id, name: "Synthetic local PWS", lat: 40.7128, lon: -74.0060 };
	}
	return locations.find(location => location.id === id);
}

function missingEnvironment(provider) {
	return provider.requiredEnv.filter(name => !process.env[name]);
}

function providerOptions(provider, kind) {
	const value = {};
	if (provider.provider) value.provider = provider.provider;
	if (provider.provider === "WU") {
		value.pws = process.env.WEATHER_TEST_WU_ID;
		value.key = process.env.WEATHER_TEST_WU_KEY;
	}
	if (kind === "zimmerman") Object.assign(value, { h: 100, t: 100, r: 100, bh: 30, bt: 70, br: 0 });
	if (kind === "rain") value.d = 24;
	if (kind === "eto" || kind === "sensor") Object.assign(value, { baseETo: 0.2, elevation: 600 });
	return value;
}

function wtoFragment(value) {
	const json = JSON.stringify(value);
	return json.substring(1, json.length - 1);
}

function makeUrl(baseUrl, endpoint, provider, location) {
	const url = new URL(endpoint.path, `${normalizedBase(baseUrl)}/`);
	if (endpoint.path !== "/") {
		url.searchParams.set("loc", endpoint.locationValue ?? `${location.lat},${location.lon}`);
	}
	if (endpoint.scope !== undefined) url.searchParams.set("scope", endpoint.scope);
	if (["manual", "zimmerman", "rain", "eto"].includes(endpoint.kind) && endpoint.json !== false) {
		url.searchParams.set("format", "json");
	}
	const options = provider ? providerOptions(provider, endpoint.kind) : {};
	if (Object.keys(options).length) url.searchParams.set("wto", wtoFragment(options));
	return url;
}

function redactText(value) {
	return String(value)
		.replace(/("?(?:key|apiKey|token|authorization)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3")
		.replace(/(APPLE_PRIVATE_KEY|WEATHER_TEST_WU_KEY|API_KEY)=([^&\s]+)/gi, "$1=[REDACTED]");
}

function redactUrl(value) {
	try {
		const url = new URL(value);
		for (const name of ["key", "apiKey", "token", "authorization"]) {
			if (url.searchParams.has(name)) url.searchParams.set(name, "[REDACTED]");
		}
		if (url.searchParams.has("wto")) url.searchParams.set("wto", redactText(url.searchParams.get("wto")));
		return url.toString();
	} catch (_) {
		return redactText(value);
	}
}

function sanitize(value, key) {
	if (key && /^(key|apiKey|token|authorization|privateKey)$/i.test(key)) return "[REDACTED]";
	if (Array.isArray(value)) return value.map(entry => sanitize(entry));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, sanitize(entry, name)]));
	}
	return typeof value === "string" ? redactText(value) : value;
}

function parseLegacy(text) {
	const result = {};
	for (const part of text.replace(/^&/, "").split("&")) {
		if (!part) continue;
		const separator = part.indexOf("=");
		const name = separator < 0 ? part : part.substring(0, separator);
		let value = separator < 0 ? "" : part.substring(separator + 1).replace(/AMPERSAND/g, "&").replace(/\+/g, " ");
		try { value = JSON.parse(value); } catch (_) {
			if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
		}
		result[name] = value;
	}
	return result;
}

async function request(url, timeoutMs) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const started = Date.now();
	try {
		const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "OpenSprinkler weather live test" } });
		const text = await response.text();
		let body;
		try { body = JSON.parse(text); } catch (_) {
			body = text.startsWith("&") ? parseLegacy(text) : text;
		}
		return { status: response.status, durationMs: Date.now() - started, body: sanitize(body) };
	} catch (error) {
		return {
			status: 0,
			durationMs: Date.now() - started,
			body: undefined,
			error: error.name === "AbortError" ? `Timed out after ${timeoutMs} ms` : redactText(error.message || error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

function finite(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function checkNumber(errors, value, name, min, max) {
	if (!finite(value)) errors.push(`${name} is not finite`);
	else if (value < min || value > max) errors.push(`${name}=${value} is outside ${min}..${max}`);
}

function validateProvider(errors, value, provider) {
	if (!provider.aliases.includes(value)) errors.push(`provider ${JSON.stringify(value)} is not one of ${provider.aliases.join(", ")}`);
}

function validateWeather(body, provider, errors) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return errors.push("response is not a JSON object");
	validateProvider(errors, body.weatherProvider, provider);
	checkNumber(errors, body.temp, "temp", -120, 160);
	checkNumber(errors, body.humidity, "humidity", 0, 100);
	checkNumber(errors, body.wind, "wind", 0, 250);
	if (provider.forecast === false) return;
	checkNumber(errors, body.minTemp, "minTemp", -120, 160);
	checkNumber(errors, body.maxTemp, "maxTemp", -120, 160);
	if (finite(body.minTemp) && finite(body.maxTemp) && body.minTemp > body.maxTemp) errors.push("minTemp exceeds maxTemp");
	checkNumber(errors, body.precip, "precip", 0, 100);
	if (!Array.isArray(body.forecast) || body.forecast.length === 0) return errors.push("forecast is empty or missing");
	let previousDate = 0;
	body.forecast.forEach((day, index) => {
		checkNumber(errors, day.temp_min, `forecast[${index}].temp_min`, -120, 160);
		checkNumber(errors, day.temp_max, `forecast[${index}].temp_max`, -120, 160);
		checkNumber(errors, day.precip, `forecast[${index}].precip`, 0, 100);
		checkNumber(errors, day.date, `forecast[${index}].date`, 1, 5000000000);
		if (finite(day.temp_min) && finite(day.temp_max) && day.temp_min > day.temp_max) errors.push(`forecast[${index}] min exceeds max`);
		if (finite(day.date) && day.date <= previousDate) errors.push(`forecast[${index}] date is not increasing`);
		previousDate = day.date;
	});
}

function validateSensorBlock(body, block, errors) {
	const value = body[block];
	if (!value || typeof value !== "object") return errors.push(`sensor block ${block} is missing`);
	checkNumber(errors, value.at, `${block}.at`, 1, 5000000000);
	if (block === "c") {
		checkNumber(errors, value.t, "c.t", -120, 160);
		checkNumber(errors, value.h, "c.h", 0, 100);
		checkNumber(errors, value.w, "c.w", 0, 250);
		checkNumber(errors, value.r, "c.r", 0, 1);
	} else if (block === "f") {
		checkNumber(errors, value.lo, "f.lo", -120, 160);
		checkNumber(errors, value.hi, "f.hi", -120, 160);
		checkNumber(errors, value.p, "f.p", 0, 100);
		if (finite(value.lo) && finite(value.hi) && value.lo > value.hi) errors.push("f.lo exceeds f.hi");
	} else {
		checkNumber(errors, value.t, "h.t", -120, 160);
		checkNumber(errors, value.h, "h.h", 0, 100);
		checkNumber(errors, value.p, "h.p", 0, 100);
		checkNumber(errors, value.w, "h.w", 0, 250);
		checkNumber(errors, value.sr, "h.sr", 0, PLAUSIBILITY_MAX.solar);
		checkNumber(errors, value.eto, "h.eto", 0, PLAUSIBILITY_MAX.eto);
	}
}

function validateSensor(body, provider, scope, errors) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return errors.push("response is not a JSON object");
	if (body.v !== 1) errors.push(`sensor API version is ${body.v}, expected 1`);
	if (body.u !== "us") errors.push(`sensor unit system is ${body.u}, expected us`);
	validateProvider(errors, body.wp, provider);
	if (body.e && Object.keys(body.e).length) errors.push(`sensor response contains provider errors: ${JSON.stringify(body.e)}`);
	for (const block of ["c", "f", "h"]) {
		if (block === "f" && provider.forecast === false) {
			if (body[block] !== undefined) errors.push(`unsupported sensor block ${block} was returned`);
		} else if (scope.includes(block)) validateSensorBlock(body, block, errors);
		else if (body[block] !== undefined) errors.push(`unrequested sensor block ${block} was returned`);
	}
}

function validateAdjustment(body, provider, kind, errors) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return errors.push("response is not a JSON object");
	if (body.errCode !== 0) errors.push(`errCode=${body.errCode}`);
	if (!body.rawData || typeof body.rawData !== "object") return errors.push("rawData is missing");
	validateProvider(errors, body.rawData.wp, provider);
	if (kind === "zimmerman") {
		checkNumber(errors, body.scale, "scale", 0, 200);
		checkNumber(errors, body.rawData.t, "rawData.t", -120, 160);
		checkNumber(errors, body.rawData.h, "rawData.h", 0, 100);
		checkNumber(errors, body.rawData.p, "rawData.p", 0, 100);
	} else if (kind === "rain") {
		checkNumber(errors, body.rawData.raining, "rawData.raining", 0, 1);
	} else if (kind === "eto") {
		checkNumber(errors, body.scale, "scale", 0, 200);
		checkNumber(errors, body.rawData.eto, "rawData.eto", 0, PLAUSIBILITY_MAX.eto);
		checkNumber(errors, body.rawData.radiation, "rawData.radiation", 0, PLAUSIBILITY_MAX.solar);
		checkNumber(errors, body.rawData.wind, "rawData.wind", 0, 250);
		checkNumber(errors, body.rawData.p, "rawData.p", 0, 100);
	}
}

function validateCase(testCase, response) {
	const errors = [];
	const warnings = [];
	if (response.error) errors.push(response.error);
	if (response.status !== testCase.expectedStatus) errors.push(`HTTP ${response.status}, expected ${testCase.expectedStatus}`);
	if (errors.length) return { errors, warnings };

	const body = response.body;
	switch (testCase.endpoint.kind) {
		case "root":
			if (typeof body !== "string" || !body.includes("OpenSprinkler Weather Service")) errors.push("unexpected root response");
			break;
		case "baseline":
			checkNumber(errors, body?.eto, "eto", 0, PLAUSIBILITY_MAX.eto);
			break;
		case "manual":
			if (body?.errCode !== 0) errors.push(`errCode=${body?.errCode}`);
			checkNumber(errors, body?.tz, "tz", 0, 96);
			checkNumber(errors, body?.sunrise, "sunrise", 0, 1440);
			checkNumber(errors, body?.sunset, "sunset", 0, 1440);
			break;
		case "weather": validateWeather(body, testCase.provider, errors); break;
		case "sensor": validateSensor(body, testCase.provider, testCase.endpoint.scope, errors); break;
		case "zimmerman":
		case "rain":
		case "eto": validateAdjustment(body, testCase.provider, testCase.endpoint.kind, errors); break;
		case "invalid-scope":
			if (body?.errCode !== 50) errors.push(`errCode=${body?.errCode}, expected 50`);
			break;
		case "invalid-location":
			if (body?.errCode !== 22) errors.push(`errCode=${body?.errCode}, expected 22`);
			break;
	}
	return { errors, warnings };
}

function numericDifference(warnings, left, right, name, limit) {
	if (finite(left) && finite(right) && Math.abs(left - right) > limit) {
		warnings.push(`${name} differs by ${Math.abs(left - right).toFixed(3)} (local=${left}, comparison=${right})`);
	}
}

function compareResponses(testCase, local, deployed) {
	const warnings = [];
	if (deployed.error) return [`comparison request failed: ${deployed.error}`];
	if (local.status !== deployed.status) warnings.push(`comparison HTTP status is ${deployed.status}, local is ${local.status}`);
	const left = local.body;
	const right = deployed.body;
	if (!left || !right || typeof left !== "object" || typeof right !== "object") return warnings;

	if (testCase.endpoint.kind === "weather") {
		if (left.weatherProvider !== right.weatherProvider) warnings.push(`provider differs: ${left.weatherProvider} vs ${right.weatherProvider}`);
		numericDifference(warnings, left.temp, right.temp, "temperature", COMPARISON_LIMITS.temperature);
		numericDifference(warnings, left.humidity, right.humidity, "humidity", COMPARISON_LIMITS.humidity);
		numericDifference(warnings, left.wind, right.wind, "wind", COMPARISON_LIMITS.wind);
		numericDifference(warnings, left.precip, right.precip, "precipitation", COMPARISON_LIMITS.precipitation);
	} else if (testCase.endpoint.kind === "sensor") {
		for (const block of ["c", "f", "h"]) {
			const a = left[block] || {};
			const b = right[block] || {};
			numericDifference(warnings, a.t, b.t, `${block}.temperature`, COMPARISON_LIMITS.temperature);
			numericDifference(warnings, a.h, b.h, `${block}.humidity`, COMPARISON_LIMITS.humidity);
			numericDifference(warnings, a.w, b.w, `${block}.wind`, COMPARISON_LIMITS.wind);
			numericDifference(warnings, a.p, b.p, `${block}.precipitation`, COMPARISON_LIMITS.precipitation);
			numericDifference(warnings, a.sr, b.sr, `${block}.solar`, COMPARISON_LIMITS.solar);
			numericDifference(warnings, a.eto, b.eto, `${block}.eto`, COMPARISON_LIMITS.eto);
		}
	} else if (["zimmerman", "eto"].includes(testCase.endpoint.kind)) {
		numericDifference(warnings, left.scale, right.scale, "scale", COMPARISON_LIMITS.scale);
		if (left.errCode !== right.errCode) warnings.push(`errCode differs: ${left.errCode} vs ${right.errCode}`);
	} else if (testCase.endpoint.kind === "baseline") {
		numericDifference(warnings, left.eto, right.eto, "baseline ETo", 0.05);
	}
	return warnings;
}

function buildCases(options) {
	const selected = options.providers || (options.profile === "smoke"
		? ["default", "OpenMeteo", "DWD"]
		: Object.keys(PROVIDERS));
	const cases = [];
	const skipped = [];

	for (const id of selected) {
		const provider = PROVIDERS[id];
		if (!provider) throw new Error(`Unknown provider ID: ${id}`);
		if (provider.optIn && !options[provider.optIn]) {
			skipped.push({ provider: id, reason: `requires --${provider.optIn.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}` });
			continue;
		}
		const missing = missingEnvironment(provider);
		if (missing.length && !options.includeUnconfigured) {
			skipped.push({ provider: id, reason: `missing ${missing.join(", ")}` });
			continue;
		}
		const ids = options.profile === "smoke" ? provider.smokeLocations : provider.fullLocations;
		for (const locationId of ids) {
			const location = locationById(locationId);
			if (!location || !finite(location.lat) || !finite(location.lon)) {
				skipped.push({ provider: id, location: locationId, reason: "location is not configured" });
				continue;
			}
			const endpoints = options.profile === "full" ? [...CORE_ENDPOINTS, ...LEGACY_ENDPOINTS] : CORE_ENDPOINTS;
			for (const endpoint of endpoints) {
				cases.push({
					id: `${id}:${location.id}:${endpoint.id}`,
					providerId: id,
					provider,
					location,
					endpoint,
					expectedStatus: 200,
				});
			}
		}
	}

	const commonLocation = locationById("new-york");
	const common = [
		{ id: "service-root", endpoint: { path: "/", kind: "root" }, expectedStatus: 200 },
		{ id: "baseline-eto", endpoint: { path: "/baselineETo", kind: "baseline", compare: true }, expectedStatus: 200 },
		{ id: "manual", endpoint: { path: "/0", kind: "manual" }, expectedStatus: 200 },
		{ id: "legacy-manual", endpoint: { path: "/weather0.py", kind: "manual", json: false }, expectedStatus: 200 },
		{ id: "invalid-scope", endpoint: { path: "/weatherSensorData", kind: "invalid-scope", scope: "x" }, expectedStatus: 400 },
		{ id: "invalid-location", endpoint: { path: "/weatherSensorData", kind: "invalid-location", scope: "c", locationValue: "pws:test" }, expectedStatus: 400 },
	];
	for (const entry of common) {
		cases.unshift({ ...entry, provider: PROVIDERS.OpenMeteo, providerId: "OpenMeteo", location: commonLocation });
	}
	return { cases, skipped };
}

async function prepareLocalPws(baseUrl, timeoutMs) {
	const now = Date.now();
	const start = now - 48 * 60 * 60 * 1000;
	for (let index = 0; index <= 48; index++) {
		const timestamp = new Date(start + index * 60 * 60 * 1000);
		const url = new URL("/weatherstation/updateweatherstation.php", `${normalizedBase(baseUrl)}/`);
		url.searchParams.set("dateutc", timestamp.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""));
		url.searchParams.set("tempf", String(55 + 15 * Math.sin(index / 24 * Math.PI)));
		url.searchParams.set("humidity", String(75 - 25 * Math.sin(index / 24 * Math.PI)));
		url.searchParams.set("windspeedmph", String(3 + index % 5));
		url.searchParams.set("solarradiation", String(Math.max(0, 700 * Math.sin(index / 24 * Math.PI))));
		url.searchParams.set("dailyrainin", "0");
		url.searchParams.set("rainin", "0");
		const response = await request(url, timeoutMs);
		if (response.status !== 200 || !String(response.body).includes("success")) {
			throw new Error(`local PWS upload ${index + 1} failed with HTTP ${response.status}`);
		}
	}
}

async function runPool(items, concurrency, worker) {
	let next = 0;
	const results = new Array(items.length);
	async function run() {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
	return results;
}

function addCrossCaseWarnings(results) {
	const byId = new Map(results.map(result => [result.id, result]));
	for (const result of results) {
		if (!result.id.endsWith(":sensor-all") || result.status === "fail") continue;
		const prefix = result.id.substring(0, result.id.length - "sensor-all".length);
		const weather = byId.get(`${prefix}weather-data`);
		const eto = byId.get(`${prefix}eto`);
		if (weather?.response?.body && result.response?.body?.c) {
			numericDifference(result.warnings, weather.response.body.temp, result.response.body.c.t, "cross-endpoint current temperature", 1.1);
			numericDifference(result.warnings, weather.response.body.humidity, result.response.body.c.h, "cross-endpoint current humidity", 1.1);
			numericDifference(result.warnings, weather.response.body.wind, result.response.body.c.w, "cross-endpoint current wind", 1.1);
		}
		if (eto?.response?.body?.rawData && result.response?.body?.h) {
			numericDifference(result.warnings, eto.response.body.rawData.eto, result.response.body.h.eto, "cross-endpoint ETo", 0.002);
			numericDifference(result.warnings, eto.response.body.rawData.p, result.response.body.h.p, "cross-endpoint historical precipitation", 0.02);
			numericDifference(result.warnings, eto.response.body.rawData.radiation, result.response.body.h.sr, "cross-endpoint solar radiation", 0.02);
		}
		if (result.warnings.length && result.status === "pass") result.status = "warn";
	}
}

function ratioExceeds(values, ratio, minimumSpread) {
	const minimum = Math.min(...values);
	const maximum = Math.max(...values);
	if (maximum - minimum <= minimumSpread) return false;
	return minimum <= 0 ? maximum > minimumSpread : maximum / minimum > ratio;
}

function addCrossProviderWarnings(results) {
	const groups = new Map();
	for (const result of results) {
		if (!result.id.endsWith(":sensor-all") || result.status === "fail") continue;
		const body = result.response?.body;
		if (!body?.c || !body?.h) continue;
		const key = result.locationId || result.location;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(result);
	}

	const warnings = [];
	const inspect = (location, entries, label, read, isOutlier) => {
		const samples = entries
			.map(result => ({ result, value: read(result.response.body) }))
			.filter(sample => finite(sample.value));
		if (samples.length < 2 || !isOutlier(samples.map(sample => sample.value))) return;
		const details = samples.map(sample => `${sample.result.provider}=${sample.value}`).join(", ");
		const warning = `cross-provider ${label} outlier at ${location}: ${details}`;
		warnings.push(warning);
		const anchor = samples[0].result;
		anchor.warnings.push(warning);
		if (anchor.status === "pass") anchor.status = "warn";
	};

	for (const [location, entries] of groups) {
		inspect(location, entries, "current temperature", body => body.c.t,
			values => Math.max(...values) - Math.min(...values) > CROSS_PROVIDER_LIMITS.temperatureSpread);
		inspect(location, entries, "current humidity", body => body.c.h,
			values => Math.max(...values) - Math.min(...values) > CROSS_PROVIDER_LIMITS.humiditySpread);
		inspect(location, entries, "historical wind", body => body.h.w,
			values => ratioExceeds(values, CROSS_PROVIDER_LIMITS.windRatio, CROSS_PROVIDER_LIMITS.windSpread));
		inspect(location, entries, "historical precipitation", body => body.h.p,
			values => ratioExceeds(values, CROSS_PROVIDER_LIMITS.precipitationRatio, CROSS_PROVIDER_LIMITS.precipitationSpread));
		inspect(location, entries, "historical solar radiation", body => body.h.sr,
			values => ratioExceeds(values, CROSS_PROVIDER_LIMITS.solarRatio, CROSS_PROVIDER_LIMITS.solarSpread));
	}
	return warnings;
}

function reportPath(options) {
	if (options.report) return path.resolve(options.report);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return path.resolve("artifacts", `weather-live-${stamp}.json`);
}

async function main() {
	let options;
	try { options = parseArgs(process.argv.slice(2)); }
	catch (error) {
		console.error(error.message);
		printHelp();
		process.exitCode = 2;
		return;
	}
	if (options.help) return printHelp();
	options.baseUrl = normalizedBase(options.baseUrl);
	if (options.compareUrl) options.compareUrl = normalizedBase(options.compareUrl);

	const { cases, skipped } = buildCases(options);
	console.log(`Weather live test: ${options.profile} profile, ${cases.length} cases, base ${options.baseUrl}`);
	if (options.compareUrl) console.log(`Differential comparison: ${options.compareUrl}`);
	for (const item of skipped) console.log(`SKIP ${item.provider}${item.location ? `/${item.location}` : ""}: ${item.reason}`);

	if (options.includeLocalPws) {
		console.log("Preparing 48 hours of synthetic local PWS observations...");
		try { await prepareLocalPws(options.baseUrl, options.timeoutMs); }
		catch (error) {
			console.error(`Local PWS preparation failed: ${error.message}`);
			process.exitCode = 1;
			return;
		}
	}

	const results = await runPool(cases, options.concurrency, async testCase => {
		if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
		const endpoint = testCase.endpoint;
		const location = testCase.location;
		const url = makeUrl(options.baseUrl, endpoint, testCase.provider, location);
		const response = await request(url, options.timeoutMs);
		const validation = validateCase(testCase, response);
		let comparison;
		if (options.compareUrl && endpoint.compare && testCase.providerId !== "WU" && testCase.providerId !== "local") {
			const compareUrl = makeUrl(options.compareUrl, endpoint, testCase.provider, location);
			comparison = await request(compareUrl, options.timeoutMs);
			validation.warnings.push(...compareResponses(testCase, response, comparison));
		}
		const status = validation.errors.length ? "fail" : validation.warnings.length ? "warn" : "pass";
		const result = {
			id: testCase.id,
			status,
			provider: testCase.providerId,
			location: testCase.location.name,
			locationId: testCase.location.id,
			endpoint: testCase.endpoint.path,
			request: redactUrl(url),
			errors: validation.errors,
			warnings: validation.warnings,
			response,
			comparison,
		};
		console.log(`${status.toUpperCase().padEnd(4)} ${testCase.id} (${response.durationMs} ms)${validation.errors.length ? `: ${validation.errors.join("; ")}` : ""}`);
		return result;
	});

	addCrossCaseWarnings(results);
	const crossProviderWarnings = addCrossProviderWarnings(results);
	for (const warning of crossProviderWarnings) console.log(`WARN ${warning}`);
	const summary = {
		pass: results.filter(result => result.status === "pass").length,
		warn: results.filter(result => result.status === "warn").length,
		fail: results.filter(result => result.status === "fail").length,
		skip: skipped.length,
	};
	const report = {
		version: 1,
		startedAt: new Date().toISOString(),
		profile: options.profile,
		baseUrl: options.baseUrl,
		compareUrl: options.compareUrl,
		summary,
		skipped,
		crossProviderWarnings,
		results,
	};
	const output = reportPath(options);
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, JSON.stringify(report, null, 2));
	console.log(`\nSummary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary.skip} skipped`);
	console.log(`Report: ${output}`);
	if (summary.fail) process.exitCode = 1;
}

if (require.main === module) {
	main().catch(error => {
		console.error(redactText(error.stack || error));
		process.exitCode = 1;
	});
}

module.exports = {
	addCrossProviderWarnings,
	buildCases,
	compareResponses,
	makeUrl,
	parseArgs,
	parseLegacy,
	redactText,
	redactUrl,
	validateCase,
};
