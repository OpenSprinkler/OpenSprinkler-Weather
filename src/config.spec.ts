import { expect } from "chai";
import path from "path";
import { localPersistenceEnabled, resolvePersistenceFile, resolveServerPort, resolveForecastProviderName } from "./config";

describe("Server configuration", () => {
	it("uses the default port when neither port variable is set", () => {
		expect(resolveServerPort({})).to.equal(3000);
	});

	it("uses the documented PORT variable", () => {
		expect(resolveServerPort({ PORT: "3001" })).to.equal(3001);
	});

	it("accepts HTTP_PORT as a compatibility alias", () => {
		expect(resolveServerPort({ HTTP_PORT: "3002" })).to.equal(3002);
	});

	it("prefers PORT when both variables are set", () => {
		expect(resolveServerPort({ PORT: "3001", HTTP_PORT: "3002" })).to.equal(3001);
	});

	it("rejects malformed or out-of-range ports", () => {
		for (const value of ["", "0", "65536", "3000x", "1.5"]) {
			expect(() => resolveServerPort({ PORT: value })).to.throw("Invalid server port");
		}
	});
});

describe("Persistence configuration", () => {
	it("enables persistence only for explicit true values", () => {
		for (const value of ["1", "true", "TRUE", "yes", "on"]) {
			expect(localPersistenceEnabled({ LOCAL_PERSISTENCE: value })).to.equal(true);
		}
		for (const value of [undefined, "0", "false", "no", "off"]) {
			expect(localPersistenceEnabled({ LOCAL_PERSISTENCE: value })).to.equal(false);
		}
	});

	it("rejects ambiguous persistence values", () => {
		expect(() => localPersistenceEnabled({ LOCAL_PERSISTENCE: "enabled" }))
			.to.throw("Invalid LOCAL_PERSISTENCE value");
	});

	it("places persistent files in the configured directory", () => {
		expect(resolvePersistenceFile("observations.json", { PERSISTENCE_LOCATION: "/data" }))
			.to.equal(path.resolve("/data/observations.json"));
		expect(resolvePersistenceFile("observations.json", {}))
			.to.equal(path.resolve("observations.json"));
	});
});

describe("Forecast provider configuration", () => {
    it("allows an unset or blank override regardless of the main provider", () => {
        for (const main of ["WU", "local", "OWM"]) {
            for (const value of [undefined, "", "  "]) {
                expect(resolveForecastProviderName({ WEATHER_PROVIDER: main, FORECAST_WEATHER_PROVIDER: value })).to.equal(undefined);
            }
        }
    });
    it("accepts supported providers with their server credentials", () => {
        for (const provider of ["OpenMeteo", "DWD", "Apple", "OWM", "AW", "PW"]) {
            expect(resolveForecastProviderName({ FORECAST_WEATHER_PROVIDER: provider,
                OWM_API_KEY: "fixture", ACCUWEATHER_API_KEY: "fixture", PIRATEWEATHER_API_KEY: "fixture" })).to.equal(provider);
        }
    });
    it("rejects unknown names and providers unsupported as overrides", () => {
        for (const provider of ["WU", "local", "AccuWeather", "PirateWeather", "WUnderground", "typo", "toString", "__proto__"]) {
            expect(() => resolveForecastProviderName({ FORECAST_WEATHER_PROVIDER: provider })).to.throw("Invalid FORECAST_WEATHER_PROVIDER");
        }
    });
    it("requires server keys for keyed overrides, even if the main provider matches", () => {
        for (const [provider, key] of [["OWM", "OWM_API_KEY"], ["AW", "ACCUWEATHER_API_KEY"], ["PW", "PIRATEWEATHER_API_KEY"]]) {
            for (const value of [undefined, "", "  "]) {
                expect(() => resolveForecastProviderName({ WEATHER_PROVIDER: provider, FORECAST_WEATHER_PROVIDER: provider, [key]: value }))
                    .to.throw(`requires ${key}`);
            }
        }
    });
});
