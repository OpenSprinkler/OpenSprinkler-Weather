import * as express	from "express";
import { CronJob } from "cron";
import { GeoCoordinates, WateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";

const count = { temp: 0, humidity: 0 };

let	today: PWSStatus = {},
	yesterday: PWSStatus = {},
	last_bucket: Date,
	current_date: Date = new Date();

function sameDay(d1: Date, d2: Date): boolean {
	return d1.getFullYear() === d2.getFullYear() &&
			d1.getMonth() === d2.getMonth() &&
			d1.getDate() === d2.getDate();
}

export const captureWUStream = function( req: express.Request, res: express.Response ) {
	let prev: number, curr: number;

	if ( !( "dateutc" in req.query ) || !sameDay( current_date, new Date( req.query.dateutc + "Z") )) {
		res.send( "Error: Bad date range\n" );
		return;
	}

	if ( ( "tempf" in req.query ) && !isNaN( curr = parseFloat( req.query.tempf ) ) && curr !== -9999.0 ) {
		prev = ( "temp" in today ) ? today.temp : 0;
		today.temp = ( prev * count.temp + curr ) / ( ++count.temp );
	}
	if ( ( "humidity" in req.query ) && !isNaN( curr = parseFloat( req.query.humidity ) ) && curr !== -9999.0 ) {
		prev = ( "humidity" in today ) ? today.humidity : 0;
		today.humidity = ( prev * count.humidity + curr ) / ( ++count.humidity );
	}
	if ( ( "dailyrainin" in req.query ) && !isNaN( curr = parseFloat( req.query.dailyrainin ) ) && curr !== -9999.0 ) {
		today.precip = curr;
	}
	if ( ( "rainin" in req.query ) && !isNaN( curr = parseFloat( req.query.rainin ) ) && curr > 0 ) {
		last_bucket = new Date();
	}

	console.log( "OpenSprinkler Weather Observation: %s", JSON.stringify( req.query ) );

	res.send( "success\n" );
};

export default class LocalWeatherProvider extends WeatherProvider {

	public async getWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
		const result: WateringData = {
			...yesterday as WateringData,
			// Use today's weather if we dont have information for yesterday yet (i.e. on startup)
			...today,
			// PWS report "buckets" so consider it still raining if last bucket was less than an hour ago
			raining: last_bucket !== undefined ? ( ( Date.now() - +last_bucket ) / 1000 / 60 / 60 < 1 ) : undefined,
			weatherProvider: "local"
		};

		if ( "precip" in yesterday && "precip" in today ) {
			result.precip = yesterday.precip + today.precip;
		}

		return result;
	};
}

new CronJob( "0 0 0 * * *", function() {

	yesterday = Object.assign( {}, today );
	today = Object.assign( {} );
	count.temp = 0; count.humidity = 0;
	current_date = new Date();
}, null, true );


interface PWSStatus {
	temp?: number;
	humidity?: number;
	precip?: number;
}
