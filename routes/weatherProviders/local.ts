import * as express from "express";
import moment from "moment";
import * as fs from "fs";

import { GeoCoordinates, WeatherData, ZimmermanWateringData, PWS } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { normalizeWeatherData } from "./normalizeWeatherData";
import { EToData, approximateSolarRadiation, CloudCoverInfo } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import { debugLog, httpJSONRequest } from "../weather";
import ForecastCache from "./ForecastCache";

/**
 * Bound the OpenMeteo forecast fetch well inside the firmware's 5s read deadline so a slow upstream
 * fails fast and falls back instead of stalling the device request (→ wterr=-4). Tunable via env.
 */
const FORECAST_FETCH_TIMEOUT_MS = Number( process.env.FORECAST_TIMEOUT_MS ) || 2500;
/** Cache the forecast off the hot path; serve stale-if-error on a refresh failure. */
const forecastCache = new ForecastCache< ForecastEToData[] >(
	Number( process.env.FORECAST_CACHE_FRESH_MS ) || 3 * 60 * 60 * 1000,
	Number( process.env.FORECAST_CACHE_STALE_MS ) || 6 * 60 * 60 * 1000,
);

// Constants
const ONE_DAY_SECONDS = 24 * 60 * 60;
const TWENTY_THREE_HOURS_SECONDS = 23 * 60 * 60;

// Module-level variables
var queue: Array<Observation> = [],
	lastRainEpoch = 0,
	lastRainCount: number;

let warnedUnauthenticatedLocalPws = false;

// Enhanced interfaces for forecast capability
export interface ForecastCapabilities {
    temperature: boolean;
    humidity: boolean;
    windSpeed: boolean;
    solarRadiation: boolean;
    cloudCover: boolean;
    precipitation: boolean;
}

export interface ForecastEToData extends EToData {
    confidence: 'high' | 'medium' | 'low';
    estimatedFields: string[];
}

export abstract class EnhancedWeatherProvider extends WeatherProvider {
    abstract getForecastCapabilities(): ForecastCapabilities;
    abstract getForecastData?(coordinates: GeoCoordinates, days: number, pws?: PWS): Promise<ForecastEToData[]>;
    abstract supportsForecasting(): boolean; // ADD THIS ABSTRACT METHOD
    
    getBestForecastMethod(forecastData: ForecastEToData[]): 'full' | 'hybrid' | 'precip' | 'none' {
        if (!forecastData || forecastData.length === 0) return 'none';
        
        const firstDay = forecastData[0];
        const hasAllEToParams = firstDay.minTemp !== undefined && 
                               firstDay.maxTemp !== undefined &&
                               firstDay.minHumidity !== undefined && 
                               firstDay.maxHumidity !== undefined &&
                               firstDay.windSpeed !== undefined && 
                               firstDay.solarRadiation !== undefined;
        
        if (hasAllEToParams && firstDay.confidence === 'high') return 'full';
        if (hasAllEToParams && firstDay.confidence === 'medium') return 'hybrid';
        if (firstDay.precip !== undefined) return 'precip';
        return 'none';
    }
}

const measurementRanges: { [key: string]: { min?: number, max?: number } } = {
	tempf: { min: -100, max: 160 },
	humidity: { min: 0, max: 100 },
	windspeedmph: { min: 0, max: 250 },
	solarradiation: { min: 0, max: 1500 },
	dailyrainin: { min: 0 },
	rainin: { min: 0 },
};

function getAuthTokens(req: express.Request): string[] {
	const tokens: string[] = [];
	for (const key of ["key", "token"]) {
		const queryValue = req.query[key];
		const token = Array.isArray(queryValue) ? queryValue[0] : queryValue;
		if (typeof token === "string") tokens.push(token);
	}

	const authHeader = req.headers.authorization;
	if (authHeader) {
		const match = authHeader.match(/^Bearer\s+(.+)$/i);
		tokens.push(match ? match[1] : authHeader);
	}

	return tokens;
}

function isLocalPwsAuthenticated(req: express.Request): boolean {
	const expectedToken = process.env.LOCAL_PWS_TOKEN;
	if (!expectedToken) {
		if (!warnedUnauthenticatedLocalPws) {
			console.warn("LOCAL_PWS_TOKEN is not set; local PWS ingest is accepting unauthenticated writes.");
			warnedUnauthenticatedLocalPws = true;
		}
		return true;
	}
	return getAuthTokens(req).some(token => token === expectedToken);
}

