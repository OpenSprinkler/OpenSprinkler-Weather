import * as express	from "express";
import { AdjustmentOptions, GeoCoordinates, TimeData, WateringData, WeatherData } from "../types";

const http		= require( "http" ),
	local		= require( "./local"),
	SunCalc		= require( "suncalc" ),
	moment		= require( "moment-timezone" ),
	geoTZ	 	= require( "geo-tz" ),

	// Define regex filters to match against location
	filters		= {
		gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
		pws: /^(?:pws|icao|zmw):/,
		url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
		time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/,
		timezone: /^()()()()()()([+-])(\d{2})(\d{2})/
	};

/**
 * Resolves a location description to geographic coordinates.
 * @param location A partial zip/city/country or a coordinate pair.
 * @return A promise that will be resolved with the coordinates of the best match for the specified location, or
 * rejected with an error message if unable to resolve the location.
 */
async function resolveCoordinates( location: string ): Promise< GeoCoordinates > {

	if ( filters.pws.test( location ) ) {
		throw "Unable to resolve location";
	} else if ( filters.gps.test( location ) ) {
		const split: string[] = location.split( "," );
		return [ parseFloat( split[ 0 ] ), parseFloat( split[ 1 ] ) ];
	} else {
		// Generate URL for autocomplete request
		const url = "http://autocomplete.wunderground.com/aq?h=0&query=" +
			encodeURIComponent( location );

		let data;
		try {
			data = await httpJSONRequest( url );
		} catch (err) {
			// If the request fails, indicate no data was found.
			throw "An API error occurred while attempting to resolve location";
		}

		// Check if the data is valid
		if ( typeof data.RESULTS === "object" && data.RESULTS.length && data.RESULTS[ 0 ].tz !== "MISSING" ) {

			// If it is, reply with an array containing the GPS coordinates
			return [ data.RESULTS[ 0 ].lat, data.RESULTS[ 0 ].lon ];
		} else {

			// Otherwise, indicate no data was found
			throw "Unable to resolve location";
		}
	}
}

/**
 * Makes an HTTP/HTTPS GET request to the specified URL and parses the JSON response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with parsed response body if the request succeeds, or will be rejected
 * with an Error if the request or JSON parsing fails.
 */
async function httpJSONRequest(url: string ): Promise< any > {
	try {
		const data: string = await httpRequest(url);
		return JSON.parse(data);
	} catch (err) {
		// Reject the promise if there was an error making the request or parsing the JSON.
		throw err;
	}
}

/**
 * Retrieves weather data necessary for watering level calculations from the OWM API.
 * @param coordinates The coordinates to retrieve the watering data for.
 * @return A Promise that will be resolved with WateringData if the API calls succeed, or resolved with undefined
 * if an error occurs while retrieving the weather data.
 */
async function getOWMWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	const OWM_API_KEY = process.env.OWM_API_KEY,
		forecastUrl = "http://api.openweathermap.org/data/2.5/forecast?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

	// Perform the HTTP request to retrieve the weather data
	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Indicate watering data could not be retrieved if the forecast data is incomplete.
	if ( !forecast || !forecast.list ) {
		return undefined;
	}

	let totalTemp = 0,
		totalHumidity = 0,
		totalPrecip = 0;

	const periods = Math.min(forecast.list.length, 10);
	for ( let index = 0; index < periods; index++ ) {
		totalTemp += parseFloat( forecast.list[ index ].main.temp );
		totalHumidity += parseInt( forecast.list[ index ].main.humidity );
		totalPrecip += ( forecast.list[ index ].rain ? parseFloat( forecast.list[ index ].rain[ "3h" ] || 0 ) : 0 );
	}

	return {
		temp: totalTemp / periods,
		humidity: totalHumidity / periods,
		precip: totalPrecip / 25.4,
		raining: ( forecast.list[ 0 ].rain ? ( parseFloat( forecast.list[ 0 ].rain[ "3h" ] || 0 ) > 0 ) : false )
	};
}

