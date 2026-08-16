import { expect } from "chai";
import { GeoCoordinates, PWS, WateringData } from "../../types";
import EToAdjustmentMethod, { calculateETo, EToScalingAdjustmentOptions } from "./EToAdjustmentMethod";
import { addDays, fromUnixTime, getUnixTime } from "date-fns";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";
import { ErrorCode } from "../../errors";


const testData: TestData[] = require( "../../test/etoTest.json" );

describe( "ETo AdjustmentMethod", () => {
	describe( "Should correctly calculate ETo", async () => {
		for ( const locationData of testData ) {
			it( "Using data from " + locationData.description, async () => {
				let date = fromUnixTime( locationData.startTimestamp );
				for ( const entry of locationData.entries ) {
					const wateringData: WateringData = {
						...entry.data,
						precip: 0,
						periodStartTime: getUnixTime(date),
						weatherProvider: "mock"
					};
					const calculatedETo = calculateETo( wateringData, locationData.elevation, locationData.coordinates );
					// Allow a small margin of error for rounding, unit conversions, and approximations.
					expect( calculatedETo ).approximately( entry.eto, 0.003 );

					date = addDays(date, 1);
				}
			} );
		}
	} );

	it("uses the FAO-56 minimum wind speed under calm conditions", () => {
		const calm = makeWateringData({ windSpeed: 0 });
		const minimumWind = makeWateringData({ windSpeed: 0.5 * 2.237 });

		expect(calculateETo(calm, 600, [42, -75]))
			.to.be.closeTo(calculateETo(minimumWind, 600, [42, -75]), 1e-12);
	});

	it("uses the weather location's calendar day", () => {
		const newYorkData = makeWateringData({
			periodStartTime: Date.parse("2026-01-15T05:00:00Z") / 1000,
		});
		const shanghaiData = makeWateringData({
			periodStartTime: Date.parse("2026-01-14T16:00:00Z") / 1000,
		});

		expect(calculateETo(newYorkData, 600, [42, -75]))
			.to.be.closeTo(calculateETo(shanghaiData, 600, [42, 116]), 1e-12);
	});

	it("rejects invalid and unsupported ETo inputs", () => {
		expect(calculateETo(makeWateringData({ minHumidity: -1 }), 600, [42, -75])).to.be.NaN;
		expect(calculateETo(makeWateringData(), 600, [91, 0])).to.be.NaN;
		expect(calculateETo(makeWateringData({
			periodStartTime: Date.parse("2026-01-01T00:00:00Z") / 1000,
		}), 600, [89, 0])).to.be.NaN;
	});

	it("caps relative solar radiation and returns a finite nonnegative value", () => {
		const eto = calculateETo(makeWateringData({ solarRadiation: 20 }), 600, [42, -75]);
		expect(eto).to.be.finite;
		expect(eto).to.be.at.least(0);
		expect(eto).to.be.closeTo(0.459773, 0.000001);
	});

	it("rejects invalid adjustment options and weather data", async () => {
		await expectAdjustmentError(makeAdjustmentOptions(0), makeWateringData(), ErrorCode.MalformedAdjustmentOptions);
		await expectAdjustmentError(
			makeAdjustmentOptions(0.15),
			makeWateringData({ maxHumidity: 101 }),
			ErrorCode.BadWeatherData
		);
		await expectAdjustmentError(makeAdjustmentOptions(0.15), makeWateringData({ windSpeed: -1 }), ErrorCode.BadWeatherData);
		await expectAdjustmentError(makeAdjustmentOptions(0.15), makeWateringData({ solarRadiation: NaN }), ErrorCode.BadWeatherData);
	});

	it("uses zero for unavailable ETo wind and solar measurements", async () => {
		for (const missing of [
			{ windSpeed: undefined },
			{ solarRadiation: undefined },
			{ windSpeed: undefined, solarRadiation: undefined },
		]) {
			const result = await EToAdjustmentMethod.calculateWateringScale(
				makeAdjustmentOptions(0.15),
				[42, -75],
				new StaticWeatherProvider([makeWateringData(missing)])
			);

			expect(result.scale).to.be.finite;
			expect(result.scales).to.have.length(1);
			expect(result.wateringData[0].windSpeed).to.equal("windSpeed" in missing ? 0 : 3);
			expect(result.wateringData[0].solarRadiation).to.equal("solarRadiation" in missing ? 0 : 5);
		}
	});

	it("reports the effective ETo fallback inputs", async () => {
		const source = makeWateringData({ windSpeed: undefined, solarRadiation: undefined });
		const result = await EToAdjustmentMethod.calculateWateringScale(
			makeAdjustmentOptions(0.15),
			[42, -75],
			new StaticWeatherProvider([source])
		);

		expect(result.rawData).to.include({ wind: 0, radiation: 0 });
		expect(source.windSpeed).to.equal(undefined);
		expect(source.solarRadiation).to.equal(undefined);
	});

	it("uses zero when an ETo measurement is unavailable throughout history", async () => {
		const newest = makeWateringData({ solarRadiation: undefined });
		const older = makeWateringData({
			periodStartTime: Date.parse("2026-06-14T04:00:00Z") / 1000,
			solarRadiation: undefined,
		});
		const result = await EToAdjustmentMethod.calculateWateringScale(
			makeAdjustmentOptions(0.15),
			[42, -75],
			new StaticWeatherProvider([newest, older])
		);

		expect(result.scales).to.have.length(2);
		expect(result.wateringData.map(day => day.solarRadiation)).to.deep.equal([0, 0]);
	});

	it("truncates history at an intermittent ETo measurement gap", async () => {
		const newest = makeWateringData();
		const missing = makeWateringData({
			periodStartTime: Date.parse("2026-06-14T04:00:00Z") / 1000,
			solarRadiation: undefined,
		});
		const oldest = makeWateringData({
			periodStartTime: Date.parse("2026-06-13T04:00:00Z") / 1000,
		});
		const result = await EToAdjustmentMethod.calculateWateringScale(
			makeAdjustmentOptions(0.15),
			[42, -75],
			new StaticWeatherProvider([newest, missing, oldest])
		);

		expect(result.scales).to.have.length(1);
		expect(result.wateringData).to.deep.equal([newest]);
	});

	it("rejects a newest-day gap when older history has that ETo measurement", async () => {
		const newest = makeWateringData({ solarRadiation: undefined });
		const older = makeWateringData({
			periodStartTime: Date.parse("2026-06-14T04:00:00Z") / 1000,
		});

		await expectAdjustmentError(
			makeAdjustmentOptions(0.15),
			newest,
			ErrorCode.BadWeatherData,
			[older]
		);
	});
} );

