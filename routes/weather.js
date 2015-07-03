var http		= require( "http" ),
	SunCalc		= require( "suncalc" ),
//	parseXML	= require( "xml2js" ).parseString,
	Cache		= require( "../models/Cache" ),

	// Define regex filters to match against location
	filters		= {
		gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
		pws: /^(?:pws|icao):/,
		url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
		time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/,
		timezone: /^()()()()()()([+-])(\d{2})(\d{2})/
	};

// Takes a PWS or ICAO location and resolves the GPS coordinates
function getPWSCoordinates( location, weatherUndergroundKey, callback ) {
	var url = "http://api.wunderground.com/api/" + weatherUndergroundKey +
			"/conditions/forecast/q/" + encodeURIComponent( location ) + ".json";

	httpRequest( url, function( data ) {
		data = JSON.parse( data );

		if ( typeof data === "object" && data.current_observation && data.current_observation.observation_location ) {
			callback( [ data.current_observation.observation_location.latitude,
				data.current_observation.observation_location.longitude ] );
		} else {
			callback( false );
		}
	} );
}

// If location does not match GPS or PWS/ICAO, then attempt to resolve
// location using Weather Underground autocomplete API
function resolveCoordinates( location, callback ) {

	// Generate URL for autocomplete request
	var url = "http://autocomplete.wunderground.com/aq?h=0&query=" +
		encodeURIComponent( location );

	httpRequest( url, function( data ) {

		// Parse the reply for JSON data
		data = JSON.parse( data );

		// Check if the data is valid
		if ( typeof data.RESULTS === "object" && data.RESULTS.length ) {

			// If it is, reply with an array containing the GPS coordinates
			callback( [ data.RESULTS[0].lat, data.RESULTS[0].lon ] );
		} else {

			// Otherwise, indicate no data was found
			callback( false );
		}
	} );
}

// Retrieve weather data to complete the weather request using Weather Underground
function getWeatherUndergroundData( location, weatherUndergroundKey, callback ) {

	// Generate URL using The Weather Company API v1 in Imperial units
	var url = "http://api.wunderground.com/api/" + weatherUndergroundKey +
		"/yesterday/conditions/q/" + location + ".json";

	// Perform the HTTP request to retrieve the weather data
	httpRequest( url, function( data ) {
		try {
			var data = JSON.parse( data ),

				tzOffset = getTimezone( data.current_observation.local_tz_offset, "minutes" ),

				// Calculate sunrise and sunset since Weather Underground does not provide it
				sunData = SunCalc.getTimes( data.current_observation.local_epoch * 1000,
											data.current_observation.observation_location.latitude,
											data.current_observation.observation_location.longitude ),
				weather = {
					icon:		data.current_observation.icon,
					timezone:	data.current_observation.local_tz_offset,
					sunrise:	( sunData.sunrise.getUTCHours() * 60 + sunData.sunrise.getUTCMinutes() ) + tzOffset,
					sunset:		( sunData.sunset.getUTCHours() * 60 + sunData.sunset.getUTCMinutes() ) + tzOffset,
					maxTemp:	parseInt( data.history.dailysummary[0].maxtempi ),
					minTemp:	parseInt( data.history.dailysummary[0].mintempi ),
					temp:		data.current_observation.temp_f,
					humidity:	( parseInt( data.history.dailysummary[0].maxhumidity ) + parseInt( data.history.dailysummary[0].minhumidity ) ) / 2,
					precip:		parseInt( data.current_observation.precip_today_in ) + parseInt( data.history.dailysummary[0].precipi ),
					solar:		parseInt( data.current_observation.UV ),
					wind:		parseInt( data.history.dailysummary[0].meanwindspdi ),
					elevation:	data.current_observation.observation_location.elevation
				};

		    if ( weather.sunrise > weather.sunset ) {
				weather.sunset += 1440;
		    }

			callback( weather );

		} catch ( err ) {

			// Otherwise indicate the request failed
			callback( false );
		}

	} );
}