/**
 * Retrieves the current weather data from OWM for usage in the mobile app.
 * @param coordinates The coordinates to retrieve the weather for
 * @return A Promise that will be resolved with the WeatherData if the API calls succeed, or resolved with undefined
 * if an error occurs while retrieving the weather data.
 */
async function getOWMWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
	const OWM_API_KEY = process.env.OWM_API_KEY,
		currentUrl = "http://api.openweathermap.org/data/2.5/weather?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ],
		forecastDailyUrl = "http://api.openweathermap.org/data/2.5/forecast/daily?appid=" + OWM_API_KEY + "&units=imperial&lat=" + coordinates[ 0 ] + "&lon=" + coordinates[ 1 ];

	let current, forecast;
	try {
		current = await httpJSONRequest( currentUrl );
		forecast = await httpJSONRequest( forecastDailyUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Indicate watering data could not be retrieved if the forecast data is incomplete.
	if ( !current || !current.main || !current.wind || !current.weather || !forecast || !forecast.list ) {
		return undefined;
	}

	const weather: WeatherData = {
		temp:  parseInt( current.main.temp ),
		humidity: parseInt( current.main.humidity ),
		wind: parseInt( current.wind.speed ),
		description: current.weather[0].description,
		icon: current.weather[0].icon,

		region: forecast.city.country,
		city: forecast.city.name,
		minTemp: parseInt( forecast.list[ 0 ].temp.min ),
		maxTemp: parseInt( forecast.list[ 0 ].temp.max ),
		precip: ( forecast.list[ 0 ].rain ? parseFloat( forecast.list[ 0 ].rain || 0 ) : 0 ) / 25.4,
		forecast: []
	};

	for ( let index = 0; index < forecast.list.length; index++ ) {
		weather.forecast.push( {
			temp_min: parseInt( forecast.list[ index ].temp.min ),
			temp_max: parseInt( forecast.list[ index ].temp.max ),
			date: parseInt( forecast.list[ index ].dt ),
			icon: forecast.list[ index ].weather[ 0 ].icon,
			description: forecast.list[ index ].weather[ 0 ].description
		} );
	}

	return weather;
}

/**
 * Retrieves weather data necessary for watering level calculations from the a local record.
 * @param coordinates The coordinates to retrieve the watering data for.
 * @return A Promise that will be resolved with WateringData.
 */
async function getLocalWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	return local.getLocalWeather();
}

/**
 * Calculates timezone and sunrise/sunset for the specified coordinates.
 * @param coordinates The coordinates to use to calculate time data.
 * @return The TimeData for the specified coordinates.
 */
function getTimeData( coordinates: GeoCoordinates ): TimeData {
	const timezone = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] ) ).utcOffset();
	const tzOffset: number = getTimezone( timezone, true );

	// Calculate sunrise and sunset since Weather Underground does not provide it
	const sunData = SunCalc.getTimes( new Date(), coordinates[ 0 ], coordinates[ 1 ] );

	sunData.sunrise.setUTCMinutes( sunData.sunrise.getUTCMinutes() + tzOffset );
	sunData.sunset.setUTCMinutes( sunData.sunset.getUTCMinutes() + tzOffset );

	return {
		timezone:	timezone,
		sunrise:	( sunData.sunrise.getUTCHours() * 60 + sunData.sunrise.getUTCMinutes() ),
		sunset:		( sunData.sunset.getUTCHours() * 60 + sunData.sunset.getUTCMinutes() )
	};
}

/**
 * Calculates how much watering should be scaled based on weather and adjustment options.
 * @param adjustmentMethod The method to use to calculate the watering percentage. The only supported method is 1, which
 * corresponds to the Zimmerman method. If an invalid adjustmentMethod is used, this method will return -1.
 * @param adjustmentOptions Options to tweak the calculation, or undefined/null if no custom values are to be used.
 * @param wateringData The weather to use to calculate watering percentage.
 * @return The percentage that watering should be scaled by, or -1 if an invalid adjustmentMethod was provided.
 */
