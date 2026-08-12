import express	from "express";
import fs from "fs";
import path from "path";

import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";
import { getParameter, getTZ } from "../weather";
import { localPersistenceEnabled, resolvePersistenceFile } from "../../config";
import {
	groupByLocalDay,
	hasWindowCoverage,
	localDateKey,
	localDayWindow,
	maxFinite,
	minFinite,
	shiftLocalDate,
	sumFinite,
	timeWeightedAverageInWindow,
} from "./providerUtils";

var queue: Array<Observation> = [],
	lastRainEpoch = 0,
	lastRainCount: number;

const MAX_OBSERVATION_GAP_SECONDS = 2 * 60 * 60;
const LOCAL_HISTORY_DAYS = 7;
const LOCAL_RETENTION_DAYS = LOCAL_HISTORY_DAYS + 1;
const OBSERVATIONS_FILE = resolvePersistenceFile("observations.json");
const LOCAL_PERSISTENCE_ENABLED = localPersistenceEnabled();

function roundedMeasurement(value: number, precision: number = 0): number | undefined {
	if (!Number.isFinite(value)) return undefined;
	const scale = Math.pow(10, precision);
	return Math.round(value * scale) / scale;
}

function getMeasurement(req: express.Request, key: string): number | undefined {
	let value: number;

	return ( key in req.query ) && !isNaN( value = parseFloat( getParameter(req.query[key]) ) ) && ( value !== -9999.0 ) ? value : undefined;
}

export const captureWUStream = async function( req: express.Request, res: express.Response ) {
	let rainCount = getMeasurement(req, "dailyrainin");
	const precip = typeof rainCount === "number" && Number.isFinite(rainCount) && Number.isFinite(lastRainCount)
		? (rainCount < lastRainCount ? rainCount : Math.max(0, rainCount - lastRainCount))
		: undefined;
	const solarRadiation = getMeasurement(req, "solarradiation");
	const rainRate = getMeasurement(req, "rainin");

	const obs: Observation = {
		timestamp: req.query.dateutc === "now" ? Math.floor(Date.now()/1000) : Math.floor(new Date(String(req.query.dateutc) + "Z").getTime()/1000),
		temp: getMeasurement(req, "tempf"),
		humidity: getMeasurement(req, "humidity"),
		windSpeed: getMeasurement(req, "windspeedmph"),
		solarRadiation: typeof solarRadiation === "number" && Number.isFinite(solarRadiation)
			? solarRadiation * 24 / 1000
			: undefined,	// Convert to kWh/m^2 per day
		precip,
	};

	lastRainEpoch = typeof rainRate === "number" && rainRate > 0 ? obs.timestamp : lastRainEpoch;
	lastRainCount = typeof rainCount === "number" && Number.isFinite(rainCount) ? rainCount : lastRainCount;

	queue = normalizeQueue([obs, ...queue]);

	res.send( "success\n" );
};

export default class LocalWeatherProvider extends WeatherProvider {

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		queue = normalizeQueue(queue);

		if ( queue.length == 0 ) {
			console.error( "There is insufficient data to support Weather response from local PWS." );
			throw new CodedError(ErrorCode.InsufficientWeatherData);
		}

		const weather: WeatherData = {
			weatherProvider: "local",
			temp: roundedMeasurement(queue[0].temp),
			minTemp: undefined,
			maxTemp: undefined,
			humidity: roundedMeasurement(queue[0].humidity),
			wind: roundedMeasurement(queue[0].windSpeed, 1),
			raining: lastRainEpoch > 0 && Math.floor(Date.now() / 1000) - lastRainEpoch <= 60 * 60,
			// A local observation stream has no forecast data. Historical
			// precipitation remains available through getWateringData().
			precip: undefined,
			description: "",
			icon: "01d",
			region: undefined,
			city: undefined,
			forecast: []
		};

		return weather;
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {

		queue = normalizeQueue(queue);
		return buildLocalWateringDataHistory(queue, coordinates);
	};

}

export function buildLocalWateringDataHistory(
	observations: readonly Observation[],
	coordinates: GeoCoordinates,
	now: Date = new Date()
): WateringData[] {
	const normalized = normalizeQueue([...observations], Math.floor(now.getTime() / 1000));
	const timezone = getTZ(coordinates);
	const groups = new Map(groupByLocalDay(
		normalized,
		observation => observation.timestamp * 1000,
		timezone
	).map(group => [group.date, group.records]));
	const result: WateringData[] = [];
	let date = shiftLocalDate(localDateKey(now, timezone), -1, timezone);

	for (let count = 0; count < LOCAL_HISTORY_DAYS; count++) {
		const day = groups.get(date);
		if (!day) break;
		const window = localDayWindow(date, timezone);
		try {
			result.push(buildLocalWateringData(
				day,
				Math.floor(window.start.getTime() / 1000),
				Math.floor(window.end.getTime() / 1000)
			));
		} catch (error) {
			if (!result.length) throw error;
			break;
		}
		date = shiftLocalDate(date, -1, timezone);
	}

	if (!result.length) {
		throw new CodedError(ErrorCode.InsufficientWeatherData);
	}
	return result;
}

