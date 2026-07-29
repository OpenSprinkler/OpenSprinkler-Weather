import { expect } from "chai";

// The WeatherProvider API key must be set to prevent a startup throw when importing weather.ts.
process.env.WEATHER_PROVIDER = "OWM";
process.env.OWM_API_KEY = "NO_KEY";

import {
	ADJUSTMENT_METHOD,
	LEGACY_RAWDATA_LIMIT,
	convertToLegacyFormat,
	formatLegacyWateringData,
	resolveLegacyAdjustmentMethod
} from "../routes/weather";
import ManualAdjustmentMethod from "../routes/adjustmentMethods/ManualAdjustmentMethod";
import ZimmermanAdjustmentMethod from "../routes/adjustmentMethods/ZimmermanAdjustmentMethod";
import RainDelayAdjustmentMethod from "../routes/adjustmentMethods/RainDelayAdjustmentMethod";
import EToAdjustmentMethod from "../routes/adjustmentMethods/EToAdjustmentMethod";
import WaterBudgetAdjustmentMethod from "../routes/adjustmentMethods/WaterBudgetAdjustmentMethod";

/*
 * FIRMWARE CONTRACT GUARD
 *
 * These tests pin the legacy watering response to what the OpenSprinkler-Firmware parser
 * (`weather.cpp` getweather_callback) actually consumes, so producer-side drift is caught in CI.
 * The firmware reads specific TOP-LEVEL keys via findKeyVal and validates ranges; it silently
 * IGNORES unknown keys, but renaming/removing a known key, exceeding the rawData buffer, or
 * emitting out-of-range values breaks (or silently degrades) real controllers — including AVR.
 *
 * Source of truth: docs/firmware-integration-requirements.md.
 * Firmware ranges (weather.cpp): scale 0..250 (:74), sunrise/sunset 0..1440 (:90/:99),
 * tz 0..108 (:117); rawData value must stay < 319 bytes (TMP_BUFFER_SIZE 320, :31).
 *
 * RULE: the legacy contract is a FROZEN, additive-only public API. New data is additive and
 * size-bounded; never rename/remove a top-level key the firmware reads.
 */

// Top-level keys the firmware reads or that are part of the frozen response shape.
const ALLOWED_TOP_LEVEL = [ "scale", "rd", "tz", "sunrise", "sunset", "eip", "errCode", "rawData", "restricted", "scales" ];
const REQUIRED_TOP_LEVEL = [ "scale", "tz", "sunrise", "sunset", "eip", "errCode" ];

function legacy( method: any, over: any = {} ): any {
	return convertToLegacyFormat(
		{ scale: 100, rd: undefined, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0, rawData: { wp: "OWM" }, ...over },
		method
	);
}