function calculateWeatherScale( adjustmentMethod: number, adjustmentOptions: AdjustmentOptions, wateringData: WateringData ): number {

	// Zimmerman method
	if ( adjustmentMethod === 1 ) {
		let humidityBase = 30, tempBase = 70, precipBase = 0;

		// Check to make sure valid data exists for all factors
		if ( !validateValues( [ "temp", "humidity", "precip" ], wateringData ) ) {
			return 100;
		}

		// Get baseline conditions for 100% water level, if provided
		if ( adjustmentOptions ) {
			humidityBase = adjustmentOptions.hasOwnProperty( "bh" ) ? adjustmentOptions.bh : humidityBase;
			tempBase = adjustmentOptions.hasOwnProperty( "bt" ) ? adjustmentOptions.bt : tempBase;
			precipBase = adjustmentOptions.hasOwnProperty( "br" ) ? adjustmentOptions.br : precipBase;
		}

		let temp = wateringData.temp,
			humidityFactor = ( humidityBase - wateringData.humidity ),
			tempFactor = ( ( temp - tempBase ) * 4 ),
			precipFactor = ( ( precipBase - wateringData.precip ) * 200 );

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
		return Math.floor( Math.min( Math.max( 0, 100 + humidityFactor + tempFactor + precipFactor ), 200 ) );
	}

	return -1;
}

/**
 * Checks if the weather data meets any of the restrictions set by OpenSprinkler. Restrictions prevent any watering
 * from occurring and are similar to 0% watering level. Known restrictions are:
 *
 * - California watering restriction prevents watering if precipitation over two days is greater than 0.1" over the past
 * 48 hours.
 * @param adjustmentValue The adjustment value, which indicates which restrictions should be checked.
 * @param weather Watering data to use to determine if any restrictions apply.
 * @return A boolean indicating if the watering level should be set to 0% due to a restriction.
 */
function checkWeatherRestriction( adjustmentValue: number, weather: WateringData ): boolean {

	const californiaRestriction = ( adjustmentValue >> 7 ) & 1;

	if ( californiaRestriction ) {

		// TODO this is currently checking if the forecasted precipitation over the next 30 hours is >0.1 inches
		// If the California watering restriction is in use then prevent watering
		// if more then 0.1" of rain has accumulated in the past 48 hours
		if ( weather.precip > 0.1 ) {
			return true;
		}
	}

	return false;
}

exports.getWeatherData = async function( req: express.Request, res: express.Response ) {
	const location: string = getParameter(req.query.loc);

	if ( !location ) {
		res.send( "Error: Unable to resolve location" );
		return;
	}

	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err) {
		res.send( "Error: Unable to resolve location" );
		return;
	}

	// Continue with the weather request
	const timeData: TimeData = getTimeData( coordinates );
	const weatherData: WeatherData = await getOWMWeatherData( coordinates );

	res.json( {
		...timeData,
		...weatherData,
		location: coordinates
	} );
};