export function buildLocalWateringData(
	observations: readonly Observation[],
	windowStart: number,
	windowEnd: number
): WateringData {
	const normalized = [...observations].sort((a, b) => a.timestamp - b.timestamp);
	const temp = timeWeightedAverageInWindow(normalized, obs => obs.timestamp, obs => obs.temp, windowStart, windowEnd);
	const humidity = timeWeightedAverageInWindow(normalized, obs => obs.timestamp, obs => obs.humidity, windowStart, windowEnd);
	const precip = sumFinite(normalized.map(obs => obs.precip));
	const hasCoreCoverage = [
		(obs: Observation) => obs.temp,
		(obs: Observation) => obs.humidity,
	].every(getValue => hasWindowCoverage(
		normalized,
		obs => obs.timestamp,
		getValue,
		windowStart,
		windowEnd,
		MAX_OBSERVATION_GAP_SECONDS
	));
	const hasSolarCoverage = hasWindowCoverage(
		normalized, obs => obs.timestamp, obs => obs.solarRadiation,
		windowStart, windowEnd, MAX_OBSERVATION_GAP_SECONDS
	);
	const hasWindCoverage = hasWindowCoverage(
		normalized, obs => obs.timestamp, obs => obs.windSpeed,
		windowStart, windowEnd, MAX_OBSERVATION_GAP_SECONDS
	);
	const result: WateringData = {
		weatherProvider: "local",
		temp,
		humidity,
		precip,
		periodStartTime: windowStart,
		minTemp: minFinite(normalized.map(obs => obs.temp)),
		maxTemp: maxFinite(normalized.map(obs => obs.temp)),
		minHumidity: minFinite(normalized.map(obs => obs.humidity)),
		maxHumidity: maxFinite(normalized.map(obs => obs.humidity)),
		solarRadiation: hasSolarCoverage
			? timeWeightedAverageInWindow(normalized, obs => obs.timestamp, obs => obs.solarRadiation, windowStart, windowEnd)
			: undefined,
		windSpeed: hasWindCoverage
			? timeWeightedAverageInWindow(normalized, obs => obs.timestamp, obs => obs.windSpeed, windowStart, windowEnd)
			: undefined,
	};

	if (!hasCoreCoverage || [result.temp, result.humidity, result.precip, result.minTemp, result.maxTemp,
		result.minHumidity, result.maxHumidity]
		.some(value => !Number.isFinite(value))) {
		console.error( "There is insufficient data to support watering calculation from local PWS." );
		throw new CodedError( ErrorCode.InsufficientWeatherData );
	}

	return result;
}

function saveQueue() {
	queue = normalizeQueue(queue);
	try {
		const state: PersistedObservationState = { observations: queue, lastRainCount, lastRainEpoch };
		writeJsonAtomically(OBSERVATIONS_FILE, state);
	} catch ( err ) {
		console.error( "Error saving historical observations to local storage.", err );
	}
}

export function flushLocalObservations(): void {
	if ( LOCAL_PERSISTENCE_ENABLED ) saveQueue();
}

if ( LOCAL_PERSISTENCE_ENABLED ) {
	if ( fs.existsSync( OBSERVATIONS_FILE ) ) {
		try {
			const stored = JSON.parse(fs.readFileSync(OBSERVATIONS_FILE, "utf8"));
			if (Array.isArray(stored)) {
				queue = normalizeQueue(stored);
			} else {
				queue = normalizeQueue(stored.observations || []);
				lastRainCount = Number.isFinite(stored.lastRainCount) ? stored.lastRainCount : undefined;
				lastRainEpoch = Number.isFinite(stored.lastRainEpoch) ? stored.lastRainEpoch : 0;
			}
		} catch ( err ) {
			console.error( "Error reading historical observations from local storage.", err );
			queue = [];
		}
	}
	setInterval( saveQueue, 1000 * 60 * 30 );
}

export function writeJsonAtomically(fileName: string, value: unknown): void {
	const directory = path.dirname(fileName);
	const temporary = `${fileName}.${process.pid}.tmp`;
	fs.mkdirSync(directory, { recursive: true });
	try {
		fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
		fs.renameSync(temporary, fileName);
	} finally {
		if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
	}
}

export interface Observation {
	timestamp: number;
	temp?: number;
	humidity?: number;
	windSpeed?: number;
	solarRadiation?: number;
	precip?: number;
}

interface PersistedObservationState {
	observations: Observation[];
	lastRainCount?: number;
	lastRainEpoch: number;
}

function normalizeQueue(observations: Observation[], now: number = Math.floor(Date.now() / 1000)): Observation[] {
	const cutoff = now - LOCAL_RETENTION_DAYS * 24 * 60 * 60;
	const unique = new Map<number, Observation>();
	for (const observation of observations) {
		if (Number.isFinite(observation?.timestamp) && observation.timestamp >= cutoff && !unique.has(observation.timestamp)) {
			unique.set(observation.timestamp, observation);
		}
	}
	return Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp);
}
