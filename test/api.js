var hippie		= require( "hippie" ),
	nock		= require( "nock" ),
	expect		= require( "chai" ).expect,
	replies		= require( "./replies" ),
	expected	= require( "./expected" ),
	server		= require( "../server" ).app;

describe( "Weather API", function() {
	describe( "/:method endpoint", function() {
		it( "The Weather Channel Source Test", function( done ) {
			for ( var test in expected.WSI ) {
				if ( expected.WSI.hasOwnProperty( test ) ) {
					apiTest( {
						method: 1,
						loc: test,
						expected: expected.WSI[test],
						callback: function( reply ) {
							done();
						}
					} );
				}
			}
		} );

		it( "Weather Underground Source Test", function( done ) {
			for ( var test in expected.WU ) {
				if ( expected.WU.hasOwnProperty( test ) ) {
					apiTest( {
						method: 1,
						loc: test,
						key: process.env.WU_API_KEY,
						expected: expected.WU[test],
						callback: function( reply ) {
							done();
						}
					} );
				}
			}
		} );

		it( "Information lookup without weather lookup", function( done ) {
			for ( var test in expected.noWeather ) {
				if ( expected.noWeather.hasOwnProperty( test ) ) {
					apiTest( {
						method: 0,
						loc: test,
						expected: expected.noWeather[test],
						callback: function( reply ) {
							done();
						}
					} );
				}
			}
		} );
	} );
} );

function apiTest( opt ) {

	opt = extend( {}, {
		method: 0,
		key: "",
		format: "json"
	}, opt );

	var url = "/" + opt.method + "?loc=" + opt.loc + "&key=" + opt.key + "&format=" + opt.format;

	setupMocks( opt.loc );

	hippie( server )
		.json()
		.get( url )
		.expectStatus( 200 )
		.end( function( err, res, body ) {
			if ( err ) {
				throw err;
			}
			expect( body ).to.eql( opt.expected );
			opt.callback( body );
		} );
}

function setupMocks( location ) {
	nock.cleanAll();

	nock( "http://autocomplete.wunderground.com" )
		.filteringPath( function( path ) {
	        return "/";
	    } )
	    .get( "/" )
		.reply( 200,  replies[location].WUautoComplete );

	nock( "http://api.wunderground.com" )
		.filteringPath( function( path ) {
	        return "/";
	    } )
	    .get( "/" )
		.reply( 200, replies[location].WUyesterday );

	nock( "http://api.weather.com" )
		.filteringPath( function( path ) {
	        return "/";
	    } )
	    .get( "/" )
		.reply( 200, replies[location].WSIcurrent );
}

function extend( target ) {
    var sources = [].slice.call( arguments, 1 );
    sources.forEach( function( source ) {
        for ( var prop in source ) {
            target[prop] = source[prop];
        }
    } );
    return target;
}