function getMeasurement(req: express.Request, key: string): number {
	if (!(key in req.query)) return undefined;

	const rawValue = req.query[key];
	const rawScalar = Array.isArray(rawValue) ? rawValue[0] : rawValue;
	if (typeof rawScalar !== "string") return undefined;

	const rawString = rawScalar.trim();
	if (rawString === "") return undefined;

	const value = Number(rawString);
	if (value === -9999.0 || !Number.isFinite(value)) return undefined;

	const range = measurementRanges[key];
	if (range && ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max))) {
		return undefined;
	}

	return value;
}

export const captureWUStream = async function( req: express.Request, res: express.Response ) {
	if (!isLocalPwsAuthenticated(req)) {
		res.status(401).send("unauthorized\n");
		return;
	}

	let rainCount = getMeasurement(req, "dailyrainin");
	let solarRadiation = getMeasurement(req, "solarradiation");
	let rainRate = getMeasurement(req, "rainin");

	const obs: Observation = {
		timestamp: req.query.dateutc === "now" ? moment().unix() : moment( String(req.query.dateutc) + "Z" ).unix(),
		temp: getMeasurement(req, "tempf"),
		humidity: getMeasurement(req, "humidity"),
		windSpeed: getMeasurement(req, "windspeedmph"),
		solarRadiation: solarRadiation !== undefined ? solarRadiation * 24 / 1000 : undefined,	// Convert to kWh/m^2 per day
		precip: rainCount !== undefined && lastRainCount !== undefined ? (rainCount < lastRainCount ? rainCount : rainCount - lastRainCount) : undefined,
	};

	lastRainEpoch = rainRate > 0 ? obs.timestamp : lastRainEpoch;
	lastRainCount = rainCount !== undefined ? rainCount : lastRainCount;

	queue.unshift(obs);

	res.send( "success\n" );
};

export default class LocalWeatherProvider extends EnhancedWeatherProvider {
	private enableForecast: boolean;
	private forecastDays: number;

	constructor() {
		super();
		// Enable forecast by default, can be disabled via env var
		this.enableForecast = process.env.ENABLE_FORECAST !== 'false';
		this.forecastDays = parseInt(process.env.FORECAST_DAYS) || 3;
		
		if (this.enableForecast) {
			console.log(`Enhanced LocalWeatherProvider: Forecast integration enabled for ${this.forecastDays} days using OpenMeteo`);
		} else {
			console.log("Enhanced LocalWeatherProvider: Forecast integration disabled");
		}
	}

	private filterQueue(): void {
		const now = moment().unix();
		queue = queue.filter(obs => (now - obs.timestamp) < ONE_DAY_SECONDS);
	}

	public async getWeatherData(coordinates: GeoCoordinates): Promise<WeatherData> {
		this.filterQueue();
		debugLog("DEBUG: LocalWeatherProvider.getWeatherData CALLED. Queue length:", queue.length);

		if (queue.length === 0) {
			console.error("There is insufficient data to support Weather response from local PWS.");
			throw new CodedError(ErrorCode.InsufficientWeatherData, "No PWS data available in the queue for WeatherData response.");
		}

		const latestObs = queue[0];
		let accumulatedPrecip = 0;
		for (const obs of queue) {
			accumulatedPrecip += obs.precip || 0;
		}

		const weather: WeatherData = {
			weatherProvider: "local",
			temp: (latestObs.temp !== undefined && !isNaN(latestObs.temp)) ? Math.floor(latestObs.temp) : undefined,
			minTemp: undefined,
			maxTemp: undefined,
			humidity: (latestObs.humidity !== undefined && !isNaN(latestObs.humidity)) ? Math.floor(latestObs.humidity) : undefined,
			wind: (latestObs.windSpeed !== undefined && !isNaN(latestObs.windSpeed)) ? Math.floor(latestObs.windSpeed * 10) / 10 : undefined,
			precip: Math.floor(accumulatedPrecip * 100) / 100,
			description: "",
			icon: "01d",
			region: undefined,
			city: undefined,
			forecast: [],
			...( Number.isFinite( latestObs.timestamp ) ? { observedAt: latestObs.timestamp } : {} )
		};
		debugLog("DEBUG: LocalWeatherProvider.getWeatherData RETURNING result:", JSON.stringify(weather));
		return normalizeWeatherData( "local", weather );
	}

