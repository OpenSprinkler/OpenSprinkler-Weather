import { expect } from 'chai';
import nock from "nock";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import * as MockDate from 'mockdate';

// The tests don't use OWM, but the WeatherProvider API key must be set to prevent an error from being thrown on startup.
process.env.WEATHER_PROVIDER = "OWM";
process.env.OWM_API_KEY = "NO_KEY";

import { computeWateringDecision, convertToLegacyFormat, getWateringData, resolveWeatherProvider } from './weather';
import { __clearSkipWeatherMemo } from './skips/SkipGuard';
import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../types";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import { EToData } from "./adjustmentMethods/EToAdjustmentMethod";
import ManualAdjustmentMethod from './adjustmentMethods/ManualAdjustmentMethod';
import WaterBudgetAdjustmentMethod from './adjustmentMethods/WaterBudgetAdjustmentMethod';
import { FallbackWeatherProvider } from './weatherProviders/FallbackWeatherProvider';

const expected = require( '../test/expected.json' );
const replies = require( '../test/replies.json' );

const location = '01002';

describe( 'convertToLegacyFormat multi-day scales passthrough', () => {
	it( 'passes a non-empty scales array through the legacy whitelist', () => {
		const enhanced = {
			scale: 90, rd: undefined, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0,
			scales: [ 90, 70, 80 ], rawData: { wp: 'OWM' }
		};
		const out: any = convertToLegacyFormat( enhanced, ManualAdjustmentMethod );
		expect( out.scales ).to.deep.equal( [ 90, 70, 80 ] );
	} );
	it( 'omits scales when absent or empty', () => {
		const base = { scale: 90, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0, rawData: { wp: 'OWM' } };
		expect( ( convertToLegacyFormat( { ...base }, ManualAdjustmentMethod ) as any ).scales ).to.equal( undefined );
		expect( ( convertToLegacyFormat( { ...base, scales: [] }, ManualAdjustmentMethod ) as any ).scales ).to.equal( undefined );
	} );
} );

describe( 'convertToLegacyFormat skip passthrough', () => {
	it( 'preserves skip / skipReason for any method', () => {
		const enhanced = {
			scale: 0, rd: undefined, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0,
			rawData: { wp: 'OWM', skip: 1, skipReason: 'freeze: 28F at or below 32F' }
		};
		const out: any = convertToLegacyFormat( enhanced, ManualAdjustmentMethod );
		expect( out.rawData.skip ).to.equal( 1 );
		expect( out.rawData.skipReason ).to.equal( 'freeze: 28F at or below 32F' );
	} );
} );

describe( 'convertToLegacyFormat pwsBypassed passthrough', () => {
	it( 'preserves pwsBypassed / pwsBypassReason for any method', () => {
		const enhanced = {
			scale: 70, rd: undefined, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0,
			rawData: { wp: 'OWM', pwsBypassed: 1, pwsBypassReason: 'errCode 12' }
		};
		const out: any = convertToLegacyFormat( enhanced, ManualAdjustmentMethod );
		expect( out.rawData.pwsBypassed ).to.equal( 1 );
		expect( out.rawData.pwsBypassReason ).to.equal( 'errCode 12' );
	} );
} );

describe( 'convertToLegacyFormat WaterBudget kc passthrough', () => {
	it( 'forwards kc / kcSource for the WaterBudget method when present', () => {
		const enhanced = {
			scale: 80, rd: undefined, tz: 32, sunrise: 100, sunset: 200, eip: 1, errCode: 0,
			rawData: { wp: 'WaterBudget', eto: 0.2, etc: 0.16, p: 0, bank: 0, reason: 'Scale 80%: dry conditions.', kc: 0.8, kcSource: 'plant' }
		};
		const out: any = convertToLegacyFormat( enhanced, WaterBudgetAdjustmentMethod );
		expect( out.rawData.kc ).to.equal( 0.8 );
		expect( out.rawData.kcSource ).to.equal( 'plant' );
	} );
} );

describe( 'convertToLegacyFormat restricted passthrough', () => {
	it( 'emits top-level restricted when set', () => {
		const out: any = convertToLegacyFormat( { scale: 0, restricted: 1, errCode: 0, rawData: { wp: 'OWM', skip: 1 } }, ManualAdjustmentMethod );
		expect( out.restricted ).to.equal( 1 );
	} );
	it( 'omits restricted when not set (continuity)', () => {
		const out: any = convertToLegacyFormat( { scale: 100, errCode: 0, rawData: { wp: 'OWM' } }, ManualAdjustmentMethod );
		expect( out.restricted ).to.equal( undefined );
	} );
} );

