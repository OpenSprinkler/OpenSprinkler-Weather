import { expect } from "chai";
import nock from "nock";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";

import { ErrorCode } from "../errors";
import { getWeatherData, sendWeatherDataError } from "./weather";

const COORDINATES = "42.37,-72.52";
const OWM_OPTIONS = '"provider":"OWM","key":"test-key"';

function weatherMocks( location: string, wto = "" ) {
	const query: any = { loc: location };
	if ( wto ) query.wto = wto;
	const wtoQuery = wto ? `&wto=${ encodeURIComponent( wto ) }` : "";
	const request = new MockExpressRequest( {
		method: "GET",
		url: `/weatherData?loc=${ encodeURIComponent( location ) }${ wtoQuery }`,
		query,
		headers: { accept: "application/json" }
	} );
	return { request, response: new MockExpressResponse( { request } ) };
}

function owmBody(): object {
	return {
		current: {
			dt: 1717932600,
			temp: 72,
			humidity: 45,
			wind_speed: 6,
			weather: [ { description: "clear sky", icon: "01d" } ]
		},
		daily: [
			{ dt: 1717977600, temp: { min: 55, max: 78 }, rain: 0, weather: [ { description: "clear", icon: "01d" } ] },
			{ dt: 1718064000, temp: { min: 58, max: 82 }, rain: 0, weather: [ { description: "clear", icon: "01d" } ] }
		],
		hourly: [ { dt: 1717934400, temp: 70, pop: 0, weather: [ { icon: "01d" } ] } ]
	};
}

describe( "/weatherData additive contract", () => {
	beforeEach( () => nock.disableNetConnect() );
	afterEach( () => { nock.cleanAll(); nock.enableNetConnect(); } );

	it( "adds plausible forecast ETo and generated/observed timestamps", async () => {
		nock( "https://api.openweathermap.org" )
			.get( "/data/3.0/onecall" ).query( true ).reply( 200, owmBody() );
		const mocks = weatherMocks( COORDINATES, OWM_OPTIONS );
		const startedAt = Math.floor( Date.now() / 1000 );

		await getWeatherData( mocks.request, mocks.response );

		const body: any = mocks.response._getJSON();
		expect( mocks.response.statusCode ).to.equal( 200 );
		expect( body.observedAt ).to.equal( 1717932600 );
		expect( body.generatedAt ).to.be.within( startedAt, Math.floor( Date.now() / 1000 ) );
		body.forecast.forEach( ( day: any ) => {
			expect( day.eto ).to.be.a( "number" ).and.to.be.within( 0, 0.6 );
		} );
	} );

	it( "returns a 400 numeric coded error for a bad location", async () => {
		const mocks = weatherMocks( "pws:not-a-location" );
		await getWeatherData( mocks.request, mocks.response );
		expect( mocks.response.statusCode ).to.equal( 400 );
		expect( mocks.response._getJSON() ).to.deep.equal( {
			error: ErrorCode.InvalidLocationFormat,
			message: "The location format is invalid."
		} );
	} );

	it( "returns a 502 numeric coded error when the upstream provider fails", async () => {
		nock( "https://api.openweathermap.org" )
			.get( "/data/3.0/onecall" ).query( true ).reply( 503, { error: "unavailable" } );
		const mocks = weatherMocks( COORDINATES, OWM_OPTIONS );
		await getWeatherData( mocks.request, mocks.response );
		expect( mocks.response.statusCode ).to.equal( 502 );
		expect( mocks.response._getJSON() ).to.deep.equal( {
			error: ErrorCode.WeatherApiError,
			message: "The weather provider request failed."
		} );
	} );

	it( "maps uncoded failures to HTTP 500 and code 99", () => {
		const response = new MockExpressResponse();
		sendWeatherDataError( response, new Error( "internal detail" ) );
		expect( response.statusCode ).to.equal( 500 );
		expect( response._getJSON() ).to.deep.equal( {
			error: ErrorCode.UnexpectedError,
			message: "An unexpected weather service error occurred."
		} );
	} );
} );
