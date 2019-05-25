import * as express from "express";
import * as http from "http";
import * as https from "https";
import * as SunCalc from "suncalc";
import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";

import {
	AdjustmentOptions,
	EToData,
	ETScalingAdjustmentOptions,
	GeoCoordinates,
	TimeData,
	WateringData,
	WeatherData,
	WeatherProvider,
	ZimmermanAdjustmentOptions
} from "../types";
import { calculateETo } from "../EToCalculator";
const weatherProvider: WeatherProvider = require("./weatherProviders/" + ( process.env.WEATHER_PROVIDER || "OWM" ) ).default;

// Define regex filters to match against location
const filters = {
	gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
	pws: /^(?:pws|icao|zmw):/,
	url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
	time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/,
	timezone: /^()()()()()()([+-])(\d{2})(\d{2})/
};

// Enum of available watering scale adjustment methods.
const ADJUSTMENT_METHOD = {
	MANUAL: 0,
	ZIMMERMAN: 1,
	RAIN_DELAY: 2,
	ET_SCALING: 3
};

/**
 * Resolves a location description to geographic coordinates.
 * @param location A partial zip/city/country or a coordinate pair.
 * @return A promise that will be resolved with the coordinates of the best match for the specified location, or
 * rejected with an error message if unable to resolve the location.
 */
async function resolveCoordinates( location: string ): Promise< GeoCoordinates > {

	if ( !location ) {
		throw "No location specified";
	}

	if ( filters.pws.test( location ) ) {
		throw "Weather Underground is discontinued";
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
			throw "No match found for specified location";
		}
	}
}

/**
 * Makes an HTTP/HTTPS GET request to the specified URL and parses the JSON response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with parsed response body if the request succeeds, or will be rejected
 * with an Error if the request or JSON parsing fails.
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
 * Calculates how much watering should be scaled based on weather and adjustment options using the Zimmerman method.
 * @param adjustmentOptions Options to tweak the calculation, or undefined/null if no custom values are to be used.
 * @param wateringData The weather to use to calculate watering percentage.
 * @return The percentage that watering should be scaled by.
 */
