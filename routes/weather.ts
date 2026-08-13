import * as express from "express";
import * as http from "http";
import * as https from "https";
import * as SunCalc from "suncalc";
import moment from "moment-timezone";
import geoTZ from "geo-tz";
import { ParsedQs } from "qs";

import { GeoCoordinates, PWS, TimeData, WeatherData } from "../types";
import { WeatherProvider } from "./weatherProviders/WeatherProvider";
import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./adjustmentMethods/AdjustmentMethod";
import WateringScaleCache, { CachedScale } from "../WateringScaleCache";
import ManualAdjustmentMethod from "./adjustmentMethods/ManualAdjustmentMethod";
import ZimmermanAdjustmentMethod from "./adjustmentMethods/ZimmermanAdjustmentMethod";
import RainDelayAdjustmentMethod from "./adjustmentMethods/RainDelayAdjustmentMethod";
import EToAdjustmentMethod, { calculateHargreavesSamaniETo } from "./adjustmentMethods/EToAdjustmentMethod";
import WaterBudgetAdjustmentMethod from "./adjustmentMethods/WaterBudgetAdjustmentMethod";
import { CodedError, ErrorCode, makeCodedError } from "../errors";
import { Geocoder } from "./geocoders/Geocoder";
import { applyWeatherSkips } from "./skips/SkipGuard";
import { buildFallbackChain, FallbackWeatherProvider, isPwsFallbackEnabled, parseFallbackKeys } from "./weatherProviders/FallbackWeatherProvider";
// Static provider/geocoder imports + registries replace runtime require("./..."+env) so the module
// graph is statically analyzable (vite/vitest) and explicit for the production build.
import AccuWeather from "./weatherProviders/AccuWeather";
import PirateWeather from "./weatherProviders/PirateWeather";
import Apple from "./weatherProviders/Apple";
import OWM from "./weatherProviders/OWM";
import OpenMeteo from "./weatherProviders/OpenMeteo";
import DWD from "./weatherProviders/DWD";
import WUnderground from "./weatherProviders/WUnderground";
import LocalWeatherProvider from "./weatherProviders/local";
import WUndergroundGeocoder from "./geocoders/WUnderground";
import GoogleMaps from "./geocoders/GoogleMaps";
import { recordDailyScale } from "./state/ScaleHistory";

/** Name → ctor for the env-selected PWS provider / geocoder (was a runtime `require("./..."+env)`). */
const PWS_PROVIDER_REGISTRY: { [ name: string ]: new () => WeatherProvider } = {
	WUnderground, AccuWeather, PirateWeather, Apple, OWM, OpenMeteo, DWD,
};
const GEOCODER_REGISTRY: { [ name: string ]: new () => Geocoder } = {
	WUnderground: WUndergroundGeocoder, GoogleMaps,
};

// Instantiate providers/geocoder lazily (first use), not at module load. Providers import helpers
// from this module (httpJSONRequest, etc.), so eager `new AccuWeather()` at load can run mid
// import-cycle (vite/ESM) before the class is initialized. Deferring to first request — after the
// whole graph is loaded — avoids that without a util-extraction refactor.
let _weatherProviders: { [ method: string ]: WeatherProvider } | undefined;
function weatherProviders(): { [ method: string ]: WeatherProvider } {
	if ( !_weatherProviders ) {
		_weatherProviders = {
			"AW": new AccuWeather(),
			"PW": new PirateWeather(),
			"Apple": new Apple(),
			"OWM": new OWM(),
			"OpenMeteo": new OpenMeteo(),
			"DWD": new DWD(),
			"WU": new WUnderground(),
		};
	}
	return _weatherProviders;
}

let _pwsWeatherProvider: WeatherProvider | undefined;
function pwsWeatherProvider(): WeatherProvider {
	if ( !_pwsWeatherProvider ) _pwsWeatherProvider = new ( PWS_PROVIDER_REGISTRY[ process.env.PWS_WEATHER_PROVIDER || "WUnderground" ] )();
	return _pwsWeatherProvider;
}

let _geocoder: Geocoder | undefined;
function geocoder(): Geocoder {
	if ( !_geocoder ) _geocoder = new ( GEOCODER_REGISTRY[ process.env.GEOCODER || "WUnderground" ] )();
	return _geocoder;
}

/**
 * Select the WeatherProvider for a request. Returns a bare provider when no fallback chain is
 * configured (identical to the historical behavior), or a FallbackWeatherProvider composite when
 * a chain is present. PWS default honors the station (bare); the chain is added to the PWS path
 * only when PWS_FALLBACK_ENABLED. Local mode always returns a bare local provider (no chain).
 */
export function resolveWeatherProvider(
	adjustmentOptions: AdjustmentOptions,
	pws: PWS | undefined
): WeatherProvider {
	if ( process.env.WEATHER_PROVIDER === "local" ) {
		return new LocalWeatherProvider();
	}
	const lookup = ( key: string ): WeatherProvider | undefined => weatherProviders()[ key ];
	if ( pws && pws.id ) {
		if ( !isPwsFallbackEnabled() ) return pwsWeatherProvider();
		const pwsChain = buildFallbackChain( pwsWeatherProvider(), parseFallbackKeys( adjustmentOptions ), lookup );
		return pwsChain.length > 1 ? new FallbackWeatherProvider( pwsChain, true ) : pwsWeatherProvider();
	}
	const primary = weatherProviders()[ adjustmentOptions.provider ] || weatherProviders()[ "Apple" ];
	const chain = buildFallbackChain( primary, parseFallbackKeys( adjustmentOptions ), lookup );
	return chain.length > 1 ? new FallbackWeatherProvider( chain, false ) : primary;
}

