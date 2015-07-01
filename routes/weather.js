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
		if ( data.hasOwnProperty( "RESULTS" ) ) {
			callback( [ data.RESULTS[0].lat, data.RESULTS[0].lon ] );
		}
	} );
}

// Accepts a time string formatted in ISO-8601 and returns the timezone.
// The timezone output is formatted for OpenSprinkler Unified firmware.
function getTimezone( time ) {
	var time = time.match( filters.time ),
		hour = parseInt( time[7] + time[8] ),
		minute = parseInt( time[9] );

	minute = ( minute / 15 >> 0 ) / 4.0;
	hour = hour + ( hour >=0 ? minute : -minute );

	return ( ( hour + 12 ) * 4 ) >> 0;
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
		remoteAddress			= req.headers[ "x-forwarded-for" ].split(",")[0] || req.connection.remoteAddress,
		weather					= {},

		// After the location is resolved, this function will run to complete the weather request
		getWeatherData = function() {

			// Get the API key from the environment variables
			var WSI_API_KEY = process.env.WSI_API_KEY,

				// Generate URL using The Weather Company API v1 in Imperial units
				url = "http://api.weather.com/v1/geocode/" + location[0] + "/" + location[1] +
					 "/observations/current.json?apiKey=" + WSI_API_KEY + "&language=en-US&units=e";

			// Perform the HTTP request to retrieve the weather data
			httpRequest( url, function( data ) {
				weather = JSON.parse( data );

				var scale = calculateWeatherScale(),
					restrict = checkWeatherRestriction() ? 1 : 0,
					sunData = getSunData(),
					timezone = getTimezone( weather.observation.obs_time_local );

				// Return the response to the client
				if ( outputFormat === "json" ) {
					res.json( {
						scale:	scale,
						restrict: restrict,
						tz: timezone,
						sunrise: sunData[0],
						sunset: sunData[1],
						eip: ipToInt( remoteAddress )
					} );
				} else {
					res.send(	"&scale=" + scale +
								"&restrict=" + restrict +
								"&tz=" + timezone +
								"&sunrise=" + sunData[0] +
								"&sunset=" + sunData[1] +
								"&eip=" + ipToInt( remoteAddress )
					);
				}
			} );
		},
		getSunData = function() {

			// Sun times must be converted from strings into date objects and processed into minutes from midnight
			// TODO: Need to use the timezone to adjust sun times
			var sunrise = weather.observation.sunrise.match( filters.time ),
				sunset	= weather.observation.sunset.match( filters.time );

			return [
				parseInt( sunrise[4] ) * 60 + parseInt( sunrise[5] ),
				parseInt( sunset[4] ) * 60 + parseInt( sunset[5] )
			];
		},
		calculateWeatherScale = function() {

			// Calculate the average temperature
			var temp = ( weather.observation.imperial.temp_max_24hour + weather.observation.imperial.temp_min_24hour ) / 2,

				// Relative humidity and if unavailable default to 0
				rh = weather.observation.imperial.rh || 0,

				// The absolute precipitation in the past 48 hours
				precip = weather.observation.imperial.precip_2day;

			if ( typeof temp !== "number" ) {

				// If the maximum and minimum temperatures are not available then use the current temperature
				temp = weather.observation.imperial.temp;
			}

			console.log( {
				temp: temp,
				humidity: rh,
				precip_48hr: precip
			} );

			if ( adjustmentMethod == 1 ) {

				// Zimmerman method

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
		},
		checkWeatherRestriction = function() {
			var californiaRestriction = ( req.params[0] >> 7 ) & 1;

			if ( californiaRestriction ) {

				// If the California watering restriction is in use then prevent watering
				// if more then 0.01" of rain has accumulated in the past 48 hours
				if ( weather.observation.imperial.precip_2day > 0.01 ) {
					return true;
				}
			}

			return false;
		};

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
		getWeatherData();

    } else if ( filters.pws.test( location ) ) {

		// Handle Weather Underground specific location
		getPWSCoordinates( location, weatherUndergroundKey, function( result ) {
			location = result;
			getWeatherData();
		} );
    } else {

		// Attempt to resolve provided location to GPS coordinates
		resolveCoordinates( location, function( result ) {
			location = result;
			getWeatherData();
		} );
    }
};

