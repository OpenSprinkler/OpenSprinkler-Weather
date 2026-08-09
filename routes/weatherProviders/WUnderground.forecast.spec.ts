import { expect } from "chai";
import nock from "nock";
import WUnderground from "./WUnderground";

const PWS = { id: "KTESTPWS1", apiKey: "a".repeat( 32 ) };
const COORDS: [ number, number ] = [ 37.5, -122.3 ];

/**
 * Redacted WU v3 daily-forecast body. Daypart arrays carry TWO slots per day (day = 2i,
 * night = 2i + 1). `afternoon: true` reproduces the real after-3 p.m. shape: today's
 * temperatureMax and today's DAY daypart slot are null.
 */
function forecastBody( { days = 3, afternoon = false } = {} ): object {
	const slots = days * 2;
	const slotFill = ( base: number ): Array<number | null> => {
		const values = Array.from( { length: slots }, ( _, slot ) => base + slot );
		if ( afternoon ) values[ 0 ] = null;
		return values;
	};
	return {
		dayOfWeek: Array.from( { length: days }, ( _, i ) => `Day${ i }` ),
		narrative: Array.from( { length: days }, ( _, i ) => `Narrative ${ i }` ),
		validTimeUtc: Array.from( { length: days }, ( _, i ) => 1717934400 + i * 86400 ),
		temperatureMin: Array.from( { length: days }, ( _, i ) => 50 + i ),
		temperatureMax: Array.from( { length: days }, ( _, i ) => ( afternoon && i === 0 ? null : 80 + i ) ),
		calendarDayTemperatureMax: Array.from( { length: days }, ( _, i ) => 82 + i ),
		qpf: Array.from( { length: days }, ( _, i ) => i * 0.1 ),
		qpfSnow: Array.from( { length: days }, () => 0 ),
		daypart: [ {
			iconCode: slotFill( 26 ),          // cloudy-family codes
			precipChance: slotFill( 10 ),
			relativeHumidity: slotFill( 40 ),
			windSpeed: slotFill( 5 ),
			uvIndex: slotFill( 1 ),
		} ],
	};
}

function currentBody(): object {
	return {
		observations: [ {
			country: "US",
			humidity: 41,
			imperial: { temp: 72.6, windSpeed: 6.3, precipRate: 0, precipTotal: 0 },
		} ],
	};
}

function mockWU( forecast: object ): void {
	nock( "https://api.weather.com" )
		.get( /v3\/wx\/forecast\/daily\/5day/ ).query( true ).reply( 200, forecast )
		.get( /v2\/pws\/observations\/current/ ).query( true ).reply( 200, currentBody() );
}

describe( "WUnderground.getWeatherData — forecast contract", () => {
	beforeEach( () => nock.disableNetConnect() );
	afterEach( () => { nock.cleanAll(); nock.enableNetConnect(); } );

	it( "emits every App-required field plus the verbose optionals on each day", async () => {
		mockWU( forecastBody() );
		const weather = await new WUnderground().getWeatherData( COORDS, PWS );
		expect( weather.forecast ).to.have.length( 3 );
		weather.forecast.forEach( ( day, i ) => {
			expect( day.temp_min, `temp_min[${ i }]` ).to.be.a( "number" );
			expect( day.temp_max, `temp_max[${ i }]` ).to.be.a( "number" );
			expect( day.temp_max ).to.be.at.least( day.temp_min );
			expect( day.precip, `precip[${ i }]` ).to.be.a( "number" );
			expect( day.date, `date[${ i }]` ).to.be.a( "number" );
			expect( day.icon, `icon[${ i }]` ).to.be.a( "string" );
			expect( day.description, `description[${ i }]` ).to.be.a( "string" );
			expect( day.pop, `pop[${ i }]` ).to.be.a( "number" );
			expect( day.humidity, `humidity[${ i }]` ).to.be.a( "number" );
			expect( day.wind, `wind[${ i }]` ).to.be.a( "number" );
			expect( day.uv, `uv[${ i }]` ).to.be.a( "number" );
		} );
	} );

	it( "addresses daypart slots by day (2i), not by day index", async () => {
		mockWU( forecastBody() );
		const weather = await new WUnderground().getWeatherData( COORDS, PWS );
		// day 1's day-slot values are base + 2, not base + 1 (the old [index] bug).
		expect( weather.forecast[ 1 ].pop ).to.equal( 12 );
		expect( weather.forecast[ 1 ].humidity ).to.equal( 42 );
		expect( weather.forecast[ 2 ].pop ).to.equal( 14 );
	} );

	it( "survives the after-3pm nulls: no fabricated 0° day, night-slot fallbacks used", async () => {
		mockWU( forecastBody( { afternoon: true } ) );
		const weather = await new WUnderground().getWeatherData( COORDS, PWS );
		expect( weather.forecast ).to.have.length( 3 );
		const today = weather.forecast[ 0 ];
		expect( today.temp_max ).to.equal( 82 );          // calendarDayTemperatureMax fallback, not 0
		expect( today.temp_max ).to.be.at.least( today.temp_min );
		expect( today.pop ).to.equal( 11 );               // night slot (2*0+1) fallback
		expect( weather.maxTemp ).to.equal( 82 );
		expect( weather.icon ).to.be.a( "string" ).and.to.not.be.empty;
	} );

	it( "drops a day it cannot represent instead of emitting garbage", async () => {
		const body: any = forecastBody();
		body.temperatureMin[ 2 ] = null;
		mockWU( body );
		const weather = await new WUnderground().getWeatherData( COORDS, PWS );
		expect( weather.forecast ).to.have.length( 2 );
	} );

	it( "sums qpf and qpfSnow per day, treating nulls as zero", async () => {
		const body: any = forecastBody();
		body.qpf[ 1 ] = null;
		body.qpfSnow[ 2 ] = 0.5;
		mockWU( body );
		const weather = await new WUnderground().getWeatherData( COORDS, PWS );
		expect( weather.forecast[ 0 ].precip ).to.equal( 0 );
		expect( weather.forecast[ 1 ].precip ).to.equal( 0 );
		expect( weather.forecast[ 2 ].precip ).to.be.closeTo( 0.7, 1e-9 );
	} );
} );
