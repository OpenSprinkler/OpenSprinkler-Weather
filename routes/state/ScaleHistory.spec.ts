import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
	FileScaleHistory, MAX_MULTI_DAY_SCALES, localDateKey, recordDailyScale, scaleHistoryKey,
} from "./ScaleHistory";
import { GeoCoordinates } from "../../types";

const COORDS: GeoCoordinates = [ 42.375, -72.519 ];

function tempFile(): string {
	return path.join( fs.mkdtempSync( path.join( os.tmpdir(), "scale-history-" ) ), "history.json" );
}

describe( "ScaleHistory", () => {
	it( "rolling averages: result[i] averages the most recent i+1 days", () => {
		const h = new FileScaleHistory( tempFile() );
		const key = scaleHistoryKey( COORDS );
		h.record( key, "2026-08-10", 100 );
		h.record( key, "2026-08-11", 50 );
		h.record( key, "2026-08-12", 90 );
		// newest-first: 90 | (90+50)/2=70 | (90+50+100)/3=80
		expect( h.rollingScales( key ) ).to.deep.equal( [ 90, 70, 80 ] );
	} );

	it( "re-recording the same day overwrites instead of duplicating", () => {
		const h = new FileScaleHistory( tempFile() );
		const key = scaleHistoryKey( COORDS );
		h.record( key, "2026-08-12", 40 );
		h.record( key, "2026-08-12", 80 );
		expect( h.rollingScales( key ) ).to.deep.equal( [ 80 ] );
	} );

	it( "prunes beyond the firmware window and never emits more than MAX_MULTI_DAY_SCALES", () => {
		const h = new FileScaleHistory( tempFile() );
		const key = scaleHistoryKey( COORDS );
		for ( let day = 1; day <= 20; day++ ) {
			h.record( key, `2026-08-${ String( day ).padStart( 2, "0" ) }`, 100 );
		}
		expect( h.rollingScales( key ).length ).to.equal( MAX_MULTI_DAY_SCALES );
	} );

	it( "persists across instances via the state file (atomic write round trip)", () => {
		const file = tempFile();
		const key = scaleHistoryKey( COORDS );
		new FileScaleHistory( file ).record( key, "2026-08-12", 85 );
		expect( new FileScaleHistory( file ).rollingScales( key ) ).to.deep.equal( [ 85 ] );
	} );

	it( "keeps histories separate per location key", () => {
		const h = new FileScaleHistory( tempFile() );
		h.record( scaleHistoryKey( [ 42.375, -72.519 ] ), "2026-08-12", 10 );
		h.record( scaleHistoryKey( [ 33.749, -84.388 ] ), "2026-08-12", 90 );
		expect( h.rollingScales( scaleHistoryKey( [ 42.375, -72.519 ] ) ) ).to.deep.equal( [ 10 ] );
		expect( h.rollingScales( scaleHistoryKey( [ 33.749, -84.388 ] ) ) ).to.deep.equal( [ 90 ] );
	} );

	it( "localDateKey shifts the day boundary by the controller timezone", () => {
		// 2026-08-12T23:30Z: UTC-6 is still Aug 12; UTC+6 is already Aug 13.
		const nowMs = Date.UTC( 2026, 7, 12, 23, 30 );
		expect( localDateKey( -360, nowMs ) ).to.equal( "2026-08-12" );
		expect( localDateKey( 360, nowMs ) ).to.equal( "2026-08-13" );
	} );

	it( "recordDailyScale returns rolling scales and survives storage failure", () => {
		const good = new FileScaleHistory( tempFile() );
		expect( recordDailyScale( COORDS, 0, 75, good ) ).to.deep.equal( [ 75 ] );
		const broken = new FileScaleHistory( "/nonexistent-dir/deeply/history.json" );
		expect( recordDailyScale( COORDS, 0, 75, broken ) ).to.deep.equal( [] );
	} );
} );