	public async getWateringData(coordinates: GeoCoordinates): Promise<ZimmermanWateringData> {
		this.filterQueue();
		debugLog("DEBUG: LocalWeatherProvider.getWateringData CALLED. Initial queue length:", queue.length);

		if (queue.length > 0) {
			const timeSpanSeconds = queue[0].timestamp - queue[queue.length - 1].timestamp;
			debugLog("DEBUG: Queue time span (seconds):", timeSpanSeconds, "Required (approx):", TWENTY_THREE_HOURS_SECONDS);
		}

		if (queue.length === 0 || (queue.length > 0 && (queue[0].timestamp - queue[queue.length - 1].timestamp < TWENTY_THREE_HOURS_SECONDS))) {
			console.error("DEBUG: LocalWeatherProvider - Insufficient data for Zimmerman. Queue length:", queue.length);
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Not enough PWS data or insufficient time span of data for Zimmerman calculation.");
		}

		let tempSum = 0;
		let humiditySum = 0;
		let precipSum = 0;
		let cTemp = 0;
		let cHumidity = 0;

		for (const obs of queue) {
			if (obs.temp !== undefined && !isNaN(obs.temp)) {
				tempSum += obs.temp;
				cTemp++;
			}
			if (obs.humidity !== undefined && !isNaN(obs.humidity)) {
				humiditySum += obs.humidity;
				cHumidity++;
			}
			if (obs.precip !== undefined && !isNaN(obs.precip)) {
				precipSum += obs.precip;
			}
		}

		debugLog("DEBUG: LocalWeatherProvider sums - tempSum:", tempSum, "humiditySum:", humiditySum, "precipSum:", precipSum);
		debugLog("DEBUG: LocalWeatherProvider counts - cTemp:", cTemp, "cHumidity:", cHumidity);

		if (cTemp === 0 || cHumidity === 0) {
			console.error("DEBUG: LocalWeatherProvider - cTemp or cHumidity is zero, cannot calculate average for Zimmerman.");
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Not enough valid temp/humidity readings in PWS data for Zimmerman calculation.");
		}

		const result: ZimmermanWateringData = {
			weatherProvider: "local",
			temp: tempSum / cTemp,
			humidity: humiditySum / cHumidity,
			precip: precipSum,
			raining: ((moment().unix() - lastRainEpoch) / 3600 < 1), // Check if last rain was within the hour
		};
		debugLog("DEBUG: LocalWeatherProvider.getWateringData RETURNING result:", JSON.stringify(result));
		return result;
	}

