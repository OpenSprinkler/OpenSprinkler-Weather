var express		= require( "express" ),
	weather		= require( "./routes/weather.js" ),
	cors		= require( "cors" ),
	host		= process.env.HOST || "127.0.0.1",
	port		= process.env.PORT || 3000,
	app			= express();

if ( !process.env.HOST || !process.env.PORT ) {
	require( "dotenv" ).load();
	host = process.env.HOST || host;
	port = process.env.PORT || port;
}

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, weather.getWeather );
app.get( /(\d+)/, weather.getWeather );

// Handle requests matching /weatherData
app.options( /weatherData/, cors() );
app.get( /weatherData/, cors(), weather.showWeatherData );

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
} );

exports.app = app;
