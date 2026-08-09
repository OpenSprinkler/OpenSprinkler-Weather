import { expect } from "chai";
import nock from "nock";
import OWM from "./OWM";

const COORDS: [ number, number ] = [ 42.37, -72.52 ];
const PWS = { apiKey: "test-key" };

function oneCallBody(): object {
	return {
		current: {
			dt: 1717932600,
			temp: 72,
			humidity: 45,
			wind_speed: 6,
			weather: [ { description: "clear sky", icon: "01d" } ]
		},
		daily: [ {
			dt: 1717977600,
			temp: { min: 55, max: 78 },
			rain: 2.54,
			pop: 0.25,
			humidity: 50,
			wind_speed: 7,
			uvi: 5,
			weather: [ { description: "light rain", icon: "10d" } ]
		} ],
		hourly: Array.from( { length: 25 }, ( _, index ) => ( {
			dt: 1717934400 + index * 3600,
			temp: 65 + index,
			pop: index === 0 ? 0.4 : 0,
			rain: index === 0 ? { "1h": 2.54 } : undefined,
			snow: index === 0 ? { "1h": 1.27 } : undefined,
			weather: [ { icon: index === 0 ? "10n" : "01d" } ]
		} ) )
	};
}

describe( "OWM.getWeatherData — hourly contract", () => {
	beforeEach( () => nock.disableNetConnect() );
	afterEach( () => { nock.cleanAll(); nock.enableNetConnect(); } );

	it( "keeps One Call hourly data, converts precipitation to inches, and stamps the observation", async () => {
		nock( "https://api.openweathermap.org" )
			.get( "/data/3.0/onecall" )
			.query( query => query.exclude === "minutely,alerts" )
			.reply( 200, oneCallBody() );

		const weather = await new OWM().getWeatherData( COORDS, PWS );
		expect( weather.observedAt ).to.equal( 1717932600 );
		expect( weather.hourly ).to.have.length( 24 );
		expect( weather.hourly![0] ).to.deep.include( {
			time: 1717934400,
			temp: 65,
			pop: 40,
			icon: "10n"
		} );
		expect( weather.hourly![0].precip ).to.be.closeTo( 0.15, 1e-12 );
	} );
} );
