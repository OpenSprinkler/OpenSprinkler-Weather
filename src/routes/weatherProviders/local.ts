import express	from "express";
import fs from "fs";
import path from "path";
import { startOfDay, subDays, getUnixTime } from "date-fns";
import { localTime } from "../weather";

import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";
import { getParameter } from "../weather";

// Interface MUSS vor der Verwendung definiert werden
interface Observation {
	timestamp: number;
	temp: number | null;
	humidity: number | null;
	windSpeed: number | null;
	solarRadiation: number | null;  // Use null instead of undefined for JSON serialization
	precip: number | null;
}

var queue: Array<Observation> = [],
	lastRainEpoch = 0,
	lastRainCount = 0;  // Initialize to 0 instead of undefined

// Export queue for debugging purposes
export function getQueue(): Array<Observation> {
	return queue;
}

const LOCAL_OBSERVATION_DAYS = 7;

// Data Retention Strategy:
// - In-memory queue: Keep up to 8 days (LOCAL_OBSERVATION_DAYS + 1)
// - getWeatherDataInternal: Uses last 24 hours (for current weather display)
// - getWateringDataInternal: Uses up to 7 complete days + today (for Zimmerman calculation)
// - saveQueue: Trims to 8 days and persists every 30 minutes

// Configure data directory from environment variable or use default
// Using PERSISTENCE_LOCATION as per PR #144, but with path.join() for cross-platform compatibility (Copilot suggestion)
const dataDir = process.env.PERSISTENCE_LOCATION || path.join(__dirname, '..', '..', 'data');
const observationsPath = path.join(dataDir, 'observations.json');

function getMeasurement(req: express.Request, key: string): number | null {
	let value: number;

	return ( key in req.query ) && !isNaN( value = parseFloat( getParameter(req.query[key]) ) ) && ( value !== -9999.0 ) ? value : null;
}

export const captureWUStream = async function( req: express.Request, res: express.Response ) {
	const rainCount = getMeasurement(req, "dailyrainin");
	const temp = getMeasurement(req, "tempf");
	const humidity = getMeasurement(req, "humidity");
	const windSpeed = getMeasurement(req, "windspeedmph");
	const solarRadiation = getMeasurement(req, "solarradiation");
	const rainin = getMeasurement(req, "rainin");

	// Calculate precipitation safely
	let precip: number | null = null;  // Default to null instead of undefined
	if (typeof rainCount === "number" && typeof lastRainCount === "number") {
		// Handle rain counter reset (when new value is less than previous)
		precip = rainCount < lastRainCount ? rainCount : rainCount - lastRainCount;
	} else if (typeof rainCount === "number") {
		// First reading or lastRainCount was invalid
		precip = rainCount;
	}

	const obs: Observation = {
		timestamp: req.query.dateutc === "now" ? Math.floor(Date.now()/1000) : Math.floor(new Date(String(req.query.dateutc) + "Z").getTime()/1000),
		temp: temp,
		humidity: humidity,
		windSpeed: windSpeed,
		solarRadiation: typeof solarRadiation === "number" ? solarRadiation * 24 / 1000 : null,	// Use null instead of undefined for JSON serialization
		precip: precip,
	};

	// Update lastRainEpoch only if rainin is a valid number > 0
	if (typeof rainin === "number" && rainin > 0) {
		lastRainEpoch = obs.timestamp;
	}

	// Update lastRainCount only if rainCount is a valid number
	if (typeof rainCount === "number") {
		lastRainCount = rainCount;
	}

	queue.unshift(obs);

	res.send( "success\n" );
};

export default class LocalWeatherProvider extends WeatherProvider {

	protected async getWeatherDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WeatherData > {
		// IMPORTANT: Filter locally, don't modify global queue!
		// getWateringDataInternal needs up to 7 days of data
		const recentQueue = queue.filter( obs => Math.floor(Date.now()/1000) - obs.timestamp < 24*60*60 );

		if ( recentQueue.length == 0 ) {
			console.error( "There is insufficient data to support Weather response from local PWS." );
			throw "There is insufficient data to support Weather response from local PWS.";
		}

		// Get most recent observation
		const latest = recentQueue[0];

		const weather: WeatherData = {
			weatherProvider: "local",
			temp: typeof latest.temp === "number" ? Math.floor(latest.temp) : undefined,
			minTemp: undefined,
			maxTemp: undefined,
			humidity: typeof latest.humidity === "number" ? Math.floor(latest.humidity) : undefined,
			wind: typeof latest.windSpeed === "number" ? Math.floor(latest.windSpeed * 10) / 10 : undefined,
			raining: false,
			precip: Math.floor( recentQueue.reduce( ( sum, obs ) => sum + ( typeof obs.precip === "number" ? obs.precip : 0 ), 0) * 100 ) / 100,
			description: "",
			icon: "01d",
			region: undefined,
			city: undefined,
			forecast: []
		};

		if (weather.precip > 0){
			weather.raining = true;
		}

		return weather;
	}

