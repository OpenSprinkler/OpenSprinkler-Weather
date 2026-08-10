import 'dotenv/config';
import './bootstrap';

import express from "express";
import cors from "cors";

import { getWateringData, getWeatherData, getWeatherSensorData } from "./routes/weather";
import { captureWUStream, flushLocalObservations } from "./routes/weatherProviders/local";
import { getBaselineETo } from "./routes/baselineETo";
import {default as packageJson} from "../package.json";
import { pinoHttp } from "pino-http";
import { pino, LevelWithSilent } from "pino";
import { resolveServerPort } from "./config";

function getLogLevel(): LevelWithSilent {
    switch (process.env.LOG_LEVEL) {
        case "trace":
            return "trace";
        case "debug":
            return "debug";
        case "info":
            return "info";
        case "warn":
            return "warn";
        case "error":
            return "error";
        case "fatal":
            return "fatal";
        case "silent":
            return "silent";
        default:
            return "info";
    }
}

const logger = pino({ level: getLogLevel() });

const host = process.env.HOST || "127.0.0.1";
const port = resolveServerPort();

export let pws = process.env.PWS || "none";
export const app = express();

// Disable parsing of nested serach queries to make the argument type string | string[]
app.use(express.urlencoded({ extended: false }));

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, getWateringData );
app.get( /(\d+)/, getWateringData );

// Handle requests matching /weatherData
app.options( /weatherData/, cors() );
app.get( /weatherData/, cors(), getWeatherData );

// Compact current, forecast, and historical data for controller WeatherSensor instances.
app.options( /weatherSensorData/, cors() );
app.get( /weatherSensorData/, cors(), getWeatherSensorData );

// Endpoint to stream Weather Underground data from local PWS
if ( pws === "WU" ) {
	app.get( "/weatherstation/updateweatherstation.php", captureWUStream );
}

app.get( "/", function( req, res ) {
	res.send( packageJson.description + " v" + packageJson.version );
} );

// Handle requests matching /baselineETo
app.options( /baselineETo/, cors() );
app.get( /baselineETo/, cors(), getBaselineETo );

// Handle 404 error
app.use( function( req, res ) {
	res.status( 404 );
	res.send( "Error: Request not found" );
} );

// Start listening on the service port
const server = app.listen( port, host, function() {
	console.log( "%s now listening on %s:%d", packageJson.description, host, port );

	if (pws !== "none" ) {
		console.log( "%s now listening for local weather stream", packageJson.description );
	}
} );

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info({ signal }, "Stopping weather service");
	flushLocalObservations();

	const timeout = setTimeout(() => {
		logger.warn("Forcing weather service shutdown after grace period");
		process.exit(0);
	}, 5_000);
	timeout.unref();
	server.close(() => {
		clearTimeout(timeout);
		process.exit(0);
	});
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
