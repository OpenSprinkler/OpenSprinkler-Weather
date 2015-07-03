var mongoose = require( "mongoose" );

var cacheSchema = new mongoose.Schema( {

	// Stores the current GPS location as unique for weather data cache
	location: { type: String, unique: true },

	// This is the end of day value for the humidity yesterday
	yesterdayHumidity:			Number,
	currentHumidityTotal:		Number,
	currentHumidityCount:		Number
} );

module.exports = mongoose.model( "Cache", cacheSchema );
