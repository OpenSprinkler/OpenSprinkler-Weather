import { config as dotenv_config } from "dotenv"
dotenv_config();

import * as express from "express";
import * as cors from "cors";

import * as weather from "./routes/weather";
import * as local from "./routes/weatherProviders/local";

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

app.get( "/", function( req, res ) {
	res.send( process.env.npm_package_description + " v" + process.env.npm_package_version );
} );

// Handle 404 error
app.use( function( req, res ) {
	res.status( 404 );
	res.send( "Error: Request not found" );
} );

// Start listening on the service port
app.listen( port, host, function() {
	console.log( "%s now listening on %s:%d", process.env.npm_package_description, host, port );

	if (pws !== "none" ) {
		console.log( "%s now listening for local weather stream", process.env.npm_package_description );
	}
} );