const filters = {
	gps: /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/,
	pws: /^(?:pws|icao|zmw):/,
	url: /^https?:\/\/([\w\.-]+)(:\d+)?(\/.*)?$/,
	time: /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})/,
	timezone: /^()()()()()()([+-])(\d{2})(\d{2})/
};

export const ADJUSTMENT_METHOD: { [ key: number ] : AdjustmentMethod } = {
	0: ManualAdjustmentMethod,
	1: ZimmermanAdjustmentMethod,
	2: RainDelayAdjustmentMethod,
	3: EToAdjustmentMethod,
	4: WaterBudgetAdjustmentMethod
};

/** Resolve the frozen legacy request ID after removing the bit-7 restriction flag. */
export function resolveLegacyAdjustmentMethod( adjustmentParam: number ): AdjustmentMethod | undefined {
	return ADJUSTMENT_METHOD[ adjustmentParam & ~( 1 << 7 ) ];
}

const cache = new WateringScaleCache();
const LEGACY_FIRMWARE_SUPPORT = process.env.LEGACY_FIRMWARE_SUPPORT !== 'false';
const SIMPLIFIED_RESPONSE_FORMAT = process.env.SIMPLIFIED_RESPONSE_FORMAT !== 'false';

export function debugLog(...args: any[]) {
	if (process.env.DEBUG_WEATHER === "true") console.log(...args);
}

debugLog(`DEBUG: Backward compatibility - Legacy support: ${LEGACY_FIRMWARE_SUPPORT}, Simplified format: ${SIMPLIFIED_RESPONSE_FORMAT}`);

