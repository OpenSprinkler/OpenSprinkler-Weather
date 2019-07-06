import { expect } from 'chai';
import * as nock from 'nock';
import * as MockExpressRequest from 'mock-express-request';
import * as MockExpressResponse from 'mock-express-response';
import * as MockDate from 'mockdate';

// The tests don't use OWM, but the WeatherProvider API key must be set to prevent an error from being thrown on startup.
process.env.WEATHER_PROVIDER = "OWM";
process.env.OWM_API_KEY = "NO_KEY";

import { getWateringData } from './weather';
import { GeoCoordinates, WeatherData, ZimmermanWateringData } from "../types";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import { EToData } from "./adjustmentMethods/EToAdjustmentMethod";

const expected = require( '../test/expected.json' );
const replies = require( '../test/replies.json' );

const location = '01002';

describe('Watering Data', () => {
    beforeEach(() => MockDate.set('5/13/2019'));

    it('OpenWeatherMap Lookup (Adjustment Method 0, Location 01002)', async () => {
        mockOWM();

        const expressMocks = createExpressMocks(0, location);
        await getWateringData(expressMocks.request, expressMocks.response);
        expect( expressMocks.response._getJSON() ).to.eql( expected.noWeather[location] );
    });

    it('OpenWeatherMap Lookup (Adjustment Method 1, Location 01002)', async () => {
        mockOWM();

        const expressMocks = createExpressMocks(1, location);
        await getWateringData(expressMocks.request, expressMocks.response);
        expect( expressMocks.response._getJSON() ).to.eql( expected.adjustment1[location] );
    });
});

function createExpressMocks(method: number, location: string) {
    const request = new MockExpressRequest({
        method: 'GET',
        url: `/${method}?loc=${location}`,
        query: {
            loc: location,
            format: 'json'
        },
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