function calculateZimmermanWateringScale( adjustmentOptions: ZimmermanAdjustmentOptions, wateringData: WateringData ): number {

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

/**
 * Calculates how much watering should be scaled based on weather and adjustment options by comparing a recent ETo to
 * the base ETo that the watering program was designed for.
 * @param adjustmentOptions Options to tweak the calculation, or undefined/null if no custom values are to be used.
 * @param etoData The data to use to calculate the recent ETo.
 * @return A promise that will be resolved with the percentage that watering should be scaled by.
 */
async function calculateETScaling( adjustmentOptions: ETScalingAdjustmentOptions, etoData: EToData ): Promise< number > {

	// TODO this default baseETo is not based on any data. Automatically determine ETo based on geographic location instead.
	let elevation = 150, baseETo = 2;

	if ( adjustmentOptions && "elevation" in adjustmentOptions ) {
		elevation = adjustmentOptions.elevation;
	}

	if ( adjustmentOptions && "baseETo" in adjustmentOptions ) {
		baseETo = adjustmentOptions.baseETo
	}

	const eto: number = calculateETo( etoData, elevation );

	return Math.floor( Math.min( Math.max( 0, ( eto - etoData.precip ) / baseETo * 100 ), 200 ) );
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

	if ( !weatherProvider.getWeatherData ) {
		res.send( "Error: selected WeatherProvider does not support getWeatherData" );
		return;
	}

	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err) {
		res.send(`Error: Unable to resolve location (${err})`);
		return;
	}

	// Continue with the weather request
	const timeData: TimeData = getTimeData( coordinates );
	const weatherData: WeatherData = await weatherProvider.getWeatherData( coordinates );

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
	let adjustmentMethod: number			= req.params[ 0 ] & ~( 1 << 7 ),
		adjustmentOptionsString: string		= getParameter(req.query.wto),
		location: string | GeoCoordinates	= getParameter(req.query.loc),
		outputFormat: string				= getParameter(req.query.format),
		remoteAddress: string				= getParameter(req.headers[ "x-forwarded-for" ]) || req.connection.remoteAddress,
		adjustmentOptions: AdjustmentOptions;


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

		// If the JSON is not valid then abort the claculation
		res.send(`Error: Unable to parse options (${err})`);
		return;
	}

	// Attempt to resolve provided location to GPS coordinates.
	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err) {
		res.send(`Error: Unable to resolve location (${err})`);
		return;
	}
	location = coordinates;

	// Continue with the weather request
	let timeData: TimeData = getTimeData( coordinates );
	let wateringData: WateringData;
	if ( adjustmentMethod !== ADJUSTMENT_METHOD.MANUAL ) {
		if ( !weatherProvider.getWateringData ) {
			res.send( "Error: selected WeatherProvider does not support getWateringData" );
			return;
		}

		wateringData = await weatherProvider.getWateringData( coordinates );
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

	let scale = -1,	rainDelay = -1;

	if ( adjustmentMethod === ADJUSTMENT_METHOD.ZIMMERMAN ) {
		scale = calculateZimmermanWateringScale( adjustmentOptions, wateringData );
	} else if ( adjustmentMethod === ADJUSTMENT_METHOD.ET_SCALING ) {
		if ( !weatherProvider.getEToData ) {
			res.send( "Error: selected WeatherProvider does not support getEToData" );
			return;
		}

		const etoData: EToData = await weatherProvider.getEToData( coordinates );
		scale = await calculateETScaling( adjustmentOptions, etoData );
	}

	if (wateringData) {
		// Check for any user-set restrictions and change the scale to 0 if the criteria is met
		if (checkWeatherRestriction(req.params[0], wateringData)) {
			scale = 0;
		}

		// If any weather adjustment is being used, check the rain status
		if ( adjustmentMethod > ADJUSTMENT_METHOD.MANUAL && wateringData.raining ) {

			// If it is raining and the user has weather-based rain delay as the adjustment method then apply the specified delay
			if ( adjustmentMethod === ADJUSTMENT_METHOD.RAIN_DELAY ) {

				rainDelay = ( adjustmentOptions && adjustmentOptions.hasOwnProperty( "d" ) ) ? adjustmentOptions.d : 24;
			} else {

				// For any other adjustment method, apply a scale of 0 (as the scale will revert when the rain stops)
				scale = 0;
			}
		}
	}

	const data = {
		scale:		scale,
		rd:			rainDelay,
		tz:			getTimezone( timeData.timezone, undefined ),
		sunrise:	timeData.sunrise,
		sunset:		timeData.sunset,
		eip:		ipToInt( remoteAddress ),
		rawData:	undefined
	};

	if ( adjustmentMethod === ADJUSTMENT_METHOD.ZIMMERMAN || adjustmentMethod === ADJUSTMENT_METHOD.RAIN_DELAY ) {
		data.rawData = {
			h: wateringData ? Math.round( wateringData.humidity * 100) / 100 : null,
			p: wateringData ? Math.round( wateringData.precip * 100 ) / 100 : null,
			t: wateringData ? Math.round( wateringData.temp * 10 ) / 10 : null,
			raining: wateringData ? ( wateringData.raining ? 1 : 0 ) : null
		};
	}
	// TODO include raw data from ETo scaling.

	/* Note: The local WeatherProvider will never return undefined, so there's no need to worry about this condition
		failing to be met if the local WeatherProvider is used but wateringData is falsy (since it will never happen). */
	if ( wateringData && wateringData.weatherProvider === "local" ) {
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
			( data.rawData ? "&rawData=" + JSON.stringify( data.rawData ) : "" )
		);
	}

};

/**
 * Makes an HTTP/HTTPS GET request to the specified URL and returns the response body.
 * @param url The URL to fetch.
 * @return A Promise that will be resolved the with response body if the request succeeds, or will be rejected with an
 * Error if the request fails.
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
