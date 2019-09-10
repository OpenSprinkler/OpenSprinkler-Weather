import * as express from "express";
import * as http from "http";
import * as https from "https";
import * as SunCalc from "suncalc";
import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";

import { BaseWateringData, GeoCoordinates, PWS, TimeData, WeatherData } from "../types";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./adjustmentMethods/AdjustmentMethod";
import WateringScaleCache, { CachedScale } from "../WateringScaleCache";
import ManualAdjustmentMethod from "./adjustmentMethods/ManualAdjustmentMethod";
import ZimmermanAdjustmentMethod from "./adjustmentMethods/ZimmermanAdjustmentMethod";
import RainDelayAdjustmentMethod from "./adjustmentMethods/RainDelayAdjustmentMethod";
import EToAdjustmentMethod from "./adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode, makeCodedError } from "../errors";

const WEATHER_PROVIDER: WeatherProvider = new ( require("./weatherProviders/" + ( process.env.WEATHER_PROVIDER || "OWM" ) ).default )();
const PWS_WEATHER_PROVIDER: WeatherProvider = new ( require("./weatherProviders/" + ( process.env.PWS_WEATHER_PROVIDER || "WUnderground" ) ).default )();

// Define regex filters to match against location
const filters = {
	gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
	pws: /^(?:pws|icao|zmw):/,
	url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
	time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/,
	timezone: /^()()()()()()([+-])(\d{2})(\d{2})/
};

/** AdjustmentMethods mapped to their numeric IDs. */
const ADJUSTMENT_METHOD: { [ key: number ] : AdjustmentMethod } = {
	0: ManualAdjustmentMethod,
	1: ZimmermanAdjustmentMethod,
	2: RainDelayAdjustmentMethod,
	3: EToAdjustmentMethod
};

const cache = new WateringScaleCache();

/**
 * Resolves a location description to geographic coordinates.
 * @param location A partial zip/city/country or a coordinate pair.
 * @return A promise that will be resolved with the coordinates of the best match for the specified location, or
 * rejected with a CodedError if unable to resolve the location.
 */
export async function resolveCoordinates( location: string ): Promise< GeoCoordinates > {

	if ( !location ) {
		throw new CodedError( ErrorCode.InvalidLocationFormat );
	}

	if ( filters.pws.test( location ) ) {
		throw new CodedError( ErrorCode.InvalidLocationFormat );
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
			throw new CodedError( ErrorCode.LocationServiceApiError );
		}

		// Check if the data is valid
		if ( typeof data.RESULTS === "object" && data.RESULTS.length && data.RESULTS[ 0 ].tz !== "MISSING" ) {

			// If it is, reply with an array containing the GPS coordinates
			return [ parseFloat( data.RESULTS[ 0 ].lat ), parseFloat( data.RESULTS[ 0 ].lon ) ];
		} else {

			// Otherwise, indicate no data was found
			throw new CodedError( ErrorCode.NoLocationFound );
		}
	}
}

/**
 * Makes an HTTP/HTTPS GET request to the specified URL and parses the JSON response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with parsed response body if the request succeeds, or will be rejected
 * with an error if the request or JSON parsing fails. This error may contain information about the HTTP request or,
 * response including API keys and other sensitive information.
 */
export async function httpJSONRequest(url: string ): Promise< any > {
	try {
		const data: string = await httpRequest(url);
		return JSON.parse(data);
	} catch (err) {
		// Reject the promise if there was an error making the request or parsing the JSON.
		throw err;
	}
}

/**
 * Calculates timezone and sunrise/sunset for the specified coordinates.
 * @param coordinates The coordinates to use to calculate time data.
 * @return The TimeData for the specified coordinates.
 */
function getTimeData( coordinates: GeoCoordinates ): TimeData {
	const timezone = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ] ).utcOffset();
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
 * Checks if the weather data meets any of the restrictions set by OpenSprinkler. Restrictions prevent any watering
 * from occurring and are similar to 0% watering level. Known restrictions are:
 *
 * - California watering restriction prevents watering if precipitation over two days is greater than 0.1" over the past
 * 48 hours.
 * @param adjustmentValue The adjustment value, which indicates which restrictions should be checked.
 * @param weather Watering data to use to determine if any restrictions apply.
 * @return A boolean indicating if the watering level should be set to 0% due to a restriction.
 */
function checkWeatherRestriction( adjustmentValue: number, weather: BaseWateringData ): boolean {

	const californiaRestriction = ( adjustmentValue >> 7 ) & 1;

	if ( californiaRestriction ) {

		// TODO depending on which WeatherProvider is used, this might be checking if rain is forecasted in th next 24
		// 	hours rather than checking if it has rained in the past 48 hours.
		// If the California watering restriction is in use then prevent watering
		// if more then 0.1" of rain has accumulated in the past 48 hours
		if ( weather.precip > 0.1 ) {
			return true;
		}
	}

	return false;
}