	public async getEToData(coordinates: GeoCoordinates): Promise<EToData> {
		this.filterQueue();
		debugLog("DEBUG: LocalWeatherProvider.getEToData CALLED. Queue length:", queue.length);

		if (queue.length > 0) {
			const timeSpanSeconds = queue[0].timestamp - queue[queue.length - 1].timestamp;
			debugLog("DEBUG: ETo Queue time span (seconds):", timeSpanSeconds, "Required (approx):", TWENTY_THREE_HOURS_SECONDS);
		}
		
		if (queue.length === 0 || (queue.length > 0 && (queue[0].timestamp - queue[queue.length - 1].timestamp < TWENTY_THREE_HOURS_SECONDS))) {
			console.error("DEBUG: LocalWeatherProvider - Insufficient data for ETo. Queue length:", queue.length);
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Not enough PWS data or insufficient time span of data for ETo calculation.");
		}

		let solarSum = 0;
		let windSum = 0;
		let precipSumForETo = 0;
		let cSolar = 0;
		let cWind = 0;

		let minTemp = Infinity, maxTemp = -Infinity;
		let minHumidity = Infinity, maxHumidity = -Infinity;

		for (const obs of queue) {
			if (obs.temp !== undefined && !isNaN(obs.temp)) {
				minTemp = Math.min(minTemp, obs.temp);
				maxTemp = Math.max(maxTemp, obs.temp);
			}
			if (obs.humidity !== undefined && !isNaN(obs.humidity)) {
				minHumidity = Math.min(minHumidity, obs.humidity);
				maxHumidity = Math.max(maxHumidity, obs.humidity);
			}
			if (obs.solarRadiation !== undefined && !isNaN(obs.solarRadiation)) {
				solarSum += obs.solarRadiation;
				cSolar++;
			}
			if (obs.windSpeed !== undefined && !isNaN(obs.windSpeed)) {
				windSum += obs.windSpeed;
				cWind++;
			}
			if (obs.precip !== undefined && !isNaN(obs.precip)) {
				precipSumForETo += obs.precip;
			}
		}
		
		debugLog("DEBUG: LocalWeatherProvider ETo counts - cSolar:", cSolar, "cWind:", cWind);
		debugLog("DEBUG: LocalWeatherProvider ETo sums - solarSum:", solarSum, "windSum:", windSum, "precipSumForETo:", precipSumForETo);
		debugLog("DEBUG: LocalWeatherProvider ETo min/max - minT:", minTemp, "maxT:", maxTemp, "minH:", minHumidity, "maxH:", maxHumidity);

		if (cSolar === 0) {
			console.error("DEBUG: LocalWeatherProvider (ETo) - cSolar is zero, cannot calculate average solar radiation.");
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Not enough valid solar radiation readings in PWS data for ETo.");
		}
		if (cWind === 0) {
			console.error("DEBUG: LocalWeatherProvider (ETo) - cWind is zero, cannot calculate average wind speed.");
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Not enough valid wind speed readings in PWS data for ETo.");
		}
		if (minTemp === Infinity || maxTemp === -Infinity || minHumidity === Infinity || maxHumidity === -Infinity) {
			console.error("DEBUG: LocalWeatherProvider (ETo) - Min/Max temp or humidity could not be determined.");
			throw new CodedError(ErrorCode.InsufficientWeatherData, "Min/max temperature or humidity could not be determined from PWS data for ETo.");
		}

		const result: EToData = {
			weatherProvider: "local",
			periodStartTime: Math.floor(queue[queue.length - 1].timestamp),
			minTemp: minTemp,
			maxTemp: maxTemp,
			minHumidity: minHumidity,
			maxHumidity: maxHumidity,
			solarRadiation: solarSum / cSolar, // This is average of daily kWh/m^2 values if obs.solarRadiation is daily
			windSpeed: windSum / cWind,
			precip: precipSumForETo,
		};
		debugLog("DEBUG: LocalWeatherProvider.getEToData RETURNING result:", JSON.stringify(result));
		return result;
	}

	// Enhanced forecast capabilities
	getForecastCapabilities(): ForecastCapabilities {
		return {
			temperature: true,
			humidity: true,
			windSpeed: true,
			solarRadiation: true,    // OpenMeteo provides comprehensive data
			cloudCover: true,
			precipitation: true
		};
	}