	protected async getWateringDataInternal( coordinates: GeoCoordinates, pws: PWS | undefined ): Promise< WateringData[] > {
		// Note: Queue trimming is handled by saveQueue() which runs every 30 minutes
		// DO NOT trim the global queue here as it causes data loss!

		if ( queue.length == 0 || queue[0].timestamp - queue[queue.length-1].timestamp < 23*60*60) {
			console.error( "There is insufficient data to support watering calculation from local PWS." );
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		// 2. Determine day boundaries
		const currentDay = startOfDay(localTime(coordinates));  // today 00:00 local
		const now = Math.floor(Date.now() / 1000);  // current time in epoch
		const startTime = getUnixTime(subDays(currentDay, 7));  // 7 days ago at midnight

		// Filter to include data from 7 days ago up to NOW (including today's partial data)
		// This gives hybrid mode the most accurate recent data from the local station
		const filteredData = queue.filter(obs => obs.timestamp >= startTime && obs.timestamp <= now);
		const data: WateringData[] = [];

		// 3. Loop over each day from TODAY back to 7 days ago
		// Start with today (partial day with data up to now)
		let dayEnd = new Date(now * 1000);  // Current time
		let dayStart = currentDay;  // Today at midnight

		// First iteration: Today (partial day)
		let dayObs = filteredData.filter(obs =>
			obs.timestamp >= getUnixTime(dayStart) && obs.timestamp <= now
		);

		if (dayObs.length > 0) {
			// Process today's partial data
			let cTemp=0, cHumidity=0, cPrecip=0, cSolar=0, cWind=0;
			const avgTemp = dayObs.reduce((sum, obs) => typeof obs.temp === "number" && ++cTemp ? sum + obs.temp : sum, 0) / cTemp;
			const avgHum  = dayObs.reduce((sum, obs) => typeof obs.humidity === "number" && ++cHumidity ? sum + obs.humidity : sum, 0) / cHumidity;
			const totalPrecip = dayObs.reduce((sum, obs) => typeof obs.precip === "number" && ++cPrecip ? sum + obs.precip : sum, 0);
			const minTemp = dayObs.reduce((min, obs) => (typeof obs.temp === "number" && min > obs.temp ? obs.temp : min), Infinity);
			const maxTemp = dayObs.reduce((max, obs) => (typeof obs.temp === "number" && max < obs.temp ? obs.temp : max), -Infinity);
			const minHum  = dayObs.reduce((min, obs) => (typeof obs.humidity === "number" && min > obs.humidity ? obs.humidity : min), Infinity);
			const maxHum  = dayObs.reduce((max, obs) => (typeof obs.humidity === "number" && max < obs.humidity ? obs.humidity : max), -Infinity);
			const avgSolar= dayObs.reduce((sum, obs) => typeof obs.solarRadiation === "number" && ++cSolar ? sum + obs.solarRadiation : sum, 0) / cSolar;
			const avgWind = dayObs.reduce((sum, obs) => typeof obs.windSpeed === "number" && ++cWind ? sum + obs.windSpeed : sum, 0) / cWind;

			if (cTemp && cHumidity && ![minTemp, minHum, -maxTemp, -maxHum].includes(Infinity) && cWind) {
				// Note: solarRadiation is optional - not all weather stations have solar sensors
				data.push({
					weatherProvider: "local",
					periodStartTime: Math.floor(getUnixTime(dayStart)),
					temp: avgTemp,
					humidity: avgHum,
					precip: totalPrecip,
					minTemp: minTemp,
					maxTemp: maxTemp,
					minHumidity: minHum,
					maxHumidity: maxHum,
					solarRadiation: cSolar > 0 ? avgSolar : undefined,  // Optional - may be null
					windSpeed: avgWind
				});
			}
		}

		// Continue with previous complete days (yesterday through 7 days ago)
		dayEnd = currentDay;
		for (let i = 0; i < 7; i++) {
			let dayStart = subDays(dayEnd, 1);

			// Collect observations for this day [dayStart, dayEnd)
			const dayObs = filteredData.filter(obs =>
				obs.timestamp >= getUnixTime(dayStart) && obs.timestamp < getUnixTime(dayEnd)
			);

			if (dayObs.length === 0) {
				// No data for older days - stop here, return what we have
				break;
			}

			// 4. Calculate daily averages/totals
			let cTemp=0, cHumidity=0, cPrecip=0, cSolar=0, cWind=0;
			const avgTemp = dayObs.reduce((sum, obs) => typeof obs.temp === "number" && ++cTemp ? sum + obs.temp : sum, 0) / cTemp;
			const avgHum  = dayObs.reduce((sum, obs) => typeof obs.humidity === "number" && ++cHumidity ? sum + obs.humidity : sum, 0) / cHumidity;
			const totalPrecip = dayObs.reduce((sum, obs) => typeof obs.precip === "number" && ++cPrecip ? sum + obs.precip : sum, 0);
			const minTemp = dayObs.reduce((min, obs) => (typeof obs.temp === "number" && min > obs.temp ? obs.temp : min), Infinity);
			const maxTemp = dayObs.reduce((max, obs) => (typeof obs.temp === "number" && max < obs.temp ? obs.temp : max), -Infinity);
			const minHum  = dayObs.reduce((min, obs) => (typeof obs.humidity === "number" && min > obs.humidity ? obs.humidity : min), Infinity);
			const maxHum  = dayObs.reduce((max, obs) => (typeof obs.humidity === "number" && max < obs.humidity ? obs.humidity : max), -Infinity);
			const avgSolar= dayObs.reduce((sum, obs) => typeof obs.solarRadiation === "number" && ++cSolar ? sum + obs.solarRadiation : sum, 0) / cSolar;
			const avgWind = dayObs.reduce((sum, obs) => typeof obs.windSpeed === "number" && ++cWind ? sum + obs.windSpeed : sum, 0) / cWind;

			// 5. Verify all required metrics are present
			// Note: solarRadiation is optional - not all weather stations have solar sensors
			if (!(cTemp && cHumidity)
				|| [minTemp, minHum, -maxTemp, -maxHum].includes(Infinity)
				|| !cWind) {
				// Missing required data for older days - stop here
				break;
			}

			// 6. Create WateringData for this day
			data.push({
				weatherProvider: "local",
				periodStartTime: Math.floor(getUnixTime(dayStart)),  // start of the day (epoch)
				temp: avgTemp,
				humidity: avgHum,
				precip: totalPrecip,
				minTemp: minTemp,
				maxTemp: maxTemp,
				minHumidity: minHum,
				maxHumidity: maxHum,
				solarRadiation: cSolar > 0 ? avgSolar : undefined,  // Optional - may be null
				windSpeed: avgWind
			});

			dayEnd = dayStart;  // move to previous day
		}

		console.log(`[LocalWeather] Returning ${data.length} days of historical data`);
		return data;
	}
}

function saveQueue() {
	const beforeCount = queue.length;
	// Keep observations up to 8 days old (7 days for watering + 1 day buffer)
	queue = queue.filter( obs => Math.floor(Date.now()/1000) - obs.timestamp < (LOCAL_OBSERVATION_DAYS+1)*24*60*60 );
	const afterCount = queue.length;
	const deletedCount = beforeCount - afterCount;

	try {
		// Ensure data directory exists
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}
		fs.writeFileSync( observationsPath , JSON.stringify( queue ), "utf8" );

		if (deletedCount > 0) {
			console.log(`[LocalWeather] Trimmed ${deletedCount} observations older than ${LOCAL_OBSERVATION_DAYS+1} days. Kept ${afterCount} observations.`);
		}
	} catch ( err ) {
		console.error( "Error saving historical observations to local storage.", err );
	}
}

if ( process.env.LOCAL_PERSISTENCE ) {
	// Load persisted observations on startup (works for both 'local' and 'hybrid' providers)
	if ( fs.existsSync( observationsPath ) ) {
		try {
			queue = JSON.parse( fs.readFileSync( observationsPath, "utf8" ) );
			queue = queue.filter( obs => Math.floor(Date.now()/1000) - obs.timestamp < (LOCAL_OBSERVATION_DAYS+1)*24*60*60 );
			console.log(`[LocalWeather] Loaded ${queue.length} persisted observations from ${observationsPath}`);
		} catch ( err ) {
			console.error( "Error reading historical observations from local storage.", err );
			queue = [];
		}
	}
	// Save observations every 30 minutes
	setInterval( saveQueue, 1000 * 60 * 30 );
	console.log(`[LocalWeather] Persistence enabled, saving to ${observationsPath} every 30 minutes`);
}