var CronJob = require( "cron" ).CronJob;
var server = require( "../server.js" );
var today = {}, yesterday = {};
var count = { temp: 0, humidity: 0 };
var current_date = new Date();
var last_rain = new Date().setTime(0);

function sameDay(d1, d2) {
	return d1.getFullYear() === d2.getFullYear() &&
			d1.getMonth() === d2.getMonth() &&
			d1.getDate() === d2.getDate();
}

exports.captureWUStream = function( req, res ) {
	var prev, curr;

	if ( !( "dateutc" in req.query ) || !sameDay( current_date, new Date( req.query.dateutc + "Z") )) {
		res.send( "Error: Bad date range\n" );
		return;
	}

	if ( ( "tempf" in req.query ) && !isNaN( curr = parseFloat( req.query.tempf ) ) && curr !== -9999.0 ) {
		prev = ( "temp" in today ) ? today.temp : 0;
		today.temp = ( prev * count.temp + curr ) / ( ++count.temp );
	}
	if ( ( "humidity" in req.query ) && !isNaN( curr = parseFloat( req.query.humidity ) ) && curr !== -9999.0 ) {
		prev = ( "humidity" in today ) ? today.humidity : 0;
		today.humidity = ( prev * count.humidity + curr ) / ( ++count.humidity );
	}
	if ( ( "dailyrainin" in req.query ) && !isNaN( curr = parseFloat( req.query.dailyrainin ) ) && curr !== -9999.0 ) {
		today.precip = curr;
	}
	if ( ( "rainin" in req.query ) && !isNaN( curr = parseFloat( req.query.rainin ) ) && curr > 0 ) {
		last_rain = new Date();
	}

	res.send( "success\n" );
};

exports.hasLocalWeather = function() {
	return ( server.pws !== "false" ? true : false );
};

exports.getLocalWeather = function() {
	var result = {};

	// Use today's weather if we dont have information for yesterday yet (i.e. on startup)
	Object.assign( result, today, yesterday);
	Object.assign( result, ( yesterday.precip && today.precip ) ? { precip: yesterday.precip + today.precip } : {} );

	result.raining = ( ( Date.now() - last_rain ) / 1000 / 60 / 60 < 1 );

	return result;
};

new CronJob( "0 0 0 * * *", function() {

	yesterday = Object.assign( {}, today );
	today = Object.assign( {} );
	count.temp = 0; count.humidity = 0;
	current_date = new Date();
}, null, true );
