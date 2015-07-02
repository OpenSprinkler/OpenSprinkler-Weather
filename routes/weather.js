( function() {

	var http		= require( "http" ),
		parseXML	= require( "xml2js" ).parseString,

		// Define regex filters to match against location
		filters		= {
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

	// Resolves the Month / Day / Year of a Date object
	Date.prototype.toUSDate = function(){
		return ( this.getMonth() + 1 ) + "/" + this.getDate() + "/" + this.getFullYear();
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

	// Accepts a time string formatted in ISO-8601 and returns the timezone.
	// The timezone output is formatted for OpenSprinkler Unified firmware.
	function getTimezone( time ) {

		// Match the provided time string against a regex for parsing
		time = time.match( filters.time );

		var hour = parseInt( time[7] + time[8] ),
			minute = parseInt( time[9] );

		// Convert the timezone into the OpenSprinkler encoded format
		minute = ( minute / 15 >> 0 ) / 4;
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

			try {

				// Return the data to the callback function if successful
				callback( JSON.parse( data ) );
			} catch (err) {

				// Otherwise indicate the request failed
				callback( false );
			}

		} );
	}

	// Retrieve the historical weather data for the provided location
	function getYesterdayWeatherData( location, callback ) {

		// Get the API key from the environment variables
		var WSI_HISTORY_KEY = process.env.WSI_HISTORY_KEY,

			// Generate a Date object for the current time
			today			= new Date(),

			// Generate a Date object for the previous day by subtracting a day (in milliseconds) from today
			yesterday		= new Date( today.getTime() - 1000 * 60 * 60 * 24 ),

			// Generate URL using WSI Cleaned History API in Imperial units showing daily average values
			url = "http://cleanedobservations.wsi.com/CleanedObs.svc/GetObs?ID=" + WSI_HISTORY_KEY +
				 "&Lat=" + location[0] + "&Long=" + location[1] +
				 "&Req=davg&startdate=" + yesterday.toUSDate() + "&enddate=" + yesterday.toUSDate() + "&TS=LST";

		// Perform the HTTP request to retrieve the weather data
		httpRequest( url, function( xml ) {
			parseXML( xml, function ( err, result ) {
				callback( result.WeatherResponse.WeatherRecords[0].WeatherData[0].$ );
			});
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

	// Function to return the sunrise and sunset times from the weather reply
	function getSunData( weather ) {

		// Sun times are parsed from string against a regex to identify the timezone
		var sunrise = weather.observation.sunrise.match( filters.time ),
			sunset	= weather.observation.sunset.match( filters.time );

		return [

			// Values are converted to minutes from midnight for the controller
			parseInt( sunrise[4] ) * 60 + parseInt( sunrise[5] ),
			parseInt( sunset[4] ) * 60 + parseInt( sunset[5] )
		];
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
		var adverseCodes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47];

		if ( adverseCodes.indexOf( weather.observation.icon_code ) !== -1 ) {

			// If the current weather indicates rain, add a restrict flag to the weather script indicating
			// the controller should not water.
			return true;
		}

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
				if ( !weather || typeof weather.observation !== "object" || typeof weather.observation.imperial !== "object" ) {
					res.send( "Error: No weather data found." );
					return;
				}

				var data = {
						scale:		calculateWeatherScale( adjustmentMethod, adjustmentOptions, weather ),
						restrict:	checkWeatherRestriction( req.params[0], weather ) ? 1 : 0,
						tz:			getTimezone( weather.observation.obs_time_local ),
						sunrise:	getSunData( weather )[0],
						sunset:		getSunData( weather )[1],
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
		remoteAddress = remoteAddress.split(",")[0];

		// Parse weather adjustment options
		try {

			// Reconstruct JSON string from deformed controller output
			adjustmentOptions = JSON.parse( "{" + adjustmentOptions + "}" );
		} catch (err) {

			// If the JSON is not valid, do not incorporate weather adjustment options
			adjustmentOptions = false;
		}

		// Parse location string
	    if ( filters.gps.test( location ) ) {

			// Handle GPS coordinates by storing each coordinate in an array
			location = location.split( "," );
			location = [ parseFloat( location[0] ), parseFloat( location[1] ) ];

			// Continue with the weather request
			getWeatherData( location, finishRequest );

	    } else if ( filters.pws.test( location ) ) {

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
} )();