describe( 'convertToLegacyFormat rawData length guard', () => {
	it( 'trims verbose rawData strings to stay within the firmware buffer (<319 bytes), keeping essential flags', () => {
		const longReason = 'rain: ' + 'x'.repeat( 400 ) + 'in at or above 0.1in';
		const out: any = convertToLegacyFormat(
			{ scale: 0, errCode: 0, rawData: { wp: 'OWM', skip: 1, skipReason: longReason } },
			ManualAdjustmentMethod
		);
		expect( JSON.stringify( out.rawData ).length ).to.be.lessThan( 319 );
		expect( out.rawData.skip ).to.equal( 1 );
	} );
} );

describe( 'resolveWeatherProvider', () => {
	afterEach( () => {
		delete process.env.WEATHER_PROVIDER_FALLBACKS;
		delete process.env.PWS_FALLBACK_ENABLED;
		delete process.env.WEATHER_PROVIDER;
	} );

	it( 'returns a bare provider when no chain is configured', () => {
		const p = resolveWeatherProvider( { provider: 'OWM' } as any, undefined );
		expect( p ).to.not.be.instanceOf( FallbackWeatherProvider );
	} );

	it( 'returns a FallbackWeatherProvider when WEATHER_PROVIDER_FALLBACKS is set', () => {
		process.env.WEATHER_PROVIDER_FALLBACKS = 'DWD,Apple';
		const p = resolveWeatherProvider( { provider: 'OWM' } as any, undefined );
		expect( p ).to.be.instanceOf( FallbackWeatherProvider );
	} );

	it( 'lets wto.fallbacks trigger the composite even when env is unset', () => {
		const p = resolveWeatherProvider( { provider: 'OWM', fallbacks: [ 'DWD' ] } as any, undefined );
		expect( p ).to.be.instanceOf( FallbackWeatherProvider );
	} );

	it( 'honors a PWS with no fallback by default (bare provider)', () => {
		process.env.WEATHER_PROVIDER_FALLBACKS = 'DWD';
		const p = resolveWeatherProvider( { provider: 'WU' } as any, { id: 'KXX', apiKey: 'x' } );
		expect( p ).to.not.be.instanceOf( FallbackWeatherProvider );
	} );

	it( 'adds the chain to the PWS path only when PWS_FALLBACK_ENABLED', () => {
		process.env.WEATHER_PROVIDER_FALLBACKS = 'DWD';
		process.env.PWS_FALLBACK_ENABLED = 'true';
		const p = resolveWeatherProvider( { provider: 'WU' } as any, { id: 'KXX', apiKey: 'x' } );
		expect( p ).to.be.instanceOf( FallbackWeatherProvider );
	} );

	it( 'returns a bare local provider in local mode (no chain)', () => {
		process.env.WEATHER_PROVIDER = 'local';
		process.env.WEATHER_PROVIDER_FALLBACKS = 'DWD';
		const p = resolveWeatherProvider( { provider: 'OWM' } as any, undefined );
		expect( p ).to.not.be.instanceOf( FallbackWeatherProvider );
	} );
} );

