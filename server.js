var express = require( "express" ),
    weather = require( "./routes/weather.js" ),
	port    = process.env.PORT || 3000;
	app		= express();

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, weather.getWeather );

// Handle 404 error
app.use( function( req, res ) {
	res.status( 404 );
	res.send( "Not found" );
} );

// Start listening on the service port
var server = app.listen( port, "127.0.0.1", function() {

  console.log( "OpenSprinkler Weather Service now listening on port %s", port );
} );
