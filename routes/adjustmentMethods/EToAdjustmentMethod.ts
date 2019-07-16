import * as SunCalc from "suncalc";
import * as moment from "moment";
import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { BaseWateringData, GeoCoordinates, PWS } from "../../types";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";


/**
 * Calculates how much watering should be scaled based on weather and adjustment options by comparing the recent
 * potential ETo to the baseline potential ETo that the watering program was designed for.
 */
async function calculateEToWateringScale(
	adjustmentOptions: EToScalingAdjustmentOptions,
	coordinates: GeoCoordinates,
	weatherProvider: WeatherProvider,
	pws?: PWS
): Promise< AdjustmentMethodResponse > {

	if ( pws ) {
		throw "ETo adjustment method does not support personal weather stations through WUnderground.";
	}

	// Temporarily disabled since OWM forecast data is checking if rain is forecasted for 3 hours in the future.
	/*
	if ( wateringData && wateringData.raining ) {
		return {
			scale: 0,
			rawData: { raining: 1 }
		}
	}
	 */

	// This will throw an error message if ETo data cannot be retrieved.
	const etoData: EToData = await weatherProvider.getEToData( coordinates );

	let baseETo: number;
	// Default elevation is based on data from https://www.pnas.org/content/95/24/14009.
	let elevation = 600;

	if ( adjustmentOptions && "baseETo" in adjustmentOptions ) {
		baseETo = adjustmentOptions.baseETo
	} else {
		throw "A baseline potential ETo must be provided.";
	}

	if ( adjustmentOptions && "elevation" in adjustmentOptions ) {
		elevation = adjustmentOptions.elevation;
	}

	const eto: number = calculateETo( etoData, elevation, coordinates );

	const scale =  Math.floor( Math.min( Math.max( 0, ( eto - etoData.precip ) / baseETo * 100 ), 200 ) );
	return {
		scale: scale,
		rawData: {
			eto: Math.round( eto * 1000) / 1000,
			radiation: Math.round( etoData.solarRadiation * 100) / 100,
			minT: Math.round( etoData.minTemp ),
			maxT: Math.round( etoData.maxTemp ),
			minH: Math.round( etoData.minHumidity ),
			maxH: Math.round( etoData.maxHumidity ),
			wind: Math.round( etoData.windSpeed * 10 ) / 10,
			p: Math.round( etoData.precip * 100 ) / 100
		},
		wateringData: etoData
	}
}

/* The implementation of this algorithm was guided by a step-by-step breakdown
	(http://edis.ifas.ufl.edu/pdffiles/ae/ae45900.pdf) */
/**
 * Calculates the reference potential evapotranspiration using the Penman-Monteith (FAO-56) method
 * (http://www.fao.org/3/X0490E/x0490e07.htm).
 *
 * @param etoData The data to calculate the ETo with.
 * @param elevation The elevation above sea level of the watering site (in feet).
 * @param coordinates The coordinates of the watering site.
 * @return The reference potential evapotranspiration (in inches per day).
 */
export function calculateETo( etoData: EToData, elevation: number, coordinates: GeoCoordinates ): number {
	// Convert to Celsius.
	const minTemp = ( etoData.minTemp - 32 ) * 5 / 9;
	const maxTemp = ( etoData.maxTemp - 32 ) * 5 / 9;
	// Convert to meters.
	elevation = elevation / 3.281;
	// Convert to meters per second.
	const windSpeed = etoData.windSpeed / 2.237;
	// Convert to megajoules.
	const solarRadiation = etoData.solarRadiation * 3.6;

	const avgTemp = ( maxTemp + minTemp ) / 2;

	const saturationVaporPressureCurveSlope = 4098 * 0.6108 * Math.exp( 17.27 * avgTemp / ( avgTemp + 237.3 ) ) / Math.pow( avgTemp + 237.3, 2 );

	const pressure = 101.3 * Math.pow( ( 293 - 0.0065 * elevation ) / 293, 5.26 );

	const psychrometricConstant = 0.000665 * pressure;

	const deltaTerm = saturationVaporPressureCurveSlope / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

	const psiTerm = psychrometricConstant / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

	const tempTerm = ( 900 / ( avgTemp + 273 ) ) * windSpeed;

	const minSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * minTemp / ( minTemp + 237.3 ) );

	const maxSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * maxTemp / ( maxTemp + 237.3 ) );

	const avgSaturationVaporPressure = ( minSaturationVaporPressure + maxSaturationVaporPressure ) / 2;

	const actualVaporPressure = ( minSaturationVaporPressure * etoData.maxHumidity / 100 + maxSaturationVaporPressure * etoData.minHumidity / 100 ) / 2;

	const dayOfYear = moment.unix( etoData.periodStartTime ).dayOfYear();

	const inverseRelativeEarthSunDistance = 1 + 0.033 * Math.cos( 2 * Math.PI / 365 * dayOfYear );

	const solarDeclination = 0.409 * Math.sin( 2 * Math.PI / 365 * dayOfYear - 1.39 );

	const latitudeRads = Math.PI / 180 * coordinates[ 0 ];

	const sunsetHourAngle = Math.acos( -Math.tan( latitudeRads ) * Math.tan( solarDeclination ) );

	const extraterrestrialRadiation = 24 * 60 / Math.PI * 0.082 * inverseRelativeEarthSunDistance * ( sunsetHourAngle * Math.sin( latitudeRads ) * Math.sin( solarDeclination ) + Math.cos( latitudeRads ) * Math.cos( solarDeclination ) * Math.sin( sunsetHourAngle ) );

	const clearSkyRadiation = ( 0.75 + 2e-5 * elevation ) * extraterrestrialRadiation;

	const netShortWaveRadiation = ( 1 - 0.23 ) * solarRadiation;

	const netOutgoingLongWaveRadiation = 4.903e-9 * ( Math.pow( maxTemp + 273.16, 4 ) + Math.pow( minTemp + 273.16, 4 ) ) / 2 * ( 0.34 - 0.14 * Math.sqrt( actualVaporPressure ) ) * ( 1.35 * solarRadiation / clearSkyRadiation - 0.35);

	const netRadiation = netShortWaveRadiation - netOutgoingLongWaveRadiation;

	const radiationTerm = deltaTerm * 0.408 * netRadiation;

	const windTerm = psiTerm * tempTerm * ( avgSaturationVaporPressure - actualVaporPressure );

	return ( windTerm + radiationTerm ) / 25.4;
}