// Retrieve weather data to complete the weather request using The Weather Channel
function getWeatherData( location, callback ) {

	// Get the API key from the environment variables
	var WSI_API_KEY = process.env.WSI_API_KEY,

		// Generate URL using The Weather Company API v1 in Imperial units
		url = "http://api.weather.com/v1/geocode/" + location[0] + "/" + location[1] +
			 "/observations/current.json?apiKey=" + WSI_API_KEY + "&language=en-US&units=e";

	// Perform the HTTP request to retrieve the weather data
	httpRequest( url, function( data ) {

		try {
			var data = JSON.parse( data ),
				weather = {
					iconCode:	data.observation.icon_code,
					timezone:	data.observation.obs_time_local,
					sunrise:	parseDayTime( data.observation.sunrise ),
					sunset:		parseDayTime( data.observation.sunset ),
					maxTemp:	data.observation.imperial.temp_max_24hour,
					minTemp:	data.observation.imperial.temp_min_24hour,
					temp:		data.observation.imperial.temp,
					humidity:	data.observation.imperial.rh || 0,
					precip:		data.observation.imperial.precip_2day || data.observation.imperial.precip_24hour,
					solar:		data.observation.imperial.uv_index,
					wind:		data.observation.imperial.wspd
				};

			location = location.join( "," );

			Cache.findOne( { location: location }, function( err, record ) {

				if ( record && record.yesterdayHumidity !== null ) {
					weather.yesterdayHumidity = record.yesterdayHumidity;
				}

				// Return the data to the callback function if successful
				callback( weather );
			} );

			updateCache( location, weather );
		} catch ( err ) {

			// Otherwise indicate the request failed
			callback( false );
		}

	} );
}

// Retrieve the historical weather data for the provided location
function getYesterdayWeatherData( location, callback ) {

	// Get the API key from the environment variables
	var WSI_HISTORY_KEY = process.env.WSI_HISTORY_KEY,

		// Generate a Date object for the previous day by subtracting a day (in milliseconds) from today
		yesterday		= toUSDate( new Date( new Date().getTime() - 1000 * 60 * 60 * 24 ) ),

		// Generate URL using WSI Cleaned History API in Imperial units showing daily average values
		url = "http://cleanedobservations.wsi.com/CleanedObs.svc/GetObs?ID=" + WSI_HISTORY_KEY +
			 "&Lat=" + location[0] + "&Long=" + location[1] +
			 "&Req=davg&startdate=" +  yesterday + "&enddate=" + yesterday + "&TS=LST";

	// Perform the HTTP request to retrieve the weather data
	httpRequest( url, function( xml ) {
		parseXML( xml, function( err, result ) {
			callback( result.WeatherResponse.WeatherRecords[0].WeatherData[0].$ );
		} );
	} );
}

// Update weather cache record in the local database
function updateCache( location, weather ) {

	// Search for a cache record for the provided location
	Cache.findOne( { location: location }, function( err, record ) {

		// If a record is found update the data and save it
		if ( record ) {

			record.currentHumidityTotal += weather.humidity;
			record.currentHumidityCount++;
			record.save();

		} else {

			// If no cache record is found, generate a new one and save it
			new Cache( {
				location: location,
				currentHumidityTotal: weather.humidity,
				currentHumidityCount: 1
			} ).save();

		}
	} );
}

// Calculates the resulting water scale using the provided weather data, adjustment method and options
function calculateWeatherScale( adjustmentMethod, adjustmentOptions, weather ) {

	// Zimmerman method
	if ( adjustmentMethod === 1 ) {

		var temp = ( ( weather.maxTemp + weather.minTemp ) / 2 ) || weather.temp,
			humidityFactor = ( 30 - weather.humidity ),
			tempFactor = ( ( temp - 70 ) * 4 ),
			precipFactor = ( weather.precip * -200 );

		// Apply adjustment options, if provided, by multiplying the percentage against the factor
		if ( adjustmentOptions ) {
			if ( adjustmentOptions.hasOwnProperty( "h" ) ) {
				humidityFactor = humidityFactor * ( adjustmentOptions.h / 100 );
			}

			if ( adjustmentOptions.hasOwnProperty( "t" ) ) {
				tempFactor = tempFactor * ( adjustmentOptions.t / 100 );
			}

			if ( adjustmentOptions.hasOwnProperty( "r" ) ) {
				precipFactor = precipFactor * ( adjustmentOptions.r / 100 );
			}
		}

		// Apply all of the weather modifying factors and clamp the result between 0 and 200%.
		return parseInt( Math.min( Math.max( 0, 100 + humidityFactor + tempFactor + precipFactor ), 200 ) );
	}

	return -1;
}

