import express	from "express";
import fs from "fs";

import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";
import { getParameter } from "../weather";
import {
	hasTimeSeriesCoverage,
	maxFinite,
	maximumTimeGap,
	minFinite,
	sumFinite,
	timeWeightedAverage,
} from "./providerUtils";

var queue: Array<Observation> = [],
	lastRainEpoch = 0,
	lastRainCount: number;

const MAX_OBSERVATION_GAP_SECONDS = 2 * 60 * 60;

function roundedMeasurement(value: number, precision: number = 0): number | undefined {
	if (!Number.isFinite(value)) return undefined;
	const scale = Math.pow(10, precision);
	return Math.round(value * scale) / scale;
}

function getMeasurement(req: express.Request, key: string): number {
	let value: number;

	return ( key in req.query ) && !isNaN( value = parseFloat( getParameter(req.query[key]) ) ) && ( value !== -9999.0 ) ? value : undefined;
}

export const captureWUStream = async function( req: express.Request, res: express.Response ) {
	let rainCount = getMeasurement(req, "dailyrainin");
	const precip = Number.isFinite(rainCount) && Number.isFinite(lastRainCount)
		? (rainCount < lastRainCount ? rainCount : Math.max(0, rainCount - lastRainCount))
		: undefined;

	const obs: Observation = {
		timestamp: req.query.dateutc === "now" ? Math.floor(Date.now()/1000) : Math.floor(new Date(String(req.query.dateutc) + "Z").getTime()/1000),
		temp: getMeasurement(req, "tempf"),
		humidity: getMeasurement(req, "humidity"),
		windSpeed: getMeasurement(req, "windspeedmph"),
		solarRadiation: getMeasurement(req, "solarradiation") * 24 / 1000,	// Convert to kWh/m^2 per day
		precip,
	};

	lastRainEpoch = getMeasurement(req, "rainin") > 0 ? obs.timestamp : lastRainEpoch;
	lastRainCount = isNaN(rainCount) ? lastRainCount : rainCount;

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

		if (queue.length < 2 || queue[0].timestamp - queue[queue.length - 1].timestamp < 23 * 60 * 60 ||
			maximumTimeGap(queue, obs => obs.timestamp) > MAX_OBSERVATION_GAP_SECONDS) {
			console.error( "There is insufficient data to support watering calculation from local PWS." );
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const temp = timeWeightedAverage(queue, obs => obs.timestamp, obs => obs.temp);
		const humidity = timeWeightedAverage(queue, obs => obs.timestamp, obs => obs.humidity);
		const solarRadiation = timeWeightedAverage(queue, obs => obs.timestamp, obs => obs.solarRadiation);
		const windSpeed = timeWeightedAverage(queue, obs => obs.timestamp, obs => obs.windSpeed);
		const precip = sumFinite(queue.map(obs => obs.precip));
		const hasCoverage = [
			(obs: Observation) => obs.temp,
			(obs: Observation) => obs.humidity,
			(obs: Observation) => obs.solarRadiation,
			(obs: Observation) => obs.windSpeed,
		].every(getValue => hasTimeSeriesCoverage(
			queue,
			obs => obs.timestamp,
			getValue,
			MAX_OBSERVATION_GAP_SECONDS
		));
		const result: WateringData = {
			weatherProvider: "local",
			temp,
			humidity,
			precip,
			periodStartTime: Math.floor( queue[ queue.length - 1 ].timestamp ),
			minTemp: minFinite(queue.map(obs => obs.temp)),
			maxTemp: maxFinite(queue.map(obs => obs.temp)),
			minHumidity: minFinite(queue.map(obs => obs.humidity)),
			maxHumidity: maxFinite(queue.map(obs => obs.humidity)),
			solarRadiation,
			windSpeed
		};

		if (!hasCoverage || [result.temp, result.humidity, result.precip, result.minTemp, result.maxTemp,
			result.minHumidity, result.maxHumidity, result.solarRadiation, result.windSpeed]
			.some(value => !Number.isFinite(value))) {
			console.error( "There is insufficient data to support watering calculation from local PWS." );
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		return [result];
	};

}

function saveQueue() {
	queue = normalizeQueue(queue);
	try {
		const state: PersistedObservationState = { observations: queue, lastRainCount, lastRainEpoch };
		fs.writeFileSync("observations.json", JSON.stringify(state), "utf8");
	} catch ( err ) {
		console.error( "Error saving historical observations to local storage.", err );
	}
}

if ( process.env.WEATHER_PROVIDER === "local" && process.env.LOCAL_PERSISTENCE ) {
	if ( fs.existsSync( "observations.json" ) ) {
		try {
			const stored = JSON.parse(fs.readFileSync("observations.json", "utf8"));
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

interface Observation {
	timestamp: number;
	temp: number;
	humidity: number;
	windSpeed: number;
	solarRadiation: number;
	precip: number;
}

interface PersistedObservationState {
	observations: Observation[];
	lastRainCount?: number;
	lastRainEpoch: number;
}

function normalizeQueue(observations: Observation[]): Observation[] {
	const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
	const unique = new Map<number, Observation>();
	for (const observation of observations) {
		if (Number.isFinite(observation?.timestamp) && observation.timestamp >= cutoff && !unique.has(observation.timestamp)) {
			unique.set(observation.timestamp, observation);
		}
	}
	return Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp);
}
