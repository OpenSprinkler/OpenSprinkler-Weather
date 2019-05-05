var express		= require( "express" ),
	weather		= require( "./routes/weather.js" ),
	local		= require( "./routes/local.js" ),
	cors		= require( "cors" ),
	host		= process.env.HOST || "127.0.0.1",
	port		= process.env.PORT || 3000,
	pws			= process.env.PWS || "none",
	app			= express();

if ( !process.env.HOST || !process.env.PORT || !process.env.LOCAL_PWS ) {
	require( "dotenv" ).load();
	host = process.env.HOST || host;
	port = process.env.PORT || port;
	pws = process.env.PWS || pws;
}

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, weather.getWateringData );
app.get( /(\d+)/, weather.getWateringData );

// Handle requests matching /weatherData
app.options( /weatherData/, cors() );
app.get( /weatherData/, cors(), weather.getWeatherData );

// Endpoint to stream Weather Underground data from local PWS
if ( pws === "WU" ) {
	app.get( "/weatherstation/updateweatherstation.php", local.captureWUStream );
}

app.get( "/", function( req, res ) {
	res.send( "OpenSprinkler Weather Service" );
} );

// Handle 404 error
app.use( function( req, res ) {
	res.status( 404 );
	res.send( "Error: Request not found" );
} );

// Start listening on the service port
app.listen( port, host, function() {
	console.log( "OpenSprinkler Weather Service now listening on %s:%s", host, port );

	if (pws !== "none" ) {
		console.log( "OpenSprinkler Weather Service now listening for local weather stream" );
	}
} );

exports.app = app;
exports.pws = pws;
