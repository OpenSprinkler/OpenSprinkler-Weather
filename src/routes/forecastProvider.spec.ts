import { expect } from "chai";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import { getWateringData, getWeatherData, getWeatherSensorData } from "./weather";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import { CachedResult } from "../cache";
import { GeoCoordinates, PWS, WeatherData, WateringData } from "../types";

const Request = MockExpressRequest as unknown as new (options: object) => any;
const current: WeatherData = {
    weatherProvider: "local", temp: 70, humidity: 30, wind: 4, raining: false,
    description: "Current", icon: "01d", region: undefined, city: undefined,
    forecast: [],
};
const forecast: WeatherData = {
    ...current, weatherProvider: "OpenMeteo", temp: 40, humidity: 90,
    minTemp: 35, maxTemp: 60, precip: 0.5,
    forecast: [{ temp_min: 35, temp_max: 60, precip: 0.5, date: 1780000000, icon: "10d", description: "Rain" }],
};
const history: WateringData[] = [{
    weatherProvider: "local", temp: 70, humidity: 30, precip: 0,
    minTemp: 60, maxTemp: 80, minHumidity: 20, maxHumidity: 40,
    periodStartTime: 1780000000, windSpeed: 4, solarRadiation: 5,
}];
const cached = <T>(value: T, ttl = 5000): CachedResult<T> => ({ value, ttl, cachedAt: 1780000000000 });
const wuOptions = { provider: "WU", pws: "TESTSTATION", key: "a".repeat(32) };
function requestFor(options: object, scope = "cfh", method = 0) {
    const request = new Request({
        method: "GET", url: "/weather", params: [method],
        query: { loc: "42,-75", format: "json", scope, wto: JSON.stringify(options).slice(1, -1) },
        headers: { "x-forwarded-for": "127.0.0.1" },
    });
    return { request, response: new MockExpressResponse({ request }) };
}