// API Handler when using the weatherX.py where X represents the
// adjustment method which is encoded to also carry the watering
// restriction and therefore must be decoded
exports.getWateringData = async function( req: express.Request, res: express.Response ) {

	// The adjustment method is encoded by the OpenSprinkler firmware and must be
	// parsed. This allows the adjustment method and the restriction type to both
	// be saved in the same byte.
	let adjustmentMethod: number			= req.params[ 0 ] & ~( 1 << 7 ),
		adjustmentOptionsString: string		= getParameter(req.query.wto),
		location: string | GeoCoordinates	= getParameter(req.query.loc),
		outputFormat: string				= getParameter(req.query.format),
		remoteAddress: string				= getParameter(req.headers[ "x-forwarded-for" ]) || req.connection.remoteAddress,
		adjustmentOptions: AdjustmentOptions;


	// Exit if no location is provided
	if ( !location ) {
		res.send( "Error: No location provided." );
		return;
	}

	// X-Forwarded-For header may contain more than one IP address and therefore
	// the string is split against a comma and the first value is selected
	remoteAddress = remoteAddress.split( "," )[ 0 ];

	// Parse weather adjustment options
	try {

		// Parse data that may be encoded
		adjustmentOptionsString = decodeURIComponent( adjustmentOptionsString.replace( /\\x/g, "%" ) );

		// Reconstruct JSON string from deformed controller output
		adjustmentOptions = JSON.parse( "{" + adjustmentOptionsString + "}" );
	} catch ( err ) {

		// If the JSON is not valid, do not incorporate weather adjustment options
		adjustmentOptions = undefined;
	}

	let coordinates: GeoCoordinates;
	// Parse location string
	if ( filters.pws.test( location ) ) {

		// Weather Underground is discontinued and PWS or ICAO cannot be resolved
		res.send( "Error: Weather Underground is discontinued." );
		return;
	} else if ( filters.gps.test( location ) ) {

		// Handle GPS coordinates by storing each coordinate in an array
		const splitLocation: string[] = location.split( "," );
		coordinates = [ parseFloat( splitLocation[ 0 ] ), parseFloat( splitLocation[ 1 ] ) ];
		location = coordinates;

	} else {

		// Attempt to resolve provided location to GPS coordinates when it does not match
		// a GPS coordinate or Weather Underground location using Weather Underground autocomplete
		try {
			coordinates = await resolveCoordinates( location );
		} catch (err) {
			res.send("Error: Unable to resolve location");
			return;
		}

		location = coordinates;
	}

	// Continue with the weather request
	let timeData: TimeData = getTimeData( coordinates );
	let wateringData: WateringData;
	if ( local.useLocalWeather() ) {
		wateringData = await getLocalWateringData( coordinates );
	} else {
		wateringData = await getOWMWateringData(coordinates);
	}


	// Process data to retrieve the resulting scale, sunrise/sunset, timezone,
	// and also calculate if a restriction is met to prevent watering.

	// Use getTimeData as fallback if a PWS is used but time data is not provided.
	// This will never occur, but it might become possible in the future when PWS support is re-added.
	if ( !timeData ) {
		if ( typeof location[ 0 ] === "number" && typeof location[ 1 ] === "number" ) {
			timeData = getTimeData( location as GeoCoordinates );
		} else {
			res.send( "Error: No weather data found." );
			return;
		}
	}

	let scale: number = calculateWeatherScale( adjustmentMethod, adjustmentOptions, wateringData ),
		rainDelay: number = -1;

	if (wateringData) {
		// Check for any user-set restrictions and change the scale to 0 if the criteria is met
		if (checkWeatherRestriction(req.params[0], wateringData)) {
			scale = 0;
		}
	}

	// If any weather adjustment is being used, check the rain status
	if ( adjustmentMethod > 0 && wateringData && wateringData.raining ) {

		// If it is raining and the user has weather-based rain delay as the adjustment method then apply the specified delay
		if ( adjustmentMethod === 2 ) {

			rainDelay = ( adjustmentOptions && adjustmentOptions.hasOwnProperty( "d" ) ) ? adjustmentOptions.d : 24;
		} else {

			// For any other adjustment method, apply a scale of 0 (as the scale will revert when the rain stops)
			scale = 0;
		}
	}

	const data = {
		scale:		scale,
		rd:			rainDelay,
		tz:			getTimezone( timeData.timezone, undefined ),
		sunrise:	timeData.sunrise,
		sunset:		timeData.sunset,
		eip:		ipToInt( remoteAddress ),
		// TODO this may need to be changed (https://github.com/OpenSprinkler/OpenSprinkler-Weather/pull/11#issuecomment-491037948)
		rawData:    {
			h: wateringData ? wateringData.humidity : null,
			p: wateringData ? Math.round( wateringData.precip * 100 ) / 100 : null,
			t: wateringData ? Math.round( wateringData.temp * 10 ) / 10 : null,
			raining: wateringData ? ( wateringData.raining ? 1 : 0 ) : null
		}
	};

	if ( local.useLocalWeather() ) {
		console.log( "OpenSprinkler Weather Response: %s", JSON.stringify( data ) );
	}

	// Return the response to the client in the requested format
	if ( outputFormat === "json" ) {
		res.json( data );
	} else {
		res.send(	"&scale="		+	data.scale +
			"&rd="			+	data.rd +
			"&tz="			+	data.tz +
			"&sunrise="		+	data.sunrise +
			"&sunset="		+	data.sunset +
			"&eip="			+	data.eip +
			"&rawData="     +   JSON.stringify( data.rawData )
		);
	}

};