// Checks if the weather data meets any of the restrictions set by OpenSprinkler.
// Restrictions prevent any watering from occurring and are similar to 0% watering level.
//
// All queries will return a restrict flag if the current weather indicates rain.
//
// California watering restriction prevents watering if precipitation over two days is greater
// than 0.01" over the past 48 hours.
function checkWeatherRestriction( adjustmentValue, weather ) {

	// Define all the weather codes that indicate rain
	var adverseCodes = [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47 ],
		adverseWords = [ "flurries", "sleet", "rain", "sleet", "snow", "tstorms" ];

	if ( ( weather.iconCode && adverseCodes.indexOf( weather.iconCode ) !== -1 ) || ( weather.icon && adverseWords.indexOf( weather.icon ) !== -1 ) ) {

		// If the current weather indicates rain, add a restrict flag to the weather script indicating
		// the controller should not water.
		return true;
	}

	var californiaRestriction = ( adjustmentValue >> 7 ) & 1;

	if ( californiaRestriction ) {

		// If the California watering restriction is in use then prevent watering
		// if more then 0.01" of rain has accumulated in the past 48 hours
		if ( weather.precip > 0.01 ) {
			return true;
		}
	}

	return false;
}

// API Handler when using the weatherX.py where X represents the
// adjustment method which is encoded to also carry the watering
// restriction and therefore must be decoded
exports.getWeather = function( req, res ) {

	// The adjustment method is encoded by the OpenSprinkler firmware and must be
	// parsed. This allows the adjustment method and the restriction type to both
	// be saved in the same byte.
	var adjustmentMethod		= req.params[0] & ~( 1 << 7 ),
		adjustmentOptions		= req.query.wto,
		location				= req.query.loc,
		weatherUndergroundKey	= req.query.key,
		outputFormat			= req.query.format,
		firmwareVersion			= req.query.fwv,
		remoteAddress			= req.headers[ "x-forwarded-for" ] || req.connection.remoteAddress,

		// Function that will accept the weather after it is received from the API
		// Data will be processed to retrieve the resulting scale, sunrise/sunset, timezone,
		// and also calculate if a restriction is met to prevent watering.
		finishRequest = function( weather ) {
			if ( !weather ) {
				res.send( "Error: No weather data found." );
				return;
			}

			var data = {
					scale:		calculateWeatherScale( adjustmentMethod, adjustmentOptions, weather ),
					restrict:	checkWeatherRestriction( req.params[0], weather ) ? 1 : 0,
					tz:			getTimezone( weather.timezone ),
					sunrise:	weather.sunrise,
					sunset:		weather.sunset,
					eip:		ipToInt( remoteAddress )
				};

			// Return the response to the client in the requested format
			if ( outputFormat === "json" ) {
				res.json( data );
			} else {
				res.send(	"&scale="		+	data.scale +
							"&restrict="	+	data.restrict +
							"&tz="			+	data.tz +
							"&sunrise="		+	data.sunrise +
							"&sunset="		+	data.sunset +
							"&eip="			+	data.eip
				);
			}
		};

	// Exit if no location is provided
	if ( !location ) {
		res.send( "Error: No location provided." );
		return;
	}

	// X-Forwarded-For header may contain more than one IP address and therefore
	// the string is split against a comma and the first value is selected
	remoteAddress = remoteAddress.split( "," )[0];

	// Parse weather adjustment options
	try {

		// Reconstruct JSON string from deformed controller output
		adjustmentOptions = JSON.parse( "{" + adjustmentOptions + "}" );
	} catch ( err ) {

		// If the JSON is not valid, do not incorporate weather adjustment options
		adjustmentOptions = false;
	}

	// Parse location string
    if ( filters.pws.test( location ) ) {

		// Handle locations using PWS or ICAO (Weather Underground)
		if ( !weatherUndergroundKey ) {

			// If no key is provided for Weather Underground then the PWS or ICAO cannot be resolved
			res.send( "Error: Weather Underground key required when using PWS or ICAO location." );
			return;
		}

		getPWSCoordinates( location, weatherUndergroundKey, function( result ) {
			if ( result === false ) {
				res.send( "Error: Unable to resolve location" );
				return;
			}

			location = result;
			getWeatherData( location, finishRequest );
		} );
	} else if ( weatherUndergroundKey ) {

		// The current weather script uses Weather Underground and during the transition period
		// both will be supported and users who provide a Weather Underground API key will continue
		// using Weather Underground until The Weather Service becomes the default API

		getWeatherUndergroundData( location, weatherUndergroundKey, finishRequest );
    } else if ( filters.gps.test( location ) ) {

		// Handle GPS coordinates by storing each coordinate in an array
		location = location.split( "," );
		location = [ parseFloat( location[0] ), parseFloat( location[1] ) ];

		// Continue with the weather request
		getWeatherData( location, finishRequest );

    } else {

		// Attempt to resolve provided location to GPS coordinates when it does not match
		// a GPS coordinate or Weather Underground location using Weather Underground autocomplete
		resolveCoordinates( location, function( result ) {
			if ( result === false ) {
				res.send( "Error: Unable to resolve location" );
				return;
			}

			location = result;
			getWeatherData( location, finishRequest );
		} );
    }
};

