import { expect } from 'chai';
import * as nock from 'nock';
import * as MockExpressRequest from 'mock-express-request';
import * as MockExpressResponse from 'mock-express-response';
import * as MockDate from 'mockdate';

import { getWateringData } from './weather';

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