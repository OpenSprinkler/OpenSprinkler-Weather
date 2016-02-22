var express		= require( "express" ),
    weather		= require( "./routes/weather.js" ),
    mongoose	= require( "mongoose" ),
    Cache		= require( "./models/Cache" ),
    CronJob		= require( "cron" ).CronJob,
	host		= process.env.HOST || "127.0.0.1",
	port		= process.env.PORT || 3000,
	app			= express();

if ( !process.env.HOST || !process.env.PORT ) {
	require( "dotenv" ).load();
	host = process.env.HOST || host;
	port = process.env.PORT || port;
}

// Connect to local MongoDB instance
mongoose.connect( "localhost" );

// If the database connection cannot be established, throw an error
mongoose.connection.on( "error", function() {
	console.error( "MongoDB Connection Error. Please make sure that MongoDB is running." );
} );

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, weather.getWeather );
app.get( /(\d+)/, weather.getWeather );

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

// Schedule a cronjob daily to consildate the weather cache data, runs daily
new CronJob( "0 0 0 * * *", function() {

	// Find all records in the weather cache
	Cache.find( {}, function( err, records ) {

		if ( err ) {
			return;
		}

		// Cycle through each record
		records.forEach( function( record ) {

			// If the record contains any unaveraged data, then process the record
			if ( record.currentHumidityCount > 0 ) {

				// Average the humidity by dividing the total over the total data points collected
				record.yesterdayHumidity = record.currentHumidityTotal / record.currentHumidityCount;

				// Reset the current humidity data for the new day
				record.currentHumidityTotal = 0;
				record.currentHumidityCount = 0;

				// Save the record in the database
				record.save();
			}
		} );
	} );
}, null, true, "UTC" );

exports.app = app;