	// Get comprehensive forecast data from OpenMeteo
	async getForecastData(coordinates: GeoCoordinates, days: number = this.forecastDays): Promise<ForecastEToData[]> {
		if (!this.enableForecast) {
			debugLog("DEBUG: Forecast disabled, throwing error");
			throw new CodedError(ErrorCode.UnsupportedAdjustmentMethod, "Forecast integration disabled");
		}

		debugLog(`DEBUG: LocalWeatherProvider.getForecastData - Getting ${days} day forecast from OpenMeteo for coordinates:`, coordinates);

		// Hot path: a fresh cached forecast skips the upstream call entirely.
		const cacheKey = `${coordinates[0]},${coordinates[1]}#${days}`;
		const fresh = forecastCache.getFresh( cacheKey );
		if ( fresh ) {
			debugLog("DEBUG: forecast cache HIT (fresh) — no upstream fetch");
			return fresh;
		}

		const startedAt = Date.now();
		try {
			// Use OpenMeteo for detailed forecast with all ETo parameters
			const forecastUrl = `https://api.open-meteo.com/v1/forecast?` +
				`latitude=${coordinates[0]}&longitude=${coordinates[1]}&` +
				`daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&` +
				`hourly=relativehumidity_2m,direct_radiation,cloudcover&` +
				`temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&` +
				`forecast_days=${days}&timeformat=unixtime`;

			debugLog("DEBUG: Forecast URL:", forecastUrl);

			const forecastData = await httpJSONRequest(forecastUrl, undefined, undefined, FORECAST_FETCH_TIMEOUT_MS);
			debugLog("DEBUG: OpenMeteo forecast response keys:", Object.keys(forecastData));

			if (!forecastData.daily || !forecastData.hourly) {
				throw new Error("Missing daily or hourly data in OpenMeteo response");
			}

			const results: ForecastEToData[] = [];
			
			for (let day = 0; day < Math.min(days, forecastData.daily.time.length); day++) {
				// Calculate daily min/max humidity from hourly data (24 hours per day)
				const dayStart = day * 24;
				const dayEnd = Math.min((day + 1) * 24, forecastData.hourly.relativehumidity_2m.length);
				const dailyHumidity = forecastData.hourly.relativehumidity_2m.slice(dayStart, dayEnd);
				const dailyRadiation = forecastData.hourly.direct_radiation.slice(dayStart, dayEnd);
				const dailyCloudCover = forecastData.hourly.cloudcover.slice(dayStart, dayEnd);
				
				// Convert solar radiation from W/m² to kWh/m²/day
				const avgRadiation = dailyRadiation.reduce((sum: number, val: number) => sum + (val || 0), 0) / dailyRadiation.length;
				const solarRadiationKWh = avgRadiation * 24 / 1000; // Convert W/m² to kWh/m²/day
				
				// Filter out null/undefined humidity values
				const validHumidity = dailyHumidity.filter((h: number) => h !== null && h !== undefined);
				
				const etoData: ForecastEToData = {
					weatherProvider: "local", // Changed from "OpenMeteo-Forecast" to avoid type error
					periodStartTime: forecastData.daily.time[day],
					minTemp: forecastData.daily.temperature_2m_min[day],
					maxTemp: forecastData.daily.temperature_2m_max[day],
					minHumidity: validHumidity.length > 0 ? Math.min(...validHumidity) : 50, // Fallback to 50%
					maxHumidity: validHumidity.length > 0 ? Math.max(...validHumidity) : 80, // Fallback to 80%
					windSpeed: forecastData.daily.windspeed_10m_max[day],
					solarRadiation: solarRadiationKWh,
					precip: forecastData.daily.precipitation_sum[day] || 0,
					confidence: validHumidity.length > 0 ? 'high' : 'medium', // Lower confidence if using fallback humidity
					estimatedFields: validHumidity.length === 0 ? ['minHumidity', 'maxHumidity'] : [] // Mark if we used fallback values
				};
				
				debugLog(`DEBUG: Forecast day ${day + 1} ETo data:`, JSON.stringify(etoData));
				results.push(etoData);
			}
			
			forecastCache.set( cacheKey, results );
			debugLog(`DEBUG: forecast cache MISS — fetched ${results.length} days in ${Date.now() - startedAt}ms`);
			return results;

		} catch (err) {
			// Stale-if-error: a slightly-stale forecast is more accurate than dropping the forecast term.
			const stale = forecastCache.getStale( cacheKey );
			if ( stale ) {
				console.warn(`Forecast refresh failed after ${Date.now() - startedAt}ms (${err.message}); serving stale-if-error forecast for ${cacheKey}.`);
				return stale;
			}
			// True cold cache: re-throw so the enhanced ETo method falls back to local-only ETo.
			console.error('DEBUG: OpenMeteo forecast failed with no cached fallback (ETo will use local-only):', err.message);
			throw new CodedError(ErrorCode.WeatherApiError, `Forecast provider failed: ${err.message}`);
		}
	}

	// Check if this provider supports forecasting
	public supportsForecasting(): boolean {
		return this.enableForecast;
	}

	// Override shouldCacheWateringScale for forecast-enhanced calculations
	public shouldCacheWateringScale(): boolean {
		// Cache forecast-enhanced calculations since they're more expensive
		return this.enableForecast;
	}
}

function saveQueue() {
	queue = queue.filter( obs => moment().unix() - obs.timestamp  < ONE_DAY_SECONDS );
	try {
		fs.writeFileSync( "observations.json" , JSON.stringify( queue ), "utf8" );
	} catch ( err ) {
		console.error( "Error saving historical observations to local storage.", err );
	}
}

if ( process.env.WEATHER_PROVIDER === "local" && process.env.LOCAL_PERSISTENCE ) {
	if ( fs.existsSync( "observations.json" ) ) {
		try {
			queue = JSON.parse( fs.readFileSync( "observations.json", "utf8" ) );
			queue = queue.filter( obs => moment().unix() - obs.timestamp  < ONE_DAY_SECONDS );
		} catch ( err ) {
			console.error( "Error reading historical observations from local storage.", err );
			queue = [];
		}
	}
	setInterval( saveQueue, 1000 * 60 * 30 );
}

interface Observation {
	timestamp: number;
	temp: number;
	humidity: number;
	windSpeed: number;
	solarRadiation: number;
	precip: number;
}