/**
 * Makes an HTTP GET request to the specified URL and returns the response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with response body if the request succeeds, or will be rejected with an
 * Error if the request fails.
 */
async function httpRequest( url: string ): Promise< string > {
	return new Promise< any >( ( resolve, reject ) => {

		const splitUrl: string[] = url.match( filters.url );

		const options = {
			host: splitUrl[ 1 ],
			port: splitUrl[ 2 ] || 80,
			path: splitUrl[ 3 ]
		};

		http.get( options, ( response ) => {
			let data = "";

			// Reassemble the data as it comes in
			response.on( "data", ( chunk ) => {
				data += chunk;
			} );

			// Once the data is completely received, resolve the promise
			response.on( "end", () => {
				resolve( data );
			} );
		} ).on( "error", ( err ) => {

			// If the HTTP request fails, reject the promise
			reject( err );
		} );
	} );
}

/**
 * Checks if the specified object contains numeric values for each of the specified keys.
 * @param keys A list of keys to validate exist on the specified object.
 * @param obj The object to check.
 * @return A boolean indicating if the object has numeric values for all of the specified keys.
 */
function validateValues( keys: string[], obj: object ): boolean {
	let key: string;

	for ( key in keys ) {
		if ( !keys.hasOwnProperty( key ) ) {
			continue;
		}

		key = keys[ key ];

		if ( !obj.hasOwnProperty( key ) || typeof obj[ key ] !== "number" || isNaN( obj[ key ] ) || obj[ key ] === null || obj[ key ] === -999 ) {
			return false;
		}
	}

	return true;
}

/**
 * Converts a timezone to an offset in minutes or OpenSprinkler encoded format.
 * @param time A time string formatted in ISO-8601 or just the timezone.
 * @param useMinutes Indicates if the returned value should be in minutes of the OpenSprinkler encoded format.
 * @return The offset of the specified timezone in either minutes or OpenSprinkler encoded format (depending on the
 * value of useMinutes).
 */
function getTimezone( time: number | string, useMinutes: boolean = false ): number {

	let hour, minute;

	if ( typeof time === "number" ) {
		hour = Math.floor( time / 60 );
		minute = time % 60;
	} else {

		// Match the provided time string against a regex for parsing
		let splitTime = time.match( filters.time ) || time.match( filters.timezone );

		hour = parseInt( splitTime[ 7 ] + splitTime[ 8 ] );
		minute = parseInt( splitTime[ 9 ] );
	}

	if ( useMinutes ) {
		return ( hour * 60 ) + minute;
	} else {

		// Convert the timezone into the OpenSprinkler encoded format
		minute = ( minute / 15 >> 0 ) / 4;
		hour = hour + ( hour >= 0 ? minute : -minute );

		return ( ( hour + 12 ) * 4 ) >> 0;
	}
}

/**
 * Converts an IP address string to an integer.
 * @param ip The string representation of the IP address.
 * @return The integer representation of the IP address.
 */
function ipToInt( ip: string ): number {
    const split = ip.split( "." );
    return ( ( ( ( ( ( +split[ 0 ] ) * 256 ) + ( +split[ 1 ] ) ) * 256 ) + ( +split[ 2 ] ) ) * 256 ) + ( +split[ 3 ] );
}

/**
 * Returns a single value for a header/query parameter. If passed a single string, the same string will be returned. If
 * an array of strings is passed, the first value will be returned. If this value is null/undefined, an empty string
 * will be returned instead.
 * @param parameter An array of parameters or a single parameter value.
 * @return The first element in the array of parameter or the single parameter provided.
 */
function getParameter( parameter: string | string[] ): string {
	if ( Array.isArray( parameter ) ) {
		parameter = parameter[0];
	}

	// Return an empty string if the parameter is undefined.
	return parameter || "";
}
