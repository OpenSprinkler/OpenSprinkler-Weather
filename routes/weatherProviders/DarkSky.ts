import * as moment from "moment-timezone";

import { EToData, GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";
import { httpJSONRequest } from "../weather";
import * as SunCalc from "suncalc";

async function getDarkSkyWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
	// The Unix seconds timestamp of 24 hours ago.
	const yesterdayTimestamp: number = moment().subtract( 1, "day" ).unix();
	// The current Unix seconds timestamp.
	const todayTimestamp: number = moment().unix();

	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		yesterdayUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${yesterdayTimestamp}?exclude=currently,minutely,daily,alerts,flags`,
		todayUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${todayTimestamp}?exclude=currently,minutely,daily,alerts,flags`;

	let yesterdayData, todayData;
	try {
		yesterdayData = await httpJSONRequest( yesterdayUrl );
		todayData = await httpJSONRequest( todayUrl );
	} catch (err) {
		// Indicate watering data could not be retrieved if an API error occurs.
		return undefined;
	}

	if ( !todayData.hourly || !todayData.hourly.data || !yesterdayData.hourly || !yesterdayData.hourly.data ) {
		return undefined;
	}

	/* The number of hourly forecasts to use from today's data. This will only include elements that contain historic
		data (not forecast data). */
	// Find the first element that contains forecast data.
	const todayElements = Math.min( 24, todayData.hourly.data.findIndex( ( data ) => data.time > todayTimestamp - 60 * 60 ) );

	/* Take as much data as possible from the first elements of today's data and take the remaining required data from
		the remaining data from the last elements of yesterday's data. */
	const samples = [
		...yesterdayData.hourly.data.slice( todayElements - 24 ),
		...todayData.hourly.data.slice( 0, todayElements )
	];

	// Fail if not enough data is available.
	if ( samples.length !== 24 ) {
		return undefined;
	}

	const totals = { temp: 0, humidity: 0, precip: 0 };
	for ( const sample of samples ) {
		totals.temp += sample.temperature;
		totals.humidity += sample.humidity;
		totals.precip += sample.precipIntensity
	}

	return {
		weatherProvider: "DarkSky",
		temp : totals.temp / 24,
		humidity: totals.humidity / 24 * 100,
		precip: totals.precip,
		raining: samples[ samples.length - 1 ].precipIntensity > 0
	};
}

async function getDarkSkyWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		forecastUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]}?exclude=minutely,alerts,flags`;

	let forecast;
	try {
		forecast = await httpJSONRequest( forecastUrl );
	} catch (err) {
		// Indicate weather data could not be retrieved if an API error occurs.
		return undefined;
	}

	if ( !forecast.currently || !forecast.daily || !forecast.daily.data ) {
		return undefined;
	}

	const weather: WeatherData = {
		weatherProvider: "DarkSky",
		temp: Math.floor( forecast.currently.temperature ),
		humidity: Math.floor( forecast.currently.humidity * 100 ),
		wind: Math.floor( forecast.currently.windSpeed ),
		description: forecast.currently.summary,
		// TODO set this
		icon: "",

		region: "",
		city: "",
		minTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMin ),
		maxTemp: Math.floor( forecast.daily.data[ 0 ].temperatureMax ),
		precip: forecast.daily.data[ 0 ].precipIntensity * 24,
		forecast: [ ]
	};

	for ( let index = 0; index < forecast.daily.data.length; index++ ) {
		weather.forecast.push( {
			temp_min: Math.floor( forecast.daily.data[ index ].temperatureMin ),
			temp_max: Math.floor( forecast.daily.data[ index ].temperatureMax ),
			date: forecast.daily.data[ index ].time,
			// TODO set this
			icon: "",
			description: forecast.daily.data[ index ].summary
		} );
	}

	return weather;
}

async function getDarkSkyEToData( coordinates: GeoCoordinates ): Promise< EToData > {
	// TODO use a rolling 24 hour window instead of fixed calendar days?
	// The Unix epoch seconds timestamp of 24 hours ago.
	const timestamp: number = moment().subtract( 1, "day" ).unix();

	const DARKSKY_API_KEY = process.env.DARKSKY_API_KEY,
		historicUrl = `https://api.darksky.net/forecast/${DARKSKY_API_KEY}/${coordinates[0]},${coordinates[1]},${timestamp}`;

	let historicData;
	try {
		historicData = await httpJSONRequest( historicUrl );
	} catch (err) {
		// Indicate ETO data could not be retrieved if an API error occurs.
		return undefined;
	}

	// Approximate solar radiation using a formula from http://www.shodor.org/os411/courses/_master/tools/calculators/solarrad/
	const solarRadiation = historicData.hourly.data.reduce( ( total, hour ) => {
		const currPosition = SunCalc.getPosition( new Date( hour.time * 1000 ), coordinates[ 0 ], coordinates[ 1 ] );
		// The Sun's position 1 hour ago.
		const lastPosition = SunCalc.getPosition( new Date( hour.time * 1000 - 60 * 60 * 1000 ), coordinates[ 0 ], coordinates[ 1 ] );
		const solarElevationAngle = ( currPosition.altitude + lastPosition.altitude ) / 2;

		// Calculate radiation and convert from watts to megajoules.
		const clearSkyIsolation = ( 990 * Math.sin( solarElevationAngle ) - 30 ) * 0.0036;

		// TODO include the radiation from hours where the sun is partially above the horizon.
		// Skip hours where the sun was below the horizon.
		if ( clearSkyIsolation <= 0 ) {
			return total;
		}

		return total + clearSkyIsolation * ( 1 - 0.75 * Math.pow( hour.cloudCover, 3.4 ) );
	}, 0 );

	return {
		weatherProvider: "DarkSky",
		minTemp: historicData.daily.data[ 0 ].temperatureMin,
		maxTemp: historicData.daily.data[ 0 ].temperatureMax,
		minHumidity: historicData.hourly.data.reduce( ( min, hour ) => Math.min( min, hour.humidity ), 1) * 100,
		maxHumidity: historicData.hourly.data.reduce( ( max, hour ) => Math.max( max, hour.humidity ), 0) * 100,
		solarRadiation: solarRadiation,
		// Assume wind speed measurements are taken at 2 meters.
		windSpeed: historicData.daily.data[ 0 ].windSpeed,
		dayOfYear: moment().subtract( 1, "day" ).dayOfYear(),
		precip: historicData.daily.data[ 0 ].precipIntensity * 24
	};
}


const DarkSkyWeatherProvider: WeatherProvider = {
	getWateringData: getDarkSkyWateringData,
	getWeatherData: getDarkSkyWeatherData,
	getEToData: getDarkSkyEToData
};
export default DarkSkyWeatherProvider;
