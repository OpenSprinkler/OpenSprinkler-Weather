import * as moment from "moment";
import { expect } from "chai";
import { GeoCoordinates, WateringData } from "../../types";
import { calculateETo } from "./EToAdjustmentMethod";


const testData: TestData[] = require( "../../test/etoTest.json" );

describe( "ETo AdjustmentMethod", () => {
	describe( "Should correctly calculate ETo", async () => {
		for ( const locationData of testData ) {
			it( "Using data from " + locationData.description, async () => {
				let date = moment.unix( locationData.startTimestamp );
				for ( const entry of locationData.entries ) {
					const wateringData: WateringData = {
						...entry.data,
						precip: 0,
						periodStartTime: date.unix(),
						weatherProvider: "mock"
					};
					const calculatedETo = calculateETo( wateringData, locationData.elevation, locationData.coordinates );
					// Allow a small margin of error for rounding, unit conversions, and approximations.
					expect( calculatedETo ).approximately( entry.eto, 0.003 );

					date = date.add( 1, "days" );
				}
			} );
		}
	} );
} );

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