export const getWeatherData = async function( req: express.Request, res: express.Response ) {
	const location: string = getParameter(req.query.loc);

	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err) {
		res.send(`Error: Unable to resolve location (${err})`);
		return;
	}

	// Continue with the weather request
	const timeData: TimeData = getTimeData( coordinates );
	let weatherData: WeatherData;
	try {
		weatherData = await WEATHER_PROVIDER.getWeatherData( coordinates );
	} catch ( err ) {
		res.send( "Error: " + err );
		return;
	}

	res.json( {
		...timeData,
		...weatherData,
		location: coordinates
	} );
};

// API Handler when using the weatherX.py where X represents the
// adjustment method which is encoded to also carry the watering
// restriction and therefore must be decoded
export const getWateringData = async function( req: express.Request, res: express.Response ) {

	// The adjustment method is encoded by the OpenSprinkler firmware and must be
	// parsed. This allows the adjustment method and the restriction type to both
	// be saved in the same byte.
	let adjustmentMethod: AdjustmentMethod	= ADJUSTMENT_METHOD[ req.params[ 0 ] & ~( 1 << 7 ) ],
		checkRestrictions: boolean			= ( ( req.params[ 0 ] >> 7 ) & 1 ) > 0,
		adjustmentOptionsString: string		= getParameter(req.query.wto),
		location: string | GeoCoordinates	= getParameter(req.query.loc),
		outputFormat: string				= getParameter(req.query.format),
		remoteAddress: string				= getParameter(req.headers[ "x-forwarded-for" ]) || req.connection.remoteAddress,
		adjustmentOptions: AdjustmentOptions;

	// X-Forwarded-For header may contain more than one IP address and therefore
	// the string is split against a comma and the first value is selected
	remoteAddress = remoteAddress.split( "," )[ 0 ];

	if ( !adjustmentMethod ) {
		sendWateringError( res, new CodedError( ErrorCode.InvalidAdjustmentMethod ));
		return;
	}

	// Parse weather adjustment options
	try {

		// Parse data that may be encoded
		adjustmentOptionsString = decodeURIComponent( adjustmentOptionsString.replace( /\\x/g, "%" ) );

		// Reconstruct JSON string from deformed controller output
		adjustmentOptions = JSON.parse( "{" + adjustmentOptionsString + "}" );
	} catch ( err ) {
		// If the JSON is not valid then abort the calculation
		sendWateringError( res, new CodedError( ErrorCode.MalformedAdjustmentOptions ) );
		return;
	}

	// Attempt to resolve provided location to GPS coordinates.
	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch ( err ) {
		sendWateringError( res, makeCodedError( err ) );
		return;
	}

	let timeData: TimeData = getTimeData( coordinates );

	// Parse the PWS information.
	let pws: PWS | undefined = undefined;
	if ( adjustmentOptions.pws && adjustmentOptions.key ) {

		const idMatch = adjustmentOptions.pws.match( /^[a-zA-Z\d]+$/ );
		const pwsId = idMatch ? idMatch[ 0 ] : undefined;
		const keyMatch = adjustmentOptions.key.match( /^[a-f\d]{32}$/ );
		const apiKey = keyMatch ? keyMatch[ 0 ] : undefined;

		// Make sure that the PWS ID and API key look valid.
		if ( !pwsId ) {
			sendWateringError( res, new CodedError( ErrorCode.InvalidPwsId ) );
			return;
		}
		if ( !apiKey ) {
			sendWateringError( res, new CodedError( ErrorCode.InvalidPwsApiKey ) );
			return;
		}

		pws = { id: pwsId, apiKey: apiKey };
	}

	const weatherProvider = pws ? PWS_WEATHER_PROVIDER : WEATHER_PROVIDER;

	const data = {
		scale:		undefined,
		rd:			undefined,
		tz:			getTimezone( timeData.timezone, undefined ),
		sunrise:	timeData.sunrise,
		sunset:		timeData.sunset,
		eip:		ipToInt( remoteAddress ),
		rawData:	undefined,
		errCode:	0
	};

	let cachedScale: CachedScale;
	if ( weatherProvider.shouldCacheWateringScale() ) {
		cachedScale = cache.getWateringScale( req.params[ 0 ], coordinates, pws, adjustmentOptions );
	}

	if ( cachedScale ) {
		// Use the cached data if it exists.
		data.scale = cachedScale.scale;
		data.rawData = cachedScale.rawData;
		data.rd = cachedScale.rainDelay;
	} else {
		// Calculate the watering scale if it wasn't found in the cache.
		let adjustmentMethodResponse: AdjustmentMethodResponse;
		try {
			adjustmentMethodResponse = await adjustmentMethod.calculateWateringScale(
				adjustmentOptions, coordinates, weatherProvider, pws
			);
		} catch ( err ) {
			sendWateringError( res, makeCodedError( err ) );
			return;
		}

		data.scale = adjustmentMethodResponse.scale;
		data.rd = adjustmentMethodResponse.rainDelay;
		data.rawData = adjustmentMethodResponse.rawData;

		if ( checkRestrictions ) {
			let wateringData: BaseWateringData = adjustmentMethodResponse.wateringData;
			// Fetch the watering data if the AdjustmentMethod didn't fetch it and restrictions are being checked.
			if ( checkRestrictions && !wateringData ) {
				try {
					wateringData = await weatherProvider.getWateringData( coordinates );
				} catch ( err ) {
					sendWateringError( res, makeCodedError( err ) );
					return;
				}
			}

			// Check for any user-set restrictions and change the scale to 0 if the criteria is met
			if ( checkWeatherRestriction( req.params[ 0 ], wateringData ) ) {
				data.scale = 0;
			}
		}

		// Cache the watering scale if caching is enabled and no error occurred.
		if ( weatherProvider.shouldCacheWateringScale() ) {
			cache.storeWateringScale( req.params[ 0 ], coordinates, pws, adjustmentOptions, {
				scale: data.scale,
				rawData: data.rawData,
				rainDelay: data.rd
			} );
		}
	}

	sendWateringData( res, data, outputFormat === "json" );
};