// Generic HTTP request handler that parses the URL and uses the
// native Node.js http module to perform the request
function httpRequest( url, callback ) {
	url = url.match( filters.url );

	var options = {
		host: url[1],
		port: url[2] || 80,
		path: url[3]
	};

	http.get( options, function( response ) {
        var data = "";

        // Reassemble the data as it comes in
        response.on( "data", function( chunk ) {
            data += chunk;
        } );

        // Once the data is completely received, return it to the callback
        response.on( "end", function() {
            callback( data );
        } );
	} ).on( "error", function() {

		// If the HTTP request fails, return false
		callback( false );
	} );
}

// Accepts a time string formatted in ISO-8601 or just the timezone
// offset and returns the timezone.
// The timezone output is formatted for OpenSprinkler Unified firmware.
function getTimezone( time, format ) {

	// Match the provided time string against a regex for parsing
	time = time.match( filters.time ) || time.match( filters.timezone );

	var hour = parseInt( time[7] + time[8] ),
		minute = parseInt( time[9] ),
		tz;

	if ( format === "minutes" ) {
		tz = ( hour * 60 ) + minute;
	} else {

		// Convert the timezone into the OpenSprinkler encoded format
		minute = ( minute / 15 >> 0 ) / 4;
		hour = hour + ( hour >= 0 ? minute : -minute );

		tz = ( ( hour + 12 ) * 4 ) >> 0;
	}

	return tz;
}

// Function to return the sunrise and sunset times from the weather reply
function parseDayTime( time ) {

	// Time is parsed from string against a regex
	time = time.match( filters.time );

	// Values are converted to minutes from midnight for the controller
	return parseInt( time[4] ) * 60 + parseInt( time[5] );
}

// Converts IP string to integer
function ipToInt( ip ) {
    ip = ip.split( "." );
    return ( ( ( ( ( ( +ip[0] ) * 256 ) + ( +ip[1] ) ) * 256 ) + ( +ip[2] ) ) * 256 ) + ( +ip[3] );
}

function f2c( temp ) {
	return ( temp - 32 ) * 5 / 9;
}

function mm2in( x ) {
	return x * 0.03937008;
}

function ft2m( x ) {
	return x * 0.3048;
}

// Resolves the Month / Day / Year of a Date object
function toUSDate( date ) {
	return ( date.getMonth() + 1 ) + "/" + date.getDate() + "/" + date.getFullYear();
}