export function redactLogString( value: string ): string {
	return value
		.replace( /(https?:\/\/[^\s'")?]+)\?[^\s'")]+/g, "$1" )
		.replace( /((?:^|[,{]\s*)["']?(?:key|apiKey|apikey)["']?\s*:\s*["']?)([^"',}\]]*)(["']?)/gi, "$1[REDACTED]$3" )
		.replace( /((?:^|[,{]\s*)["']?wto["']?\s*:\s*["']?)([^"',}\]]*)(["']?)/gi, "$1[REDACTED]$3" )
		.replace( /(\b(?:key|apiKey|apikey|wto)=)[^&\s'")]+/gi, "$1[REDACTED]" );
}

export function redactLogValue( value: any ): any {
	if ( typeof value === "string" ) return redactLogString( value );
	if ( value instanceof Error ) {
		const redactedError = new Error( redactLogString( value.message ) );
		redactedError.name = value.name;
		redactedError.stack = value.stack ? redactLogString( value.stack ) : value.stack;
		return redactedError;
	}
	if ( Array.isArray( value ) ) return value.map( redactLogValue );
	if ( value && typeof value === "object" ) {
		const redacted: any = {};
		for ( const key of Object.keys( value ) ) {
			const lowerKey = key.toLowerCase();
			redacted[ key ] = ( lowerKey === "key" || lowerKey === "apikey" || lowerKey === "wto" )
				? "[REDACTED]"
				: redactLogValue( value[ key ] );
		}
		return redacted;
	}
	return value;
}

function isLegacyFirmwareRequest(req: express.Request): boolean {
	if (!LEGACY_FIRMWARE_SUPPORT) return false;
	const userAgent = req.headers['user-agent'] || '';
	const referer = req.headers['referer'] || '';
	const legacyIndicators = [
		userAgent.includes('OpenSprinkler'), userAgent.includes('ESP8266'), userAgent.includes('Arduino'),
		referer.includes('/su'), !req.headers['accept']?.includes('application/json'), req.query.format !== 'json'
	];
	const isLegacy = legacyIndicators.some(indicator => indicator);
	debugLog(`DEBUG: Legacy firmware detection - User-Agent: "${userAgent}", Referer: "${referer}", Accept: "${req.headers['accept']}", Query.format: "${req.query.format}", Detected as legacy: ${isLegacy}`);
	return isLegacy;
}

export function convertToLegacyFormat(enhancedData: any, adjustmentMethod: AdjustmentMethod): any {
	if (!SIMPLIFIED_RESPONSE_FORMAT) {
		debugLog("DEBUG convertToLegacyFormat: SIMPLIFIED_RESPONSE_FORMAT is false, returning enhancedData.");
		return enhancedData;
	}
	debugLog("DEBUG convertToLegacyFormat: Converting enhanced response to legacy format. Input:", JSON.stringify(enhancedData));
	const legacyData: any = {
		scale: enhancedData.scale, rd: enhancedData.rd, tz: enhancedData.tz,
		sunrise: enhancedData.sunrise, sunset: enhancedData.sunset, eip: enhancedData.eip,
		errCode: enhancedData.errCode || 0
	};
	// Multi-day rolling averages ride the same whitelist: the firmware parses `scales=[n,...]`
	// (weather.cpp findKeyVal "scales") only on errCode 0, into /jc.wls.
	if ( Array.isArray( enhancedData.scales ) && enhancedData.scales.length > 0 ) {
		legacyData.scales = enhancedData.scales;
	}
	if (enhancedData.rawData) {
		const rawDataSource = enhancedData.rawData;
		legacyData.rawData = { wp: rawDataSource.wp || rawDataSource.weatherProvider || "local" };
		if (adjustmentMethod === EToAdjustmentMethod) {
			Object.assign(legacyData.rawData, {
				eto: rawDataSource.eto || rawDataSource.historical_eto, radiation: rawDataSource.radiation,
				minT: rawDataSource.minT, maxT: rawDataSource.maxT, minH: rawDataSource.minH,
				maxH: rawDataSource.maxH, wind: rawDataSource.wind, p: rawDataSource.p
			});
			if (rawDataSource.crop_coefficient) legacyData.rawData.kc = rawDataSource.crop_coefficient;
			if (rawDataSource.method && rawDataSource.method.includes('forecast')) {
				legacyData.rawData.forecast = 1;
				if (rawDataSource.forecast_precip_total) legacyData.rawData.fp = rawDataSource.forecast_precip_total;
			}
		} else if (adjustmentMethod === ZimmermanAdjustmentMethod) {
			Object.assign(legacyData.rawData, {
				h: rawDataSource.h, p: rawDataSource.p, t: rawDataSource.t, raining: rawDataSource.raining
			});
		} else if (adjustmentMethod === WaterBudgetAdjustmentMethod) {
			Object.assign(legacyData.rawData, {
				eto: rawDataSource.eto, etc: rawDataSource.etc, p: rawDataSource.p,
				bank: rawDataSource.bank, reason: rawDataSource.reason
			});
			if ( rawDataSource.kcSource !== undefined ) {
				legacyData.rawData.kc = rawDataSource.kc;
				legacyData.rawData.kcSource = rawDataSource.kcSource;
			}
			for ( const k of [ "budgetKcApplied", "budgetKcRequested", "budgetKcLockedForToday", "budgetMaxScale", "budgetMaxScaleApplied" ] ) {
				if ( rawDataSource[ k ] !== undefined ) legacyData.rawData[ k ] = rawDataSource[ k ];
			}
		}
		// Universal passthrough for cross-cutting weather-skip metadata (applies to ALL methods).
		if ( rawDataSource.skip ) {
			legacyData.rawData.skip = rawDataSource.skip;
			if ( rawDataSource.skipReason !== undefined ) {
				legacyData.rawData.skipReason = rawDataSource.skipReason;
			}
		}
		// Universal passthrough for cross-cutting fallback metadata (applies to ALL methods).
		if ( rawDataSource.pwsBypassed ) {
			legacyData.rawData.pwsBypassed = rawDataSource.pwsBypassed;
			if ( rawDataSource.pwsBypassReason !== undefined ) {
				legacyData.rawData.pwsBypassReason = rawDataSource.pwsBypassReason;
			}
		}
		// Keep rawData within the firmware's findKeyVal buffer: TMP_BUFFER_SIZE is 320, so the rawData
		// value must stay < 319 bytes or getweather_callback (weather.cpp) silently drops the whole
		// field. Trim the verbose optional strings (least-essential first) until it fits; keep flags.
		for ( const trimKey of [ "skipReason", "pwsBypassReason", "reason" ] ) {
			if ( JSON.stringify( legacyData.rawData ).length < 300 ) break;
			if ( legacyData.rawData[ trimKey ] !== undefined ) delete legacyData.rawData[ trimKey ];
		}
	} else {
		debugLog("DEBUG convertToLegacyFormat: enhancedData.rawData is missing.");
	}
	// Top-level restriction flag so the firmware can label/notify it (wt_restricted), in addition to scale=0.
	if ( enhancedData.restricted ) legacyData.restricted = enhancedData.restricted;
	debugLog("DEBUG convertToLegacyFormat: Legacy format conversion complete. Output:", JSON.stringify(legacyData));
	return legacyData;
}

// Helper function to generate a very basic, safe response object
function getSafeTestResponseObject(remoteIp: string = "1.2.3.4", requestTimezoneMinutes?: number): any {
    const testCoordinates: GeoCoordinates = [40.7128, -74.0060]; 
    const sunData = SunCalc.getTimes(new Date(), testCoordinates[0], testCoordinates[1]);
    
    let tzForOS: number;
    let sunriseMinutes: number;
    let sunsetMinutes: number;

    if (requestTimezoneMinutes !== undefined) {
        tzForOS = getTimezone(requestTimezoneMinutes, false); 
        const sunriseWithOffset = new Date(sunData.sunrise.getTime() + requestTimezoneMinutes * 60000);
        const sunsetWithOffset = new Date(sunData.sunset.getTime() + requestTimezoneMinutes * 60000);
        sunriseMinutes = sunriseWithOffset.getUTCHours() * 60 + sunriseWithOffset.getUTCMinutes();
        sunsetMinutes = sunsetWithOffset.getUTCHours() * 60 + sunsetWithOffset.getUTCMinutes();
    } else {
        const fallbackTimezoneOffsetMinutes = moment().tz(geoTZ(testCoordinates[0], testCoordinates[1])[0]).utcOffset();
        tzForOS = getTimezone(fallbackTimezoneOffsetMinutes, false);
        const sunriseWithFallbackOffset = new Date(sunData.sunrise.getTime() + fallbackTimezoneOffsetMinutes * 60000);
        const sunsetWithFallbackOffset = new Date(sunData.sunset.getTime() + fallbackTimezoneOffsetMinutes * 60000);
        sunriseMinutes = sunriseWithFallbackOffset.getUTCHours() * 60 + sunriseWithFallbackOffset.getUTCMinutes();
        sunsetMinutes = sunsetWithFallbackOffset.getUTCHours() * 60 + sunsetWithFallbackOffset.getUTCMinutes();
    }

    return {
        scale: 100,
        rd: 0,
        tz: tzForOS,
        sunrise: sunriseMinutes,
        sunset: sunsetMinutes,
        eip: ipToInt(remoteIp),
        rawData: { wp: "SafeTest", source: "HardcodedTestData" },
        errCode: 0
    };
}

export async function resolveCoordinates( location: string ): Promise< GeoCoordinates > {
	if ( !location ) throw new CodedError( ErrorCode.InvalidLocationFormat );
	if ( filters.pws.test( location ) ) throw new CodedError( ErrorCode.InvalidLocationFormat );
	if ( filters.gps.test( location ) ) {
		const split: string[] = location.split( "," );
		return [ parseFloat( split[ 0 ] ), parseFloat( split[ 1 ] ) ];
	}
	return geocoder().getLocation( location );
}

export async function httpJSONRequest(url: string, headers?: any, body?: any, timeoutMs?: number): Promise< any > {
	const data: string = await httpRequest(url, headers, body, timeoutMs);
	return JSON.parse(data);
}

function getTimeDataForCoordinates( coordinates: GeoCoordinates ): TimeData {
	const timezoneOffsetMinutes = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ] ).utcOffset();
	const sunData = SunCalc.getTimes( new Date(), coordinates[ 0 ], coordinates[ 1 ] );
	const sunrise = new Date(sunData.sunrise.getTime() + timezoneOffsetMinutes * 60000);
    const sunset = new Date(sunData.sunset.getTime() + timezoneOffsetMinutes * 60000);

	return {
		timezone:	timezoneOffsetMinutes,
		sunrise:	( sunrise.getUTCHours() * 60 + sunrise.getUTCMinutes() ),
		sunset:		( sunset.getUTCHours() * 60 + sunset.getUTCMinutes() )
	};
}

/**
 * Bundles the OS-encoded time fields the legacy watering response carries (tz, sunrise, sunset, eip)
 * so the /v1 watering endpoint can emit them as an ADDITIVE superset. Encoding matches the legacy
 * path exactly: tz via getTimezone(offsetMinutes), sunrise/sunset in local minutes, eip from the
 * caller's IP. Consumed by the OpenSprinkler-Firmware /v1 adapter (weather.cpp parseV1Weather).
 */
export interface OsTimeFields { tz: number; sunrise: number; sunset: number; eip: number; }
export function getOsTimeFields( coordinates: GeoCoordinates, remoteIp: string ): OsTimeFields {
	const td: TimeData = getTimeDataForCoordinates( coordinates );
	return {
		tz: getTimezone( td.timezone, false ),
		sunrise: td.sunrise,
		sunset: td.sunset,
		eip: ipToInt( remoteIp || "" )
	};
}

const METHOD_NAMES: { [ id: number ]: string } = {
	0: "manual", 1: "zimmerman", 2: "rainDelay", 3: "eto", 4: "waterBudget"
};

/**
 * Build the PWS object from adjustment options, with the exact validation the legacy handlers used:
 * provider "WU" + pws + key requires alphanumeric pws id and 32-hex key (throws InvalidPwsId /
 * InvalidPwsApiKey otherwise); a bare key becomes a provider API key; otherwise undefined.
 */
export function buildPwsFromParams( adjustmentOptions: AdjustmentOptions ): PWS | undefined {
	if ( adjustmentOptions.provider === "WU" && adjustmentOptions.pws && adjustmentOptions.key ) {
		const idMatch = adjustmentOptions.pws.match( /^[a-zA-Z\d]+$/ );
		const pwsId = idMatch ? idMatch[ 0 ] : undefined;
		const keyMatch = adjustmentOptions.key.match( /^[a-f\d]{32}$/ );
		const apiKey = keyMatch ? keyMatch[ 0 ] : undefined;
		if ( !pwsId ) throw new CodedError( ErrorCode.InvalidPwsId );
		if ( !apiKey ) throw new CodedError( ErrorCode.InvalidPwsApiKey );
		return { id: pwsId, apiKey: apiKey };
	} else if ( adjustmentOptions.key ) {
		return { apiKey: adjustmentOptions.key };
	}
	return undefined;
}

export interface WateringDecisionInput {
	coordinates: GeoCoordinates;
	adjustmentParam: number;
	adjustmentOptions: AdjustmentOptions;
	pws: PWS | undefined;
}

export interface WateringDecision {
	coordinates: GeoCoordinates;
	methodId: number;
	methodName: string;
	scale: number | undefined;
	rainDelay: number | undefined;
	rawData: any;
	weatherProvider: string;
	skip: boolean;
	skipReason?: string;
	servedFallback: boolean;
	pwsBypassed: boolean;
	restricted: boolean;
}

/**
 * Shared watering-decision core used by both the legacy handler and /v1. Resolves the provider,
 * uses the WateringScaleCache, runs the adjustment method, applies the restriction + fallback
 * metadata + cache-store rules, and the live skip overlay — identically to the legacy path.
 * Throws CodedError on invalid method / calculation / restriction-fetch failure.
 */
export async function computeWateringDecision( input: WateringDecisionInput ): Promise< WateringDecision > {
	const { coordinates, adjustmentParam, adjustmentOptions, pws } = input;
	const methodId = adjustmentParam & ~( 1 << 7 );
	const adjustmentMethod: AdjustmentMethod = resolveLegacyAdjustmentMethod( adjustmentParam );
	if ( !adjustmentMethod ) throw new CodedError( ErrorCode.InvalidAdjustmentMethod );
	const checkRestrictions: boolean = ( ( adjustmentParam >> 7 ) & 1 ) > 0;

	const weatherProvider: WeatherProvider = resolveWeatherProvider( adjustmentOptions, pws );

	let decision: { scale: number | undefined; rd: number | undefined; rawData: any } =
		{ scale: undefined, rd: undefined, rawData: undefined };

	let cachedScale: CachedScale | undefined;
	if ( weatherProvider.shouldCacheWateringScale() ) {
		cachedScale = cache.getWateringScale( adjustmentParam, coordinates, pws, adjustmentOptions );
	}

	if ( cachedScale ) {
		decision.scale = cachedScale.scale;
		decision.rawData = cachedScale.rawData;
		decision.rd = cachedScale.rainDelay;
	} else {
		const adjustmentMethodResponse: AdjustmentMethodResponse = await adjustmentMethod.calculateWateringScale(
			adjustmentOptions, coordinates, weatherProvider, pws
		);
		decision.scale = adjustmentMethodResponse.scale;
		decision.rd = adjustmentMethodResponse.rainDelay;
		decision.rawData = adjustmentMethodResponse.rawData;

		if ( ( weatherProvider as any ).pwsBypassed && decision.rawData ) {
			decision.rawData = {
				...decision.rawData,
				pwsBypassed: 1,
				pwsBypassReason: ( weatherProvider as any ).pwsBypassReason
			};
		}
		if ( weatherProvider.shouldCacheWateringScale() && !( weatherProvider as any ).servedFallback ) {
			cache.storeWateringScale( adjustmentParam, coordinates, pws, adjustmentOptions,
				{ scale: decision.scale, rawData: decision.rawData, rainDelay: decision.rd } );
		}
	}

	decision = await applyWeatherSkips( decision, weatherProvider, coordinates, pws, adjustmentOptions, undefined, checkRestrictions );

	const rawData = decision.rawData || {};
	return {
		coordinates,
		methodId,
		methodName: METHOD_NAMES[ methodId ] || String( methodId ),
		scale: decision.scale,
		rainDelay: decision.rd,
		rawData: decision.rawData,
		weatherProvider: rawData.wp || adjustmentOptions.provider || "",
		skip: !!rawData.skip,
		skipReason: rawData.skipReason,
		servedFallback: !!( weatherProvider as any ).servedFallback,
		pwsBypassed: !!( weatherProvider as any ).pwsBypassed,
		// The restriction bit (bit 7) is unified with the rain skip: "restricted" = the controller
		// asked for the restriction AND a skip actually fired. Lets the firmware label/notify it.
		restricted: checkRestrictions && !!rawData.skip
	};
}

export const getWeatherData = async function( req: express.Request, res: express.Response ) {
	debugLog(`DEBUG getWeatherData: START - Path: ${req.path}, Query: ${JSON.stringify(redactLogValue(req.query))}`);
	
	const location: string = getParameter(req.query.loc);
	let adjustmentOptionsString: string	= getParameter(req.query.wto),
		adjustmentOptions: AdjustmentOptions;

	debugLog(`DEBUG getWeatherData: Raw location: "${location}", Raw adjustmentOptionsString: "${redactLogValue(adjustmentOptionsString)}"`);

	try {
		adjustmentOptionsString = decodeURIComponent( adjustmentOptionsString.replace( /\\x/g, "%" ) );
		adjustmentOptions = JSON.parse( "{" + adjustmentOptionsString + "}" );
		debugLog(`DEBUG getWeatherData: Parsed adjustmentOptions: ${JSON.stringify(redactLogValue(adjustmentOptions))}`);
	} catch ( err ) {
		console.error(`DEBUG getWeatherData: Failed to parse adjustmentOptions:`, redactLogValue(err));
		sendWeatherDataError( res, new CodedError( ErrorCode.MalformedAdjustmentOptions ) );
		return;
	}

	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err: any) {
		console.error(`DEBUG getWeatherData: Failed to resolve coordinates:`, redactLogValue(err));
		sendWeatherDataError( res, err );
		return;
	}

	let pws: PWS | undefined;
	try {
		pws = buildPwsFromParams( adjustmentOptions );
	} catch ( err ) {
		sendWeatherDataError( res, err );
		return;
	}

	let activeWeatherProvider: WeatherProvider;
	try {
		// Display forecasts honor the explicitly requested provider even when the service runs in
		// local/hybrid mode (WEATHER_PROVIDER=local): the local PWS stream feeds watering
		// adjustments but has no forecast, so forcing it here would blank the App's Weather tab.
		// Watering adjustments (/weatherAdjustment) keep the unmodified resolution.
		const requested = typeof adjustmentOptions.provider === "string"
			? weatherProviders()[ adjustmentOptions.provider ] : undefined;
		activeWeatherProvider = requested ?? resolveWeatherProvider( adjustmentOptions, pws );
	} catch ( err ) {
		sendWeatherDataError( res, err );
		return;
	}
	debugLog(`DEBUG getWeatherData: Using provider: ${activeWeatherProvider.constructor.name}`);
	
	const timeData: TimeData = getTimeDataForCoordinates( coordinates );
	let weatherData: WeatherData;
	try {
		weatherData = await activeWeatherProvider.getWeatherData( coordinates, pws );
		debugLog(`DEBUG getWeatherData: ${activeWeatherProvider.constructor.name}.getWeatherData responded with: ${JSON.stringify(weatherData)}`);
	} catch ( err: any ) {
		console.error(`DEBUG getWeatherData: ${activeWeatherProvider.constructor.name}.getWeatherData failed:`, redactLogValue(err));
		sendWeatherDataError( res, err );
		return;
	}

	for ( const day of weatherData.forecast || [] ) {
		if ( Number.isFinite( day.temp_min ) && Number.isFinite( day.temp_max ) && Number.isFinite( day.date ) ) {
			day.eto = calculateHargreavesSamaniETo( day.temp_max, day.temp_min, coordinates, day.date );
		}
	}
	weatherData.generatedAt = Math.floor( Date.now() / 1000 );
	
	const response = { ...timeData, ...weatherData, location: coordinates };
	debugLog(`DEBUG getWeatherData: Final response for /weather endpoint: ${JSON.stringify(response)}`);
	res.json( response );
	debugLog(`DEBUG getWeatherData: END - Response sent.`);
};

function weatherDataErrorStatus( errCode: ErrorCode ): number {
	switch ( errCode ) {
		case ErrorCode.InvalidLocationFormat:
		case ErrorCode.NoLocationFound:
		case ErrorCode.InvalidPwsId:
		case ErrorCode.InvalidPwsApiKey:
		case ErrorCode.NoPwsProvided:
		case ErrorCode.NoAPIKeyProvided:
		case ErrorCode.MalformedAdjustmentOptions:
		case ErrorCode.MissingAdjustmentOption:
		case ErrorCode.InvalidAdjustmentMethod:
			return 400;
		case ErrorCode.UnsupportedAdjustmentMethod:
		case ErrorCode.PwsNotSupported:
			return 422;
		case ErrorCode.UnexpectedError:
			return 500;
		default:
			return 502;
	}
}

const WEATHER_DATA_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
	[ ErrorCode.BadWeatherData ]: "Weather data was invalid.",
	[ ErrorCode.InsufficientWeatherData ]: "Insufficient weather data was available.",
	[ ErrorCode.MissingWeatherField ]: "The weather response was incomplete.",
	[ ErrorCode.WeatherApiError ]: "The weather provider request failed.",
	[ ErrorCode.LocationServiceApiError ]: "The location service request failed.",
	[ ErrorCode.NoLocationFound ]: "No matching location was found.",
	[ ErrorCode.InvalidLocationFormat ]: "The location format is invalid.",
	[ ErrorCode.InvalidPwsId ]: "The PWS ID is invalid.",
	[ ErrorCode.InvalidPwsApiKey ]: "The PWS API key is invalid.",
	[ ErrorCode.PwsAuthenticationError ]: "The PWS request was not authorized.",
	[ ErrorCode.PwsNotSupported ]: "The PWS does not support this request.",
	[ ErrorCode.NoPwsProvided ]: "A PWS is required for this provider.",
	[ ErrorCode.NoAPIKeyProvided ]: "An API key is required for this provider.",
	[ ErrorCode.UnsupportedAdjustmentMethod ]: "The requested method is not supported.",
	[ ErrorCode.InvalidAdjustmentMethod ]: "The requested method is invalid.",
	[ ErrorCode.MalformedAdjustmentOptions ]: "The weather options are malformed.",
	[ ErrorCode.MissingAdjustmentOption ]: "A required weather option is missing.",
	[ ErrorCode.UnexpectedError ]: "An unexpected weather service error occurred."
};

/** Send the additive JSON error contract used only by /weatherData. */
export function sendWeatherDataError( res: express.Response, err: any ): void {
	const coded = makeCodedError( err );
	const message = coded.message
		? redactLogString( coded.message )
		: WEATHER_DATA_ERROR_MESSAGES[ coded.errCode ] || "The weather request failed.";
	res.status( weatherDataErrorStatus( coded.errCode ) ).json( { error: coded.errCode, message } );
}

export const getWateringData = async function( req: express.Request, res: express.Response ) {
	debugLog(`DEBUG getWateringData: START - Path: ${req.path}, Query: ${JSON.stringify(redactLogValue(req.query))}, Params: ${JSON.stringify(redactLogValue(req.params))}`);
	const isLegacyRequest = isLegacyFirmwareRequest(req);
	const adjustmentParam = parseInt(req.params[0], 10);

	if (isNaN(adjustmentParam)) {
		sendWateringError(res, new CodedError(ErrorCode.InvalidAdjustmentMethod), undefined, isLegacyRequest);
		return;
	}

	let adjustmentMethod: AdjustmentMethod = resolveLegacyAdjustmentMethod( adjustmentParam );
	let checkRestrictions: boolean = ( ( adjustmentParam >> 7 ) & 1 ) > 0;
	let adjustmentOptionsString: string = getParameter(req.query.wto);
	let location: string = getParameter(req.query.loc);
	let outputFormat: string = getParameter(req.query.format);
	let remoteAddress: string = getParameter(req.headers[ "x-forwarded-for" ]) || req.connection.remoteAddress || "";
	remoteAddress = remoteAddress.split( "," )[ 0 ].trim();
	if (remoteAddress === "::1" || remoteAddress === "127.0.0.1" || remoteAddress === "") remoteAddress = "1.2.3.4";

	let adjustmentOptions: AdjustmentOptions;

	if ( !adjustmentMethod ) {
		sendWateringError( res, new CodedError( ErrorCode.InvalidAdjustmentMethod ), undefined, isLegacyRequest);
		return;
	}

	try {
		adjustmentOptionsString = decodeURIComponent( adjustmentOptionsString.replace( /\\x/g, "%" ) );
		adjustmentOptions = JSON.parse( "{" + adjustmentOptionsString + "}" );
	} catch ( err ) {
		sendWateringError( res, new CodedError( ErrorCode.MalformedAdjustmentOptions ), adjustmentMethod !== ManualAdjustmentMethod, isLegacyRequest );
		return;
	}

	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch ( err ) {
		sendWateringError( res, makeCodedError( err ), adjustmentMethod !== ManualAdjustmentMethod, isLegacyRequest );
		return;
	}

	let timeData: TimeData = getTimeDataForCoordinates( coordinates ); 

	let pws: PWS | undefined;
	try {
		pws = buildPwsFromParams( adjustmentOptions );
	} catch ( err ) {
		sendWateringError( res, makeCodedError( err ), adjustmentMethod !== ManualAdjustmentMethod, isLegacyRequest );
		return;
	}

	let decision: WateringDecision;
	try {
		decision = await computeWateringDecision( { coordinates, adjustmentParam, adjustmentOptions, pws } );
	} catch ( err ) {
		sendWateringError( res, makeCodedError( err ), adjustmentMethod !== ManualAdjustmentMethod, isLegacyRequest, outputFormat === "json" );
		return;
	}

	// Multi-day rolling averages (firmware wto.mda): record today's computed scale for this
	// location regardless of the toggle (history warms before the user enables the feature),
	// and emit the scales array only when the controller's weather options request it.
	let multiDayScales: number[] | undefined;
	if ( typeof decision.scale === "number" ) {
		const rolling = recordDailyScale( coordinates, timeData.timezone, decision.scale );
		if ( ( adjustmentOptions as any ).mda && rolling.length > 0 ) multiDayScales = rolling;
	}

	let dataToSend: any = {
		scale: decision.scale,
		rd: decision.rainDelay,
		tz: getTimezone( timeData.timezone, false ),
		sunrise: timeData.sunrise,
		sunset: timeData.sunset,
		eip: ipToInt( remoteAddress ),
		rawData: decision.rawData,
		scales: multiDayScales,
		restricted: decision.restricted ? 1 : undefined,
		errCode: 0
	};
	
    debugLog(`DEBUG getWateringData: Data before legacy conversion (dataToSend): ${JSON.stringify(dataToSend)}`);
	let responseData = dataToSend;
	if ( isLegacyRequest ) {
        debugLog(`DEBUG getWateringData: Applying legacy format conversion because isLegacyRequest is true.`);
		responseData = convertToLegacyFormat( dataToSend, adjustmentMethod );
	} else {
        debugLog(`DEBUG getWateringData: Not applying legacy format conversion because isLegacyRequest is false.`);
    }

	debugLog(`DEBUG getWateringData: Final responseData to be sent: ${JSON.stringify(responseData)}`);
	debugLog(`DEBUG getWateringData: Sending response - Scale: ${responseData.scale}, Method: ${adjustmentMethod?.constructor?.name || "N/A"}, Legacy: ${isLegacyRequest}, OutputFormat: ${outputFormat === "json" ? "JSON" : "QueryString"}`);
	sendWateringData( res, responseData, outputFormat === "json" );
	debugLog(`DEBUG getWateringData: END - Response sent.`);
};

function sendWateringError( res: express.Response, error: CodedError, resetScale: boolean = true, isLegacyRequest: boolean = false, useJson: boolean = false ) {
	console.error(`DEBUG sendWateringError: Error Code: ${error.errCode}, Message: ${redactLogValue(error.message)}, ResetScale: ${resetScale}, IsLegacy: ${isLegacyRequest}, UseJSON: ${useJson}`);
	if ( error.errCode === ErrorCode.UnexpectedError ) console.error( `An unexpected error occurred:`, redactLogValue(error) );

	let errorData: any = { errCode: error.errCode };
    if (resetScale) errorData.scale = 100;
	
	if ( isLegacyRequest && SIMPLIFIED_RESPONSE_FORMAT ) {
		const legacyErrorData: any = { scale: resetScale ? 100 : undefined, errCode: error.errCode };
		debugLog(`DEBUG sendWateringError: Applied legacy format to error response: ${JSON.stringify(legacyErrorData)}`);
        sendWateringData( res, legacyErrorData, useJson );
        return;
	}
	sendWateringData( res, errorData, useJson );
}

function sendWateringData( res: express.Response, data: object, useJson: boolean = false ) {
	if ( useJson ) {
		debugLog(`DEBUG sendWateringData: Sending JSON response: ${JSON.stringify(data)}`);
		res.json( data );
	} else {
		const formatted = formatLegacyWateringData( data );
		debugLog(`DEBUG sendWateringData: Sending QueryString response: "${formatted}"`);
		res.send( formatted );
	}
}

/** Maximum encoded rawData value size accepted by firmware findKeyVal. */
export const LEGACY_RAWDATA_LIMIT = 319;

/** Format the exact flat response consumed by the legacy firmware weather callback. */
export function formatLegacyWateringData( data: object ): string {
	let formatted = "";
	for ( const key in data ) {
		if ( !Object.prototype.hasOwnProperty.call( data, key ) ) continue;
		const value = encodeLegacyWateringValue( ( data as any )[ key ] );
		if ( typeof value === "undefined" ) continue;
		formatted += `&${ key }=${ value }`;
	}
	return formatted;
}

/**
 * Encodes one value for the fixed OpenSprinkler legacy firmware wire format.
 * The firmware decodes this custom scheme: space -> "+", newline -> "\n", and
 * "&" -> "AMPERSAND". Do not use URLSearchParams or encodeURIComponent here;
 * standard URL encoding changes the on-the-wire bytes and breaks legacy parsers.
 */
function encodeLegacyWateringValue( value: any ): string | undefined {
	switch ( typeof value ) {
		case "undefined":
			return undefined;
		case "object": {
			const jsonValue = JSON.stringify( value );
			return String( jsonValue ).replace( / /g, "+" ).replace( /\n/g, "\\n" ).replace( /&/g, "AMPERSAND" );
		}
		case "string":
			return String( value ).replace( / /g, "+" ).replace( /\n/g, "\\n" ).replace( /&/g, "AMPERSAND" );
		default:
			return String( value );
	}
}

async function httpRequest( url: string, headers?: any, body?: any, timeoutMs?: number ): Promise< string > {
	return new Promise< string >( ( resolve, reject ) => {
		const urlMatch = url.match( filters.url );
		if (!urlMatch) return reject(new Error(`Invalid URL format: ${redactLogString(url)}`));
		// Per-call override (e.g. the OpenMeteo forecast fetch passes a tight bound so a slow upstream
		// fails fast and falls back, well inside the firmware's 5s read deadline) > env default > 10s.
		const configuredTimeoutMs = Number(process.env.HTTP_REQUEST_TIMEOUT_MS);
		const requestTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs! > 0
			? timeoutMs!
			: Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 10000;
		
		const isHttps = url.startsWith("https");
		const options: https.RequestOptions = {
			hostname: urlMatch[1],
			port: parseInt(urlMatch[2]?.substring(1)) || (isHttps ? 443 : 80),
			path: urlMatch[3],
			method: body ? 'POST' : 'GET',
			headers: headers || {}
		};
		if (body) {
			options.headers!['Content-Type'] = 'application/json';
			options.headers!['Content-Length'] = Buffer.byteLength(body);
		}

		const req = (isHttps ? https : http).request(options, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				return reject(new Error(`Received ${res.statusCode} status code for URL '${redactLogString(url)}'.`));
			}
			let responseData = "";
			res.setEncoding('utf8');
			res.on("data", (chunk) => { responseData += chunk; });
			res.on("end", () => { resolve(responseData); });
		});
		req.setTimeout(requestTimeoutMs, () => {
			req.destroy(new Error(`HTTP request timed out after ${requestTimeoutMs} ms for URL '${redactLogString(url)}'.`));
		});
		req.on("error", (err) => { reject(err); });
		if (body) req.write(body);
		req.end();
	});
}

export function validateValues( keys: string[], obj: any ): boolean {
   if ( !obj ) return false;
   for ( const key of keys ) { 
   	if ( !obj.hasOwnProperty( key ) || typeof obj[key] !== "number" || isNaN(obj[key]) || obj[key] === null || obj[key] === -999 ) {
   		return false;
   	}
   }
   return true;
}

function getTimezone( time: number | string, useMinutes: boolean = false ): number {
   let hour: number;
   let minute: number;

   if ( typeof time === "number" ) {
       if (useMinutes) {
           return time;
       }
       hour = Math.floor( time / 60 );
       minute = Math.abs(time % 60);
   } else {
       const splitTime = time.match( filters.time ) || time.match( filters.timezone );
       if (!splitTime || !splitTime[7] || !splitTime[8] || !splitTime[9]) {
           console.error("getTimezone: Invalid time string format or missing parts", time);
           return 0;
       }
       const signChar = splitTime[7];
       const hourStr = splitTime[8];
       const minuteStr = splitTime[9];
       hour = parseInt(hourStr);
       minute = parseInt(minuteStr);
       if (signChar === '-') {
           hour = -hour;
       }
       if (useMinutes) {
           return (hour * 60) + (signChar === '-' ? -minute : minute);
       }
   }
   const osMinutePart = (minute / 15 >> 0) / 4;
   hour = hour + ( hour >= 0 ? osMinutePart : -osMinutePart );
   return ( ( hour + 12 ) * 4 ) >> 0;
}

function ipToInt( ip: string ): number {
   const split = ip.split( "." );
   if (split.length !== 4 || split.some(part => isNaN(parseInt(part)) || parseInt(part) < 0 || parseInt(part) > 255)) {
	   console.error("ipToInt: Invalid IP address format", ip);
	   return 0;
   }
   return ((((+split[0]) * 256 + (+split[1])) * 256 + (+split[2])) * 256) + (+split[3]);
}

export function getParameter(param: string | ParsedQs | (string | ParsedQs)[] | undefined): string {
    if (param === undefined) {
        return "";
    }
    if (typeof param === 'string') {
        return param;
    }
    if (Array.isArray(param)) {
        if (param.length === 0) {
            return "";
        }
        const firstEl = param[0];
        if (typeof firstEl === 'string') {
            return firstEl;
        }
        if (typeof firstEl === 'object' && firstEl !== null) {
            const keys = Object.keys(firstEl);
            if (keys.length > 0) {
                const valOfFirstKeyInElement = firstEl[keys[0]];
                if (typeof valOfFirstKeyInElement === 'string') {
                    return valOfFirstKeyInElement;
                }
                if (Array.isArray(valOfFirstKeyInElement) && valOfFirstKeyInElement.length > 0 && typeof valOfFirstKeyInElement[0] === 'string') {
                    return valOfFirstKeyInElement[0];
                }
            }
        }
        return "";
    }
    if (typeof param === 'object' && param !== null) {
        const keys = Object.keys(param);
        if (keys.length > 0) {
            const valOfFirstKey = param[keys[0]];
            if (typeof valOfFirstKey === 'string') {
                return valOfFirstKey;
            }
            if (Array.isArray(valOfFirstKey) && valOfFirstKey.length > 0 && typeof valOfFirstKey[0] === 'string') {
                return valOfFirstKey[0];
            }
        }
    }
    return "";
}

export function keyToUse( defaultKey: string, pws: PWS | undefined ): string {
   if(pws && pws.apiKey){
   	return pws.apiKey;
   }else if(defaultKey){
   	return defaultKey;
   }else{
   	throw new CodedError( ErrorCode.NoAPIKeyProvided );
   }
}