describe( "firmware legacy contract guard", () => {
	const methods = [ ManualAdjustmentMethod, ZimmermanAdjustmentMethod, RainDelayAdjustmentMethod, EToAdjustmentMethod, WaterBudgetAdjustmentMethod ];

	it( "pins request IDs 0-4 and masks only the bit-7 restriction flag", () => {
		const expected = [ ManualAdjustmentMethod, ZimmermanAdjustmentMethod, RainDelayAdjustmentMethod, EToAdjustmentMethod, WaterBudgetAdjustmentMethod ];
		expect( Object.keys( ADJUSTMENT_METHOD ) ).to.deep.equal( [ "0", "1", "2", "3", "4" ] );
		for ( let id = 0; id < expected.length; id++ ) {
			expect( resolveLegacyAdjustmentMethod( id ) ).to.equal( expected[ id ] );
			expect( resolveLegacyAdjustmentMethod( id | 0x80 ) ).to.equal( expected[ id ] );
		}
		expect( resolveLegacyAdjustmentMethod( 5 ) ).to.equal( undefined );
		expect( resolveLegacyAdjustmentMethod( 0x100 ) ).to.equal( undefined );
	} );

	it( "pins the final custom flat-wire encoding", () => {
		const wire = formatLegacyWateringData( {
			scale: 100,
			rd: undefined,
			rawData: { wp: "A B&C", note: "line\nbreak" },
			errCode: 0
		} );
		expect( wire ).to.equal( '&scale=100&rawData={"wp":"A+BAMPERSANDC","note":"line\\nbreak"}&errCode=0' );
	} );

	it( "emits no top-level key outside the firmware-known set (catches renames)", () => {
		for ( const m of methods ) {
			for ( const k of Object.keys( legacy( m ) ) ) {
				expect( ALLOWED_TOP_LEVEL, `unexpected top-level key '${ k }' for ${ ( m as any ).constructor.name }` ).to.include( k );
			}
		}
	} );

	it( "always includes the required top-level fields the firmware parses", () => {
		for ( const m of methods ) {
			const out = legacy( m );
			for ( const k of REQUIRED_TOP_LEVEL ) {
				expect( out, `missing required field '${ k }'` ).to.have.property( k );
			}
		}
	} );

	it( "emits scale/sunrise/sunset/tz within the firmware-accepted ranges", () => {
		const out = legacy( ManualAdjustmentMethod, { scale: 0 } );
		expect( out.scale ).to.be.within( 0, 250 );
		expect( out.sunrise ).to.be.within( 0, 1440 );
		expect( out.sunset ).to.be.within( 0, 1440 );
		expect( out.tz ).to.be.within( 0, 108 );
		expect( legacy( ManualAdjustmentMethod, { scale: 250 } ).scale ).to.be.within( 0, 250 );
	} );

	it( "keeps the rawData value under the firmware findKeyVal buffer (< 319 bytes), preserving flags", () => {
		const out = legacy( ManualAdjustmentMethod, {
			scale: 0,
			rawData: {
				wp: "OWM", skip: 1, pwsBypassed: 1,
				skipReason: "rain: " + "x".repeat( 500 ) + "in at or above 0.1in",
				pwsBypassReason: "errCode 12 " + "y".repeat( 300 )
			}
		} );
		const rawValue = formatLegacyWateringData( out ).match( /&rawData=([^&]*)/ )?.[ 1 ] || "";
		expect( Buffer.byteLength( rawValue, "utf8" ) ).to.be.lessThan( LEGACY_RAWDATA_LIMIT );
		expect( out.rawData.skip ).to.equal( 1 );
		expect( out.rawData.pwsBypassed ).to.equal( 1 );
	} );

	it( "keeps combined skip, provider fallback, and method detail within the final wire budget", () => {
		const out = legacy( WaterBudgetAdjustmentMethod, {
			scale: 0,
			rawData: {
				wp: "OpenMeteo",
				eto: 0.18,
				etc: 0.05,
				p: 0,
				bank: 0,
				reason: "Scale 50%: dry conditions.",
				kc: 0.3,
				kcSource: "override-budget",
				budgetKcApplied: false,
				budgetKcRequested: 0.8,
				budgetKcLockedForToday: true,
				budgetMaxScale: 50,
				budgetMaxScaleApplied: true,
				skip: 1,
				skipReason: "rain: 0.5in at or above 0.1in",
				pwsBypassed: 1,
				pwsBypassReason: "errCode 12"
			}
		} );
		const rawValue = formatLegacyWateringData( out ).match( /&rawData=([^&]*)/ )?.[ 1 ] || "";
		expect( Buffer.byteLength( rawValue, "utf8" ) ).to.be.lessThan( LEGACY_RAWDATA_LIMIT );
		expect( out.rawData.skip ).to.equal( 1 );
		expect( out.rawData.pwsBypassed ).to.equal( 1 );
		expect( out.rawData.reason ).to.contain( "dry conditions" );
		expect( out.rawData.budgetKcLockedForToday ).to.equal( true );
		expect( out.rawData.skipReason ).to.equal( undefined );
		expect( out.rawData.pwsBypassReason ).to.equal( undefined );
	} );

	it( "keeps WaterBudget late-lock observability under the firmware rawData buffer", () => {
		const out = legacy( WaterBudgetAdjustmentMethod, {
			scale: 50,
			rawData: {
				wp: "WaterBudget",
				scale: 120,
				eto: 0.18,
				etc: 0.05,
				p: 0,
				bank: 0,
				reason: "Scale 120%: Kc locked for today; applied 0.3.",
				kc: 0.3,
				kcSource: "override-budget",
				budgetKcApplied: false,
				budgetKcRequested: 0.8,
				budgetKcLockedForToday: true,
				budgetMaxScale: 50,
				budgetMaxScaleApplied: true
			}
		} );
		const rawValue = formatLegacyWateringData( out ).match( /&rawData=([^&]*)/ )?.[ 1 ] || "";
		expect( Buffer.byteLength( rawValue, "utf8" ) ).to.be.lessThan( LEGACY_RAWDATA_LIMIT );
		expect( out.rawData.reason ).to.contain( "locked for today" );
		expect( out.rawData.budgetKcRequested ).to.equal( 0.8 );
		expect( out.rawData.budgetMaxScaleApplied ).to.equal( true );
	} );

	it( "pins RainDelay and the maximum reserved scales shape on the final wire", () => {
		const rainDelayWire = formatLegacyWateringData( legacy( RainDelayAdjustmentMethod, { scale: undefined, rd: 24 } ) );
		expect( rainDelayWire ).to.contain( "&rd=24" );
		expect( rainDelayWire ).not.to.contain( "&scale=" );

		const scales = Array.from( { length: 14 }, ( _, index ) => index * 10 );
		expect( formatLegacyWateringData( { scales } ) ).to.equal( `&scales=${ JSON.stringify( scales ) }` );
	} );

	it( "emits restricted only when set, as 0/1 (firmware wt_restricted)", () => {
		expect( legacy( ManualAdjustmentMethod, { scale: 0, restricted: 1 } ).restricted ).to.equal( 1 );
		expect( legacy( ManualAdjustmentMethod ).restricted ).to.equal( undefined );
	} );
} );
