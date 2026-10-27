#!/usr/bin/env node

// An isolated HTTP smoke test: synthetic local history plus live OpenMeteo forecasts.
// No .env, station credentials, persistent observations, or deployed server are used.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const root = path.resolve(__dirname, "..");
const location = "42,-75";
const currentFields = ["weatherProvider", "temp", "humidity", "wind", "raining", "description", "icon"];
const forecastFields = ["forecast", "precip", "minTemp", "maxTemp"];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const calendarDay = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(new Date());

function parseArgs(args) {
	const options = { timeout: 30000, report: path.join(root, "artifacts", `local-forecast-smoke-${Date.now()}.json`) };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--help") options.help = true;
		else if (args[i] === "--timeout" && args[i + 1]) options.timeout = Number(args[++i]);
		else if (args[i] === "--report" && args[i + 1]) options.report = path.resolve(args[++i]);
		else throw new Error(`Unknown or incomplete option: ${args[i]}`);
	}
	assert(Number.isInteger(options.timeout) && options.timeout >= 1000 && options.timeout <= 60000,
		"--timeout must be 1000..60000 milliseconds");
	return options;
}

async function availablePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	return port;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: npm run test:local-forecast -- [--timeout MS] [--report FILE]\nBuilds and tests isolated local-only and local + OpenMeteo servers. Requires internet access; no API key.");
		return;
	}
	await fs.access(path.join(root, "dist", "index.cjs"));
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "os-local-forecast-"));
	const report = { startedAt: new Date().toISOString(), location, checks: [], servers: [], results: {} };
	const controller = new AbortController();
	const deadline = setTimeout(() => controller.abort(new Error("Smoke test exceeded two minutes")), 120000);
	const onSignal = signal => controller.abort(new Error(`Interrupted by ${signal}`));
	const onInterrupt = () => onSignal("SIGINT");
	const onTerminate = () => onSignal("SIGTERM");
	process.once("SIGINT", onInterrupt);
	process.once("SIGTERM", onTerminate);
	let active;
	let failed = false;
	const pass = label => { report.checks.push(label); console.log(`PASS ${label}`); };

	async function request(base, route, params = {}) {
		const url = new URL(route, base);
		url.search = new URLSearchParams(params).toString();
		const response = await fetch(url, {
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeout)]),
		});
		const text = await response.text();
		assert.equal(response.status, 200, `${route}: HTTP ${response.status}: ${text.slice(0, 200)}`);
		return text;
	}
	async function weatherRequest(base, route, options = {}, scope) {
		const params = { loc: location, format: "json", wto: JSON.stringify({ provider: "local", baseETo: 0.15, elevation: 600, ...options }).slice(1, -1) };
		if (scope) params.scope = scope;
		const text = await request(base, route, params);
		assert(!text.startsWith("Error:"), `${route}: ${text}`);
		return JSON.parse(text);
	}
	async function stopServer() {
		if (!active) return;
		const server = active;
		if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill("SIGTERM");
		const force = setTimeout(() => server.child.kill("SIGKILL"), 7000);
		try { await server.closed; }
		finally { clearTimeout(force); active = undefined; }
	}
	async function startServer(override) {
		const port = await availablePort();
		const base = `http://127.0.0.1:${port}`;
		const log = { mode: override ? "local + OpenMeteo" : "local only", output: "" };
		report.servers.push(log);
		const env = {
			HOST: "127.0.0.1", PORT: String(port), PWS: "WU", WEATHER_PROVIDER: "local",
			FORECAST_WEATHER_PROVIDER: override, LOCAL_PERSISTENCE: "false", LOG_LEVEL: "silent",
			DOTENV_CONFIG_PATH: path.join(directory, "empty.env"),
		};
		// Windows needs its system directory; otherwise inherit no user environment.
		for (const name of ["SystemRoot", "WINDIR"]) if (process.env[name]) env[name] = process.env[name];
		const child = spawn(process.execPath, [path.join(root, "dist", "index.cjs")], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
		let spawnError;
		child.on("error", error => { spawnError = error; });
		const closed = new Promise(resolve => child.once("close", resolve));
		active = { child, closed };
		for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
			log.output = (log.output + data.toString()).slice(-16000);
		});
		const until = Date.now() + 10000;
		while (!log.output.includes("now listening on")) {
			controller.signal.throwIfAborted();
			if (spawnError) throw spawnError;
			assert(child.exitCode === null && child.signalCode === null, `Server exited during startup: ${log.output}`);
			assert(Date.now() < until, `Server startup timed out: ${log.output}`);
			await delay(100, undefined, { signal: controller.signal });
		}
		assert.match(await request(base, "/"), /^OpenSprinkler Weather Service v/);
		console.log(`Testing ${log.mode} on a temporary loopback server...`);
		return base;
	}
	// The same timestamps and measurements are uploaded to each fresh server.
	const now = Date.now();
	const day = calendarDay();
	async function seed(base) {
		for (let i = 0; i <= 144; i++) {
			const date = new Date(now - (144 - i) * 30 * 60 * 1000);
			const result = await request(base, "/weatherstation/updateweatherstation.php", {
				dateutc: date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
				tempf: "70", humidity: "30", windspeedmph: "4", solarradiation: "200", dailyrainin: "0", rainin: "0",
			});
			assert.equal(result.trim(), "success", "Local upload was not accepted");
		}
	}
	function checkAdjustment(value) {
		assert.equal(value.errCode, 0, "Adjustment returned an error");
		assert.equal(value.rawData?.wp, "local");
		assert(Number.isFinite(value.scale) && value.scale >= 0 && value.scale <= 200, "Invalid adjustment scale");
		assert(Array.isArray(value.scales) && value.scales.length > 0, "Missing rolling scales");
	}
	async function snapshot(base, mixed) {
		const weather = await weatherRequest(base, "/weatherData");
		assert.deepEqual(pick(weather, ["weatherProvider", "temp", "humidity", "wind", "raining"]),
			{ weatherProvider: "local", temp: 70, humidity: 30, wind: 4, raining: false });
		assert(Number.isFinite(weather.ttl) && weather.ttl > 0, "Missing positive weather TTL");
		if (mixed) {
			assert.equal(weather.forecastProvider, "OpenMeteo", "Separate forecast missing or failed");
			assert(Array.isArray(weather.forecast) && weather.forecast.length > 0, "Empty forecast");
			for (const field of ["precip", "minTemp", "maxTemp"]) assert(Number.isFinite(weather[field]), `Missing ${field}`);
			assert(weather.precip >= 0 && weather.minTemp <= weather.maxTemp, "Invalid daily forecast");
			for (const forecast of weather.forecast) {
				for (const field of ["date", "temp_min", "temp_max", "precip"]) assert(Number.isFinite(forecast[field]), `Missing forecast ${field}`);
				assert(forecast.precip >= 0 && forecast.temp_min <= forecast.temp_max, "Invalid forecast day");
			}
		} else {
			assert.equal(weather.forecastProvider, undefined);
			assert.deepEqual(weather.forecast, []);
		}
		pass(`${mixed ? "mixed" : "local"} display: source identities and uploaded current conditions`);

		const sensors = {};
		for (const scope of ["cfh", "c", "f", "h"]) {
			const sensor = await weatherRequest(base, "/weatherSensorData", {}, scope);
			sensors[scope] = sensor;
			assert.equal(sensor.v, 1);
			assert.equal(sensor.u, "us");
			assert.equal(sensor.e, undefined, `Sensor error in scope ${scope}`);
			assert.equal(sensor.wp, mixed && scope === "f" ? undefined : "local");
			for (const block of ["c", "f", "h"]) {
				const expected = scope.includes(block) && (block !== "f" || mixed);
				assert.equal(sensor[block] !== undefined, expected, `Unexpected/missing ${block} in scope ${scope}`);
				if (expected) assert(Number.isFinite(sensor[block].at), `Missing ${block} timestamp`);
			}
		}
		assert.deepEqual(pick(sensors.c.c, ["t", "h", "w", "r"]), { t: 70, h: 30, w: 4, r: 0 });
		assert.deepEqual(pick(sensors.h.h, ["t", "h", "w", "p", "sr"]), { t: 70, h: 30, w: 4, p: 0, sr: 4.8 });
		assert(Number.isFinite(sensors.h.h.eto), "Missing historical ETo");
		assert.deepEqual(sensors.c.c, sensors.cfh.c);
		assert.deepEqual(sensors.h.h, sensors.cfh.h);
		if (mixed) {
			assert.deepEqual(sensors.f.f, sensors.cfh.f);
			assert.deepEqual(sensors.f.f, { at: weather.forecast[0].date, lo: round(weather.minTemp, 1), hi: round(weather.maxTemp, 1), p: round(weather.precip, 3) });
		}
		pass(`${mixed ? "mixed" : "local"} sensors: c, f, h, cfh scopes and source values`);
		const adjustments = {};
		for (const method of [1, 3]) {
			adjustments[method] = await weatherRequest(base, `/${method}`);
			checkAdjustment(adjustments[method]);
		}
		pass(`${mixed ? "mixed" : "local"} Zimmerman and ETo return valid local calculations`);
		return { weather, sensors, adjustments };
	}
	try {
		await fs.writeFile(path.join(directory, "empty.env"), "");
		let base = await startServer("");
		await seed(base);
		const baseline = report.results.local = await snapshot(base, false);
		await stopServer();
		base = await startServer("OpenMeteo");
		await seed(base);
		const mixed = report.results.mixed = await snapshot(base, true);
		assert.equal(calendarDay(), day, "Local midnight occurred during the test; rerun with a consistent history window");
		assert.deepEqual(pick(mixed.weather, currentFields), pick(baseline.weather, currentFields));
		assert.deepEqual(mixed.sensors.h.h, baseline.sensors.h.h);
		for (const method of [1, 3]) {
			assert.deepEqual(pick(mixed.adjustments[method], ["scale", "scales", "rawData", "restricted"]),
				pick(baseline.adjustments[method], ["scale", "scales", "rawData", "restricted"]));
		}
		pass("Adding forecasts leaves local history and Zimmerman/ETo inputs and scales unchanged");

		// This per-request selection uses the same OpenMeteo instance/cache as the override.
		const provider = await weatherRequest(base, "/weatherData", { provider: "OpenMeteo" });
		assert.equal(provider.weatherProvider, "OpenMeteo");
		assert.equal(provider.forecastProvider, undefined);
		assert.deepEqual(pick(mixed.weather, forecastFields), pick(provider, forecastFields));
		pass("Mixed forecast fields match the direct OpenMeteo response");

		const rain = mixed.weather.forecast[0].precip;
		const thresholds = [rain + 1, ...(rain > 0 ? [rain / 2] : [])];
		for (const method of [1, 3]) {
			for (const threshold of thresholds) {
				const result = await weatherRequest(base, `/${method}`, { rainAmt: threshold, rainDays: 1 });
				checkAdjustment(result);
				assert.equal(result.restricted === 1, rain > threshold, "Rain restriction disagrees with forecast");
				assert.deepEqual(pick(result, ["rawData", "scale", "scales"]), pick(mixed.adjustments[method], ["rawData", "scale", "scales"]));
			}
			for (const minTemp of [69, 71]) {
				const result = await weatherRequest(base, `/${method}`, { minTemp });
				checkAdjustment(result);
				assert.equal(result.restricted === 1, 70 < minTemp, "Temperature restriction disagrees with local observation");
			}
		}
		pass("Rain restrictions follow forecast; temperature restrictions follow the 70F local observation");
		if (rain === 0) {
			report.note = "Live forecast is dry: rain restriction activation remains covered by deterministic tests.";
			console.log(`NOTE ${report.note}`);
		}
	} catch (error) {
		failed = true;
		report.error = controller.signal.aborted ? controller.signal.reason.message : error.stack || String(error);
		console.error(`FAIL ${report.error}`);
	} finally {
		await stopServer();
		clearTimeout(deadline);
		process.removeListener("SIGINT", onInterrupt);
		process.removeListener("SIGTERM", onTerminate);
		await fs.rm(directory, { recursive: true, force: true });
		report.finishedAt = new Date().toISOString();
		report.status = failed ? "fail" : "pass";
		await fs.mkdir(path.dirname(options.report), { recursive: true });
		await fs.writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
		console.log(`\n${report.checks.length} checks passed; ${failed ? "FAILED" : "PASSED"}. Temporary servers stopped and observations removed.\nReport: ${options.report}`);
	}
	if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
