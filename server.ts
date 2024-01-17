import { config as dotenv_config } from "dotenv"
dotenv_config();

import * as express from "express";
import * as cors from "cors";

import * as weather from "./routes/weather";
import * as local from "./routes/weatherProviders/local";
import * as baselineETo from "./routes/baselineETo";
import * as packageJson from "./package.json";

let	host	= process.env.HOST || "127.0.0.1",
	port	= parseInt( process.env.PORT ) || 3000;

export let pws = process.env.PWS || "none";
export const app = express();

// Handle requests matching /weatherID.py where ID corresponds to the
// weather adjustment method selector.
// This endpoint is considered deprecated and supported for prior firmware
app.get( /weather(\d+)\.py/, weather.getWateringData );
app.get( /(\d+)/, weather.getWateringData );

// Handle requests matching /weatherData
app.options( /weatherData/, cors() );
app.get( /weatherData/, cors(), weather.getWeatherData );

// Endpoint to stream Weather Underground data from local PWS
if ( pws === "WU" ) {
	app.get( "/weatherstation/updateweatherstation.php", local.captureWUStream );
}
if ( pws === "weatherlink" ) {
	const weatherLinkUrl = process.env.WEATHERLINK_URL;
	if (!weatherLinkUrl) console.error("Missing WEATHERLINK_URL.")
  else {
		// Poll the current weather conditions every minute.
		const MinuteMs = 60*1000
		setInterval(() => local.pollWeatherlink(weatherLinkUrl), MinuteMs);
	}	
}

app.get( "/", function( req, res ) {
	res.send( packageJson.description + " v" + packageJson.version );
} );

// Handle requests matching /baselineETo
app.options( /baselineETo/, cors() );
app.get( /baselineETo/, cors(), baselineETo.getBaselineETo );

// Handle 404 error
app.use( function( req, res ) {
	res.status( 404 );
	res.send( "Error: Request not found" );
} );

// Start listening on the service port
app.listen( port, host, function() {
	console.log( "%s now listening on %s:%d", packageJson.description, host, port );

	if (pws !== "none" ) {
		console.log( "%s now listening for local weather stream", packageJson.description );
	}
} );