describe('Watering Data', () => {
    beforeEach(() => {
        MockDate.set('5/13/2019');
        __clearSkipWeatherMemo();
    });

    it('computeWateringDecision returns a clean decision object reflecting the served provider', async () => {
        mockGeocoder();
        mockOWMWatering();
        const decision: any = await computeWateringDecision({
            coordinates: [ 42.3732, -72.5199 ],
            adjustmentParam: 1,                       // Zimmerman, no restriction bit
            adjustmentOptions: { provider: 'OWM' },
            pws: undefined
        });
        expect( decision.methodId ).to.equal( 1 );
        expect( decision.methodName ).to.equal( 'zimmerman' );
        expect( decision.scale ).to.be.a( 'number' );
        expect( decision.weatherProvider ).to.equal( decision.rawData.wp );
        expect( decision.skip ).to.equal( false );
        expect( decision.servedFallback ).to.equal( false );
        // No legacy-only fields leak into the decision object.
        expect( ( decision as any ).tz ).to.equal( undefined );
        expect( ( decision as any ).eip ).to.equal( undefined );
    });

    it('OpenWeatherMap Lookup (Adjustment Method 0, Location 01002)', async () => {
        mockGeocoder();
        mockOWM();

        const expressMocks = createExpressMocks(0, location);
        await getWateringData(expressMocks.request, expressMocks.response);
        expect( expressMocks.response._getJSON() ).to.eql( expected.noWeather[location] );
    });

    it('OpenWeatherMap Lookup (Adjustment Method 1, Location 01002)', async () => {
        mockGeocoder();
        mockOWMWatering();

        // Provider selection comes from the `wto` param (WEATHER_PROVIDER env is only honored
        // for "local"), so explicitly request the OWM provider.
        const expressMocks = createExpressMocks(1, location, '"provider":"OWM"');
        await getWateringData(expressMocks.request, expressMocks.response);
        expect( expressMocks.response._getJSON() ).to.eql( expected.adjustment1[location] );
    });

    it('Water Budget Lookup (Adjustment Method 4, Location 01002)', async () => {
        mockGeocoder();
        mockOWMWatering();

        const expressMocks = createExpressMocks(4, location, '"provider":"OWM"');
        await getWateringData(expressMocks.request, expressMocks.response);

        const body: any = expressMocks.response._getJSON();
        expect( body.scale ).to.be.a('number');
        expect( body.scale ).to.be.within(0, 200);
        expect( body.rawData ).to.be.an('object');
        expect( body.rawData.reason ).to.be.a('string').and.contain('Scale');
    });

    it('Water Budget Lookup (Adjustment Method 4) uses the cached same-day scale for caching providers', async () => {
        mockOpenMeteoETo();

        const expressMocksA = createExpressMocks(4, '42.3732,-72.5199', '"provider":"OpenMeteo"');
        await getWateringData(expressMocksA.request, expressMocksA.response);

        const expressMocksB = createExpressMocks(4, '42.3732,-72.5199', '"provider":"OpenMeteo"');
        await getWateringData(expressMocksB.request, expressMocksB.response);

        expect( expressMocksB.response._getJSON() ).to.eql( expressMocksA.response._getJSON() );
    });

    it('applies a freeze skip as a live overlay (scale 0 + skipReason survives legacy)', async () => {
        const saved = process.env.SKIP_FREEZE;
        process.env.SKIP_FREEZE = 'on';
        mockGeocoder();
        mockOWMWatering(); // serves getWateringData's day_summary + onecall (Zimmerman path)
        // The skip overlay then calls OWM.getWeatherData -> a SECOND onecall; return a freezing day.
        nock('https://api.openweathermap.org')
            .get('/data/3.0/onecall').query(true)
            .reply(200, {
                current: { temp: 30, humidity: 90, wind_speed: 3, weather: [ { id: 600, main: 'Snow', description: 'snow', icon: '13d' } ] },
                daily: [ { dt: 1557705600, temp: { min: 28, max: 34 }, rain: 0, weather: [ { id: 600, main: 'Snow', description: 'snow', icon: '13d' } ] } ]
            });
        try {
            const expressMocks = createExpressMocks(1, location, '"provider":"OWM"');
            await getWateringData(expressMocks.request, expressMocks.response);
            const body: any = expressMocks.response._getJSON();
            expect( body.scale ).to.equal( 0 );
            expect( body.rawData.skip ).to.equal( 1 );
            expect( body.rawData.skipReason ).to.be.a('string').and.contain('freeze');
        } finally {
            if ( saved === undefined ) { delete process.env.SKIP_FREEZE; } else { process.env.SKIP_FREEZE = saved; }
        }
    });

    it('restriction bit force-enables the rain skip (scale 0 + rain reason)', async () => {
        mockGeocoder();
        mockOWMWatering(); // method (Zimmerman) data
        // The skip overlay then calls OWM.getWeatherData -> a wet day.
        nock('https://api.openweathermap.org')
            .get('/data/3.0/onecall').query(true)
            .reply(200, {
                current: { temp: 60, humidity: 80, wind_speed: 3, weather: [ { id: 500, main: 'Rain', description: 'rain', icon: '10d' } ] },
                daily: [ { dt: 1557705600, temp: { min: 55, max: 70 }, rain: 12.7, weather: [ { id: 500, main: 'Rain', description: 'rain', icon: '10d' } ] } ]
            });
        const expressMocks = createExpressMocks(1 | (1 << 7), location, '"provider":"OWM"');
        await getWateringData(expressMocks.request, expressMocks.response);
        const body: any = expressMocks.response._getJSON();
        expect( body.scale ).to.equal( 0 );
        expect( body.rawData.skip ).to.equal( 1 );
        expect( body.rawData.skipReason ).to.be.a('string').and.contain('rain');
        expect( body.restricted ).to.equal( 1 ); // restriction bit + skip -> top-level restricted (firmware wt_restricted)
    });

    it('applies the rain restriction LIVE over a cached method result (not a cached 0)', async () => {
        const loc = '42.3732,-72.5199';
        const param = 4 | (1 << 7); // WaterBudget (caches) + restriction bit

        // Request 1: ETo (cached after) + WET skip-weather -> rain skip -> scale 0.
        mockOpenMeteoETo(); // getEToData (forecast hourly), once
        nock('https://api.open-meteo.com').get('/v1/forecast').query(true).once().reply(200, {
            current_weather: { temperature: 60, windspeed: 3, weathercode: 61 },
            daily: { time: [ 1557705600 ], temperature_2m_min: [ 55 ], temperature_2m_max: [ 70 ], precipitation_sum: [ 0.5 ], weathercode: [ 61 ] }
        });
        const a = createExpressMocks(param, loc, '"provider":"OpenMeteo"');
        await getWateringData(a.request, a.response);
        expect( a.response._getJSON().scale ).to.equal( 0 );
        expect( a.response._getJSON().rawData.skip ).to.equal( 1 );

        // Request 2: same day/coords -> method CACHE HIT (no ETo call). Fresh DRY skip-weather -> no skip.
        __clearSkipWeatherMemo();
        nock('https://api.open-meteo.com').get('/v1/forecast').query(true).once().reply(200, {
            current_weather: { temperature: 60, windspeed: 3, weathercode: 1 },
            daily: { time: [ 1557705600 ], temperature_2m_min: [ 55 ], temperature_2m_max: [ 70 ], precipitation_sum: [ 0 ], weathercode: [ 1 ] }
        });
        const b = createExpressMocks(param, loc, '"provider":"OpenMeteo"');
        await getWateringData(b.request, b.response);
        // The cached method result was NOT pre-restricted: a dry cache-hit applies no skip.
        expect( b.response._getJSON().rawData.skip ).to.equal( undefined );
    });
});