/**
 * Sends a response to a watering scale request with an error code and a default watering scale of 100%.
 * @param res The Express Response object to send the response through.
 * @param error The error code to send in the response body.
 * @param useJson Indicates if the response body should use a JSON format instead of a format similar to URL query strings.
 */
function sendWateringError( res: express.Response, error: CodedError, useJson: boolean = false ) {
	if ( error.errCode === ErrorCode.UnexpectedError ) {
		console.error( `An unexpected error occurred:`, error );
	}

	sendWateringData( res, { errCode: error.errCode, scale: 100 } );
}

/**
 * Sends a response to an HTTP request with a 200 status code.
 * @param res The Express Response object to send the response through.
 * @param data An object containing key/value pairs that should be formatted in the response body.
 * @param useJson Indicates if the response body should use a JSON format instead of a format similar to URL query strings.
 */
function sendWateringData( res: express.Response, data: object, useJson: boolean = false ) {
	if ( useJson ) {
		res.json( data );
	} else {
		// Return the data formatted as a URL query string.
		let formatted = "";
		for ( const key in data ) {
			// Skip inherited properties.
			if ( !data.hasOwnProperty( key ) ) {
				continue;
			}

			let value = data[ key ];
			switch ( typeof value ) {
				case "undefined":
					// Skip undefined properties.
					continue;
				case "object":
					// Convert objects to JSON.
					value = JSON.stringify( value );
				// Fallthrough.
				case "string":
					/* URL encode strings. Since the OS firmware uses a primitive version of query string parsing and
					decoding, only some characters need to be escaped and only spaces ("+" or "%20") will be decoded. */
					value = value.replace( / /g, "+" ).replace( /\n/g, "\\n" ).replace( /&/g, "AMPERSAND" );
					break;
			}

			formatted += `&${ key }=${ value }`;
		}
		res.send( formatted );
	}
}

/**
 * Makes an HTTP/HTTPS GET request to the specified URL and returns the response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with response body if the request succeeds, or will be rejected with an
 * error if the request fails or returns a non-200 status code. This error may contain information about the HTTP
 * request or, response including API keys and other sensitive information.
 */
async function httpRequest( url: string ): Promise< string > {
	return new Promise< any >( ( resolve, reject ) => {

		const splitUrl: string[] = url.match( filters.url );
		const isHttps = url.startsWith("https");

		const options = {
			host: splitUrl[ 1 ],
			port: splitUrl[ 2 ] || ( isHttps ? 443 : 80 ),
			path: splitUrl[ 3 ]
		};

		( isHttps ? https : http ).get( options, ( response ) => {
			if ( response.statusCode !== 200 ) {
				reject( `Received ${ response.statusCode } status code for URL '${ url }'.` );
				return;
			}

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
export function validateValues( keys: string[], obj: object ): boolean {
	let key: string;

	// Return false if the object is null/undefined.
	if ( !obj ) {
		return false;
	}

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
export function getParameter( parameter: string | string[] ): string {
	if ( Array.isArray( parameter ) ) {
		parameter = parameter[0];
	}

	// Return an empty string if the parameter is undefined.
	return parameter || "";
}