describe("Forecast provider endpoint compatibility", () => {
    let originalWeather: typeof WeatherProvider.prototype.getWeatherData;
    let originalHistory: typeof WeatherProvider.prototype.getWateringData;
    let originalOverride: string | undefined;
    let calls: { provider: string; pws?: PWS; kind: string }[];
    let fail: string | undefined;
    beforeEach(() => {
        originalOverride = process.env.FORECAST_WEATHER_PROVIDER;
        delete process.env.FORECAST_WEATHER_PROVIDER;
        originalWeather = WeatherProvider.prototype.getWeatherData;
        originalHistory = WeatherProvider.prototype.getWateringData;
        calls = [];
        fail = undefined;
        WeatherProvider.prototype.getWeatherData = async function(_coordinates: GeoCoordinates, pws?: PWS) {
            const provider = this.constructor.name;
            calls.push({ provider, pws, kind: "weather" });
            if (provider === fail) throw new Error("fixture outage");
            if (provider === "WUndergroundWeatherProvider" && !pws) throw new Error("missing PWS");
            return provider === "LocalWeatherProvider"
                ? cached(current) : cached(forecast, 2000);
        };
        WeatherProvider.prototype.getWateringData = async function(_coordinates: GeoCoordinates, pws?: PWS) {
            calls.push({ provider: this.constructor.name, pws, kind: "history" });
            return cached(history);
        };
    });
    afterEach(() => {
        WeatherProvider.prototype.getWeatherData = originalWeather;
        WeatherProvider.prototype.getWateringData = originalHistory;
        if (originalOverride === undefined) delete process.env.FORECAST_WEATHER_PROVIDER;
        else process.env.FORECAST_WEATHER_PROVIDER = originalOverride;
    });

    it("keeps WU station credentials and reuses its weather result for the sensor forecast", async () => {
        const { request, response } = requestFor(wuOptions, "cf");
        await getWeatherSensorData(request, response);
        const data = response._getJSON();
        expect(data.f.p).to.equal(0.5);
        expect(data.e).to.equal(undefined);
        expect(calls).to.have.length(1);
        expect(calls[0].pws).to.eql({ id: wuOptions.pws, apiKey: wuOptions.key });
    });

    it("fetches WU display data once without a failing credential-free retry", async () => {
        const { request, response } = requestFor(wuOptions);
        await getWeatherData(request, response);
        expect(response._getJSON().forecast).to.eql(forecast.forecast);
        expect(calls).to.have.length(1);
    });

    for (const restriction of [{ rainAmt: 0.1, rainDays: 1 }, { minTemp: 35 }]) {
        it(`preserves the main-provider error response for ${Object.keys(restriction)[0]}`, async () => {
            fail = "LocalWeatherProvider";
            const { request, response } = requestFor({ provider: "local", ...restriction });
            await getWateringData(request, response);
            expect(response._getString()).to.equal("Error: Error: fixture outage");
        });
    }
    for (const provider of ["OWM", "AW", "PW"]) {
        it(`preserves the controller key on all endpoints for ${provider} without an override`, async () => {
            for (const handler of [getWeatherData, getWeatherSensorData, getWateringData]) {
                calls = [];
                const { request, response } = requestFor({ provider, key: "controller-fixture", rainAmt: 0.1, rainDays: 1 }, "cf");
                await handler(request, response);
                expect(calls).to.have.length(1);
                expect(calls[0].pws).to.eql({ apiKey: "controller-fixture" });
                expect(response._getString()).not.to.match(/^Error:/);
            }
        });
    }

    it("reuses the main result when the explicit override equals the request provider", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OWM";
        for (const handler of [getWeatherData, getWeatherSensorData, getWateringData]) {
            calls = [];
            const { request, response } = requestFor({ provider: "OWM", key: "controller-fixture", minTemp: 35, rainAmt: 0.1, rainDays: 1 }, "cf");
            await handler(request, response);
            expect(calls).to.have.length(1);
            expect(calls[0].pws).to.eql({ apiKey: "controller-fixture" });
            expect(response._getJSON().forecastProvider).to.equal(undefined);
        }
    });

    it("keeps the local display unchanged without an override", async () => {
        const { request, response } = requestFor({ provider: "local" });
        await getWeatherData(request, response);
        expect(response._getJSON()).to.include({ temp: 70, weatherProvider: "local", ttl: 5000 });
        expect(response._getJSON().forecast).to.eql([]);
        expect(response._getJSON().forecastProvider).to.equal(undefined);
        expect(calls).to.have.length(1);
    });

    it("merges only forecast fields, reports both sources, and uses the shorter TTL", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        const before = JSON.stringify({ current, forecast });
        const { request, response } = requestFor({ provider: "local" });
        await getWeatherData(request, response);
        const data = response._getJSON();
        expect(data).to.include({ weatherProvider: "local", forecastProvider: "OpenMeteo", temp: 70, humidity: 30,
            wind: 4, raining: false, minTemp: 35, maxTemp: 60, precip: 0.5, ttl: 2000 });
        expect(data.forecast).to.eql(forecast.forecast);
        expect(JSON.stringify({ current, forecast })).to.equal(before);
    });

    it("uses external rain while retaining local Zimmerman inputs and temperature restriction", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        const options = { provider: "local", minTemp: 50, rainAmt: 0.1, rainDays: 1 };
        let mocks = requestFor(options, "cfh", 1);
        await getWateringData(mocks.request, mocks.response);
        expect(mocks.response._getJSON()).to.include({ scale: 100, restricted: 1, errCode: 0 });
        expect(mocks.response._getJSON().rawData.wp).to.equal("local");
        // External temp is 40F (below the threshold), but local temp is 70F.
        mocks = requestFor({ ...options, rainAmt: 1 }, "cfh", 1);
        await getWateringData(mocks.request, mocks.response);
        expect(mocks.response._getJSON().restricted).to.equal(undefined);
        expect(calls.filter(call => call.kind === "history").every(call => call.provider === "LocalWeatherProvider")).to.equal(true);
    });

    it("keeps ETo inputs and scale identical when forecast selection changes", async () => {
        const options = { provider: "local", baseETo: 0.15, elevation: 600, rainAmt: 1, rainDays: 1 };
        let mocks = requestFor(options, "cfh", 3);
        await getWateringData(mocks.request, mocks.response);
        const baseline = mocks.response._getJSON();
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        mocks = requestFor(options, "cfh", 3);
        await getWateringData(mocks.request, mocks.response);
        const mixed = mocks.response._getJSON();
        expect(mixed.errCode).to.equal(0);
        expect(mixed.scale).to.equal(baseline.scale);
        expect(mixed.scales).to.eql(baseline.scales);
        expect(mixed.rawData).to.eql(baseline.rawData);
    });

    it("checks California history using the main provider without fetching a forecast", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        WeatherProvider.prototype.getWateringData = async function(_coordinates: GeoCoordinates, pws?: PWS) {
            calls.push({ provider: this.constructor.name, pws, kind: "history" });
            return cached([{ ...history[0], precip: 0.2 }]);
        };
        const { request, response } = requestFor({ provider: "local", cali: true });
        await getWateringData(request, response);
        expect(response._getJSON().restricted).to.equal(1);
        expect(calls).to.eql([{ provider: "LocalWeatherProvider", pws: undefined, kind: "history" }]);
    });

    it("does not fetch a separate forecast when only the temperature restriction is enabled", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        fail = "OpenMeteoWeatherProvider";
        const { request, response } = requestFor({ provider: "local", minTemp: 80 });
        await getWateringData(request, response);
        expect(response._getJSON().restricted).to.equal(1);
        expect(calls).to.eql([{ provider: "LocalWeatherProvider", pws: undefined, kind: "weather" }]);
    });

    it("never sends a controller's OWM key to a separate AccuWeather provider", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "AW";
        for (const handler of [getWeatherData, getWeatherSensorData, getWateringData]) {
            calls = [];
            const { request, response } = requestFor({ provider: "OWM", key: "controller-fixture", minTemp: 35, rainAmt: 0.1, rainDays: 1 }, "cf");
            await handler(request, response);
            expect(calls).to.have.length(2);
            expect(calls[0]).to.include({ provider: "OWMWeatherProvider" });
            expect(calls[0].pws).to.eql({ apiKey: "controller-fixture" });
            expect(calls[1]).to.include({ provider: "AccuWeatherWeatherProvider", pws: undefined });
        }
    });

    for (const main of ["local", "OWM"]) {
        it(`returns the restriction error when a separate forecast fails with ${main}`, async () => {
            process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
            fail = "OpenMeteoWeatherProvider";
            const { request, response } = requestFor({ provider: main, rainAmt: 0.1, rainDays: 1 });
            await getWateringData(request, response);
            expect(response._getString()).to.equal("Error: Error: fixture outage");
        });
    }

    it("returns the unchanged main data when the display forecast fails", async () => {
        const mocks = requestFor({ provider: "local" });
        await getWeatherData(mocks.request, mocks.response);
        const baseline = mocks.response._getJSON();
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        fail = "OpenMeteoWeatherProvider";
        const { request, response } = requestFor({ provider: "local" });
        await getWeatherData(request, response);
        expect(response._getJSON()).to.eql(baseline);
    });

    it("reports a shared sensor failure in both current and forecast scopes", async () => {
        fail = "LocalWeatherProvider";
        const { request, response } = requestFor({ provider: "local" });
        await getWeatherSensorData(request, response);
        const data = response._getJSON();
        expect(data.e).to.eql({ c: 99, f: 99 });
        expect(data.h).not.to.equal(undefined);
        expect(calls.filter(call => call.kind === "weather")).to.have.length(1);
    });

    it("keeps current and history sensor data when a separate forecast fails", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        fail = "OpenMeteoWeatherProvider";
        const { request, response } = requestFor({ provider: "local" });
        await getWeatherSensorData(request, response);
        const data = response._getJSON();
        expect(data.wp).to.equal("local");
        expect(data.c.t).to.equal(70);
        expect(data.h.t).to.equal(70);
        expect(data.f).to.equal(undefined);
        expect(data.e).to.eql({ f: 99 });
    });

    it("returns 502 for a failed forecast-only request instead of fetching unrelated current data", async () => {
        process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
        fail = "OpenMeteoWeatherProvider";
        const { request, response } = requestFor({ provider: "local" }, "f");
        await getWeatherSensorData(request, response);
        expect(response.statusCode).to.equal(502);
        expect(calls.map(call => call.provider)).to.eql(["OpenMeteoWeatherProvider"]);
    });

    for (const scope of ["c", "f", "h"]) {
        it(`fetches only the data needed for sensor scope ${scope}`, async () => {
            process.env.FORECAST_WEATHER_PROVIDER = "OpenMeteo";
            const { request, response } = requestFor({ provider: "local" }, scope);
            await getWeatherSensorData(request, response);
            expect(calls).to.have.length(1);
            expect(calls[0].provider).to.equal(scope === "f" ? "OpenMeteoWeatherProvider" : "LocalWeatherProvider");
            expect(calls[0].kind).to.equal(scope === "h" ? "history" : "weather");
            expect(response._getJSON()[scope]).not.to.equal(undefined);
        });
    }

});
