import { expect } from "chai";
import MockExpressRequest from "mock-express-request";
import MockExpressResponse from "mock-express-response";
import { captureWUStream } from "./local";

function push( query: Record<string, string> ): Promise<MockExpressResponse> {
	const request = new MockExpressRequest( { method: "GET", url: "/weatherstation/updateweatherstation.php", query } );
	const response = new MockExpressResponse( { request } );
	return Promise.resolve( captureWUStream( request, response ) ).then( () => response );
}

describe( "local PWS ingest auth (LOCAL_PWS_TOKEN)", () => {
	const TOKEN = "d0test0token";
	afterEach( () => { delete process.env.LOCAL_PWS_TOKEN; } );

	it( "accepts the WU-protocol PASSWORD parameter as the token (hardware stations)", async () => {
		process.env.LOCAL_PWS_TOKEN = TOKEN;
		const ok = await push( { ID: "KSTATION1", PASSWORD: TOKEN, tempf: "72" } );
		expect( ok.statusCode ).to.equal( 200 );
	} );

	it( "still accepts key/token parameters", async () => {
		process.env.LOCAL_PWS_TOKEN = TOKEN;
		expect( ( await push( { key: TOKEN, tempf: "72" } ) ).statusCode ).to.equal( 200 );
		expect( ( await push( { token: TOKEN, tempf: "72" } ) ).statusCode ).to.equal( 200 );
	} );

	it( "rejects a wrong or missing credential when the token is set", async () => {
		process.env.LOCAL_PWS_TOKEN = TOKEN;
		expect( ( await push( { ID: "KSTATION1", PASSWORD: "wrong", tempf: "72" } ) ).statusCode ).to.equal( 401 );
		expect( ( await push( { tempf: "72" } ) ).statusCode ).to.equal( 401 );
	} );

	it( "accepts unauthenticated writes only when no token is configured", async () => {
		expect( ( await push( { tempf: "72" } ) ).statusCode ).to.equal( 200 );
	} );
} );