function makeWateringData(overrides: Partial<WateringData> = {}): WateringData {
	return {
		weatherProvider: "mock",
		precip: 0,
		temp: 59,
		humidity: 60,
		periodStartTime: Date.parse("2026-06-15T04:00:00Z") / 1000,
		minTemp: 50,
		maxTemp: 68,
		minHumidity: 40,
		maxHumidity: 80,
		solarRadiation: 5,
		windSpeed: 3,
		...overrides,
	};
}

function makeAdjustmentOptions(baseETo: number): EToScalingAdjustmentOptions {
	return {
		baseETo,
		cali: false,
		rainAmt: 0,
		rainDays: 0,
		minTemp: 0,
	};
}

async function expectAdjustmentError(
	options: EToScalingAdjustmentOptions,
	data: WateringData,
	expected: ErrorCode,
	additionalData: WateringData[] = []
) {
	let actual: ErrorCode | undefined;
	try {
		await EToAdjustmentMethod.calculateWateringScale(
			options,
			[42, -75],
			new StaticWeatherProvider([data, ...additionalData])
		);
	} catch (err) {
		actual = (err as { errCode?: ErrorCode }).errCode;
	}
	expect(actual).to.equal(expected);
}

class StaticWeatherProvider extends WeatherProvider {
	private readonly data: WateringData[];

	public constructor(data: WateringData[]) {
		super();
		this.data = data;
	}

	protected async getWateringDataInternal(
		coordinates: GeoCoordinates,
		pws: PWS | undefined
	): Promise<WateringData[]> {
		return this.data;
	}
}

interface TestData {
	description: string;
	source: string;
	startTimestamp: number;
	elevation: number;
	coordinates: GeoCoordinates;
	entries: {
		eto: number,
		/** This is not actually full WateringData - it is missing `timestamp`, `weatherProvider`, and `precip`. (Hard coded above)*/
		data: WateringData
	}[];
}