function createExpressMocks(method: number, location: string, wto?: string) {
    // req.query is derived from the URL querystring by the mock, so encode wto into the URL.
    const wtoQuery = wto ? `&wto=${ encodeURIComponent( wto ) }` : "";
    const query: any = { loc: location, format: 'json' };
    if ( wto ) query.wto = wto;
    const request = new MockExpressRequest({
        method: 'GET',
        url: `/${method}?loc=${location}&format=json${ wtoQuery }`,
        query,
        params: [ method ],
        headers: {
            'x-forwarded-for': '127.0.0.1'
        }
    });

    return {
        request,
        response: new MockExpressResponse({
            request
        })
    }
}

function mockOWM() {
    nock( 'http://api.openweathermap.org' )
        .filteringPath( function() { return "/"; } )
        .get( "/" )
        .reply( 200, replies[location].OWMData );
}

function mockOWMWatering() {
    // The rewritten OWM provider's getWateringData makes two HTTPS requests:
    // the One Call `day_summary` (yesterday) and the One Call `current` (today).
    nock( 'https://api.openweathermap.org' )
        .get( '/data/3.0/onecall/day_summary' ).query( true )
        .reply( 200, replies[location].OWMDaySummary )
        .get( '/data/3.0/onecall' ).query( true )
        .reply( 200, replies[location].OWMToday );
}

function mockGeocoder() {
    // The default geocoder (WUnderground autocomplete) would otherwise make a live
    // network call to resolve "01002". Mock it to the canonical Amherst, MA coordinates
    // that the expected fixtures (tz/sunrise/sunset) were computed from.
    nock( 'http://autocomplete.wunderground.com' )
        .get( /.*/ )
        .reply( 200, { RESULTS: [ { lat: "42.3732", lon: "-72.5199", tz: "America/New_York" } ] } );
}

function mockOpenMeteoETo() {
    nock( 'https://api.open-meteo.com' )
        .get( '/v1/forecast' )
        .query( true )
        .once()
        .reply( 200, {
            hourly: {
                time: [
                    1557619200, 1557622800, 1557626400, 1557630000
                ],
                temperature_2m: [ 55, 65, 72, 60 ],
                relativehumidity_2m: [ 80, 60, 40, 70 ],
                precipitation: [ 0, 0.1, 0, 0 ],
                direct_radiation: [ 100, 250, 400, 150 ],
                windspeed_10m: [ 3, 5, 4, 2 ]
            }
        } );
}


/**
 * A WeatherProvider for testing purposes that returns weather data that is provided in the constructor.
 * This is a special WeatherProvider designed for testing purposes and should not be activated using the
 * WEATHER_PROVIDER environment variable.
 */
export class MockWeatherProvider extends WeatherProvider {

    private readonly mockData: MockWeatherData;

    public constructor(mockData: MockWeatherData) {
        super();
        this.mockData = mockData;
    }

    public async getWateringData( coordinates: GeoCoordinates ): Promise< ZimmermanWateringData > {
        return await this.getData( "wateringData" ) as ZimmermanWateringData;
    }

    public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
        return await this.getData( "weatherData" ) as WeatherData;
    }

    public async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {
        return await this.getData( "etoData" ) as EToData;
    }

    private async getData( type: "wateringData" | "weatherData" | "etoData" ) {
        const data = this.mockData[ type ];
        if ( !data.weatherProvider ) {
            data.weatherProvider = "mock";
        }

        return data;
    }
}

interface MockWeatherData {
    wateringData?: ZimmermanWateringData,
    weatherData?: WeatherData,
    etoData?: EToData
}
