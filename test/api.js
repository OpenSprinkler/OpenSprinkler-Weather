var hippie	= require( "hippie" ),
	nock	= require( "nock" ),
	replies	= require( "./replies" ),
	server	= require( "../server" ).app;

function apiTest( opt ) {

	var opt = extend( {}, {
			method: 0,
			loc: "",
			key: "",
			format: "json",
			callback: function() {}
		}, opt ),
		url = "/" + opt.method + "?loc=" + opt.loc + "&key=" + opt.key + "&format=" + opt.format;

	setupMocks( opt.loc );

	hippie( server )
		.json()
		.get( url )
		.expectStatus( 200 )
		.end( function( err, res, body ) {
			if ( err ) {
				throw err;
			}
			opt.callback( body );
		} );
}

function setupMocks( location ) {
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

describe( "Weather API", function() {
	describe( "/:method endpoint", function() {
		it( "The Weather Channel Source Test", function( done ) {
			apiTest( {
				method: 1,
				loc: "01002",
				callback: function( reply ) {
					done();
				}
			} );
		} );
	} );
} );

function extend( target ) {
    var sources = [].slice.call( arguments, 1 );
    sources.forEach( function( source ) {
        for ( var prop in source ) {
            target[prop] = source[prop];
        }
    } );
    return target;
}
