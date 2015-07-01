// Define regex filters to match against location
var http	= require( "http" ),
	filters = {
		gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
		pws: /^(?:pws|icao):/,
		url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
		time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/
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

// Converts IP string to integer
function ipToInt( ip ) {
    ip = ip.split( "." );
    return ( ( ( ( ( ( +ip[0] ) * 256 ) + ( +ip[1] ) ) * 256 ) + ( +ip[2] ) ) * 256 ) + ( +ip[3] );
}

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
	var url = "http://autocomplete.wunderground.com/aq?h=0&query=" +
		encodeURIComponent( location );

	httpRequest( url, function( data ) {
		data = JSON.parse( data );
		if ( typeof data.RESULTS === "object" && data.RESULTS.length ) {
			callback( [ data.RESULTS[0].lat, data.RESULTS[0].lon ] );
		}
	} );
}

// Accepts a time string formatted in ISO-8601 and returns the timezone.
// The timezone output is formatted for OpenSprinkler Unified firmware.
function getTimezone( time ) {
	time = time.match( filters.time );

	var hour = parseInt( time[7] + time[8] ),
		minute = parseInt( time[9] );

	minute = ( minute / 15 >> 0 ) / 4.0;
	hour = hour + ( hour >=0 ? minute : -minute );

	return ( ( hour + 12 ) * 4 ) >> 0;
}

// Retrieve weather data to complete the weather request
function getWeatherData( location, callback ) {

	// Get the API key from the environment variables
	var WSI_API_KEY = process.env.WSI_API_KEY,

		// Generate URL using The Weather Company API v1 in Imperial units
		url = "http://api.weather.com/v1/geocode/" + location[0] + "/" + location[1] +
			 "/observations/current.json?apiKey=" + WSI_API_KEY + "&language=en-US&units=e";

	// Perform the HTTP request to retrieve the weather data
	httpRequest( url, function( data ) {
		callback( JSON.parse( data ) );
	} );
}

// Calculates the resulting water scale using the provided weather data, adjustment method and options
function calculateWeatherScale( adjustmentMethod, adjustmentOptions, weather ) {

	// Calculate the average temperature
	var temp = ( weather.observation.imperial.temp_max_24hour + weather.observation.imperial.temp_min_24hour ) / 2,

		// Relative humidity and if unavailable default to 0
		rh = weather.observation.imperial.rh || 0,

		// The absolute precipitation in the past 48 hours
		precip = weather.observation.imperial.precip_2day || weather.observation.imperial.precip_24hour;

	if ( typeof temp !== "number" ) {

		// If the maximum and minimum temperatures are not available then use the current temperature
		temp = weather.observation.imperial.temp;
	}

	// Zimmerman method
	if ( adjustmentMethod == 1 ) {

		var humidityFactor = ( 30 - rh ),
			tempFactor = ( ( temp - 70 ) * 4 ),
			precipFactor = ( precip * -2 );

		// Apply adjustment options if available
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

		return parseInt( Math.min( Math.max( 0, 100 + humidityFactor + tempFactor + precipFactor ), 200 ) );
	}

	return -1;
}

// Function to return the sunrise and sunset times from the weather reply
function getSunData( weather ) {

	// Sun times must be converted from strings into date objects and processed into minutes from midnight
	var sunrise = weather.observation.sunrise.match( filters.time ),
		sunset	= weather.observation.sunset.match( filters.time );

	return [
		parseInt( sunrise[4] ) * 60 + parseInt( sunrise[5] ),
		parseInt( sunset[4] ) * 60 + parseInt( sunset[5] )
	];
}

// Checks if the weather data meets any of the restrictions set by OpenSprinkler.
// Restrictions prevent any watering from occurring and are similar to 0% watering level.
// California watering restriction prevents watering if precipitation over two days is greater
// than 0.01" over the past 48 hours.
function checkWeatherRestriction( adjustmentValue, weather ) {
	var californiaRestriction = ( adjustmentValue >> 7 ) & 1;

	if ( californiaRestriction ) {

		// If the California watering restriction is in use then prevent watering
		// if more then 0.01" of rain has accumulated in the past 48 hours
		if ( weather.observation.imperial.precip_2day > 0.01 || weather.observation.imperial.precip_24hour > 0.01 ) {
			return true;
		}
	}

	return false;
}

// API Handler when using the weatherX.py where X represents the
// adjustment method which is encoded to also carry the watering
// restriction and therefore must be decoded
exports.getWeather = function( req, res ) {
	var adjustmentMethod		= req.params[0] & ~( 1 << 7 ),
		adjustmentOptions		= req.query.wto,
		location				= req.query.loc,
		weatherUndergroundKey	= req.query.key,
		outputFormat			= req.query.format,
		firmwareVersion			= req.query.fwv,
		remoteAddress			= req.headers[ "x-forwarded-for" ] || req.connection.remoteAddress,
		finishRequest = function( weather ) {
			if ( !weather || typeof weather.observation !== "object" || typeof weather.observation.imperial !== "object" ) {
				res.send( "Error: No weather data found." );
				return;
			}

			var data = {
					scale:	calculateWeatherScale( adjustmentMethod, adjustmentOptions, weather ),
					restrict: checkWeatherRestriction( req.params[0], weather ) ? 1 : 0,
					tz: getTimezone( weather.observation.obs_time_local ),
					sunrise: getSunData( weather )[0],
					sunset: getSunData( weather )[1],
					eip: ipToInt( remoteAddress )
				};

			// Return the response to the client
			if ( outputFormat === "json" ) {
				res.json( data );
			} else {
				res.send(	"&scale=" + data.scale +
							"&restrict=" + data.restrict +
							"&tz=" + data.tz +
							"&sunrise=" + data.sunrise +
							"&sunset=" + data.sunset +
							"&eip=" + data.eip
				);
			}
		};

	// Exit if no location is provided
	if ( !location ) {
		res.send( "Error: No location provided." );
		return;
	}

	remoteAddress = remoteAddress.split(",")[0];

	// Parse weather adjustment options
	try {

		// Reconstruct JSON string from deformed controller output
		adjustmentOptions = JSON.parse( "{" + adjustmentOptions + "}" );
	} catch (err) {
		adjustmentOptions = false;
	}

	// Parse location string
    if ( filters.gps.test( location ) ) {

		// Handle GPS coordinates
		location = location.split( "," );
		location = [ parseFloat( location[0] ), parseFloat( location[1] ) ];
		getWeatherData( location, finishRequest );

    } else if ( filters.pws.test( location ) ) {

		if ( !weatherUndergroundKey ) {
			res.send( "Error: Weather Underground key required when using PWS or ICAO location." );
			return;
		}

		// Handle Weather Underground specific location
		getPWSCoordinates( location, weatherUndergroundKey, function( result ) {
			location = result;
			getWeatherData( location, finishRequest );
		} );
    } else {

		// Attempt to resolve provided location to GPS coordinates
		resolveCoordinates( location, function( result ) {
			location = result;
			getWeatherData( location, finishRequest );
		} );
    }
};

