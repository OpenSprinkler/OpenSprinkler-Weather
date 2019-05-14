import { expect } from 'chai';
import * as nock from 'nock';
import * as MockExpressRequest from 'mock-express-request';
import * as MockExpressResponse from 'mock-express-response';

import { getWateringData } from './weather';

const expected = require( '../test/expected.json' );
const replies = require( '../test/replies.json' );

const location = '01002';

describe('/:method endpoint', () => {
    beforeEach(() => {
        nock( 'http://api.openweathermap.org' )
            .filteringPath( function() { return "/"; } )
            .get( "/" )
            .reply( 200, replies[location].OWMData );
    });

    it('Information lookup without weather lookup', async () => {
        const expressMocks = createExpressMocks(location);
        await getWateringData(expressMocks.request, expressMocks.response);
        expect( expressMocks.response._getJSON() ).to.eql( expected.noWeather[location] );
    });
});

function createExpressMocks(location: string) {
    const request = new MockExpressRequest({
        method: 'GET',
        url: '/0?loc=' + location,
        query: {
            loc: location,
            format: 'json'
        },
        params: [ 0 ],
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