/**
 * Approximates the wind speed at 2 meters using the wind speed measured at another height.
 * @param speed The wind speed measured at the specified height (in miles per hour).
 * @param height The height of the measurement (in feet).
 * @returns The approximate wind speed at 2 meters (in miles per hour).
 */
export function standardizeWindSpeed( speed: number, height: number ) {
	return speed * 4.87 / Math.log( 67.8 * height / 3.281 - 5.42 );
}

/* For hours where the Sun is too low to emit significant radiation, the formula for clear sky isolation will yield a
 * negative value. "radiationStart" marks the times of day when the Sun will rise high for solar isolation formula to
 * become positive, and "radiationEnd" marks the time of day when the Sun sets low enough that the equation will yield
 * a negative result. For any times outside of these ranges, the formula will yield incorrect results (they should be
 * clamped at 0 instead of being negative).
 */
SunCalc.addTime( Math.asin( 30 / 990 ) * 180 / Math.PI, "radiationStart", "radiationEnd" );

/**
 * Approximates total solar radiation for a day given cloud coverage information using a formula from
 * http://www.shodor.org/os411/courses/_master/tools/calculators/solarrad/
 * @param cloudCoverInfo Information about the cloud coverage for several periods that span the entire day.
 * @param coordinates The coordinates of the location the data is from.
 * @return The total solar radiation for the day (in kilowatt hours per square meter per day).
 */
export function approximateSolarRadiation(cloudCoverInfo: CloudCoverInfo[], coordinates: GeoCoordinates ): number {
	return cloudCoverInfo.reduce( ( total, window: CloudCoverInfo ) => {
		const radiationStart: moment.Moment = moment( SunCalc.getTimes( window.endTime.toDate(), coordinates[ 0 ], coordinates[ 1 ])[ "radiationStart" ] );
		const radiationEnd: moment.Moment = moment( SunCalc.getTimes( window.startTime.toDate(), coordinates[ 0 ], coordinates[ 1 ])[ "radiationEnd" ] );

		// Clamp the start and end times of the window within time when the sun was emitting significant radiation.
		const startTime: moment.Moment = radiationStart.isAfter( window.startTime ) ? radiationStart : window.startTime;
		const endTime: moment.Moment = radiationEnd.isBefore( window.endTime ) ? radiationEnd: window.endTime;

		// The length of the window that will actually be used (in hours).
		const windowLength = ( endTime.unix() - startTime.unix() ) / 60 / 60;

		// Skip the window if there is no significant radiation during the time period.
		if ( windowLength <= 0 ) {
			return total;
		}

		const startPosition = SunCalc.getPosition( startTime.toDate(), coordinates[ 0 ], coordinates[ 1 ] );
		const endPosition = SunCalc.getPosition( endTime.toDate(), coordinates[ 0 ], coordinates[ 1 ] );
		const solarElevationAngle = ( startPosition.altitude + endPosition.altitude ) / 2;

		// Calculate radiation and convert from watts to kilowatts.
		const clearSkyIsolation = ( 990 * Math.sin( solarElevationAngle ) - 30 ) / 1000 * windowLength;

		return total + clearSkyIsolation * ( 1 - 0.75 * Math.pow( window.cloudCover, 3.4 ) );
	}, 0 );
}

export interface EToScalingAdjustmentOptions extends AdjustmentOptions {
	/** The watering site's height above sea level (in feet). */
	elevation?: number;
	/** Baseline potential ETo (in inches per day). */
	baseETo?: number;
}

/** Data about the cloud coverage for a period of time. */
export interface CloudCoverInfo {
	/** The start of this period of time. */
	startTime: moment.Moment;
	/** The end of this period of time. */
	endTime: moment.Moment;
	/** The average fraction of the sky covered by clouds during this time period. */
	cloudCover: number;
}

/**
 * Data used to calculate ETo. This data should be taken from a 24 hour time window.
 */
export interface EToData extends BaseWateringData {
	/** The Unix epoch seconds timestamp of the start of this 24 hour time window. */
	periodStartTime: number;
	/** The minimum temperature over the time period (in Fahrenheit). */
	minTemp: number;
	/** The maximum temperature over the time period (in Fahrenheit). */
	maxTemp: number;
	/** The minimum relative humidity over the time period (as a percentage). */
	minHumidity: number;
	/** The maximum relative humidity over the time period (as a percentage). */
	maxHumidity: number;
	/** The solar radiation, accounting for cloud coverage (in kilowatt hours per square meter per day). */
	solarRadiation: number;
	/**
	 * The average wind speed measured at 2 meters over the time period (in miles per hour). A measurement taken at a
	 * different height can be standardized to 2m using the `standardizeWindSpeed` function in EToAdjustmentMethod.
	 */
	windSpeed: number;
}

const EToAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateEToWateringScale
};
export default EToAdjustmentMethod;
