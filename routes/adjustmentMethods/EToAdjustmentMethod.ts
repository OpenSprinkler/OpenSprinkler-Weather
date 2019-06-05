import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { EToData, GeoCoordinates, WateringData, WeatherProvider } from "../../types";
import * as SunCalc from "suncalc";
import * as moment from "moment";


/**
 * Calculates how much watering should be scaled based on weather and adjustment options by comparing a recent ETo to
 * the base ETo that the watering program was designed for.
 */
async function calculateEToWateringScale(
	adjustmentOptions: EToScalingAdjustmentOptions,
	wateringData: WateringData | undefined,
	coordinates: GeoCoordinates,
	weatherProvider: WeatherProvider
): Promise< AdjustmentMethodResponse > {

	if ( !weatherProvider.getEToData ) {
		return {
			scale: undefined,
			errorMessage: "selected WeatherProvider does not support getEToData"
		};
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

	const etoData: EToData = await weatherProvider.getEToData( coordinates );

	if ( !etoData ) {
		return {
			scale: undefined
		};
	}

	// TODO this default baseETo is not based on any data. Automatically determine ETo based on geographic location instead.
	let elevation = 150 * 3.281, baseETo = 2 / 25.4;

	if ( adjustmentOptions && "elevation" in adjustmentOptions ) {
		elevation = adjustmentOptions.elevation;
	}

	if ( adjustmentOptions && "baseETo" in adjustmentOptions ) {
		baseETo = adjustmentOptions.baseETo
	}

	const eto: number = calculateETo( etoData, elevation, coordinates );

	const scale =  Math.floor( Math.min( Math.max( 0, ( eto - etoData.precip ) / baseETo * 100 ), 200 ) );
	return {
		scale: scale,
		// TODO should more data be included and should fields be renamed?
		rawData: {
			baseETo: Math.round( baseETo * 1000) / 1000,
			eto: Math.round( eto * 1000) / 1000,
			radiation: Math.round( etoData.solarRadiation * 100) / 100
		}
	}
}

// The implementation of this algorithm was guided by a step-by-step breakdown (http://edis.ifas.ufl.edu/pdffiles/ae/ae45900.pdf)
/**
 * Calculates the reference evapotranspiration using the Penman-Monteith (FAO-56) method (http://www.fao.org/3/X0490E/x0490e07.htm).
 *
 * @param etoData The data to calculate the ETo with.
 * @param elevation The elevation above sea level of the watering site (in feet).
 * @param coordinates The coordinates of the watering site.
 * @return The reference evapotranspiration (in inches per day).
 */
export function calculateETo( etoData: EToData, elevation: number, coordinates: GeoCoordinates ): number {
	// Convert to Celsius.
	const minTemp = ( etoData.minTemp - 32 ) * 5 / 9;
	const maxTemp = ( etoData.maxTemp - 32 ) * 5 / 9;
	elevation = elevation / 3.281;

	const avgTemp = ( maxTemp + minTemp ) / 2;

	const saturationVaporPressureCurveSlope = 4098 * 0.6108 * Math.exp( 17.27 * avgTemp / ( avgTemp + 237.3 ) ) / Math.pow( avgTemp + 237.3, 2 );

	const pressure = 101.3 * Math.pow( ( 293 - 0.0065 * elevation ) / 293, 5.26 );

	const psychrometricConstant = 0.000665 * pressure;

	const deltaTerm = saturationVaporPressureCurveSlope / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * etoData.windSpeed ) );

	const psiTerm = psychrometricConstant / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * etoData.windSpeed ) );

	const tempTerm = ( 900 / ( avgTemp + 273 ) ) * etoData.windSpeed;

	const minSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * minTemp / ( minTemp + 237.3 ) );

	const maxSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * maxTemp / ( maxTemp + 237.3 ) );

	const avgSaturationVaporPressure = ( minSaturationVaporPressure + maxSaturationVaporPressure ) / 2;

	const actualVaporPressure = ( minSaturationVaporPressure * etoData.maxHumidity / 100 + maxSaturationVaporPressure * etoData.minHumidity / 100 ) / 2;

	const inverseRelativeEarthSunDistance = 1 + 0.033 * Math.cos( 2 * Math.PI / 365 * etoData.dayOfYear );

	const solarDeclination = 0.409 * Math.sin( 2 * Math.PI / 365 * etoData.dayOfYear - 1.39 );

	const latitudeRads = Math.PI / 180 * coordinates[ 0 ];

	const sunsetHourAngle = Math.acos( -Math.tan( latitudeRads ) * Math.tan( solarDeclination ) );

	const extraterrestrialRadiation = 24 * 60 / Math.PI * 0.082 * inverseRelativeEarthSunDistance * ( sunsetHourAngle * Math.sin( latitudeRads ) * Math.sin( solarDeclination ) + Math.cos( latitudeRads ) * Math.cos( solarDeclination ) * Math.sin( sunsetHourAngle ) );

	const clearSkyRadiation = ( 0.75 + 2e-5 * elevation ) * extraterrestrialRadiation;

	const solarRadiation = etoData.solarRadiation;

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
	return speed / 2.237 * 4.87 / Math.log( 67.8 * height / 3.281 - 5.42 );
}

// The time that formula for clear sky isolation will start/stop yielding a non-negative result.
SunCalc.addTime( Math.asin( 30 / 990 ) * 180 / Math.PI, "radiationStart", "radiationEnd" );

/**
 * Approximates total solar radiation for a day given cloud coverage information using a formula from
 * http://www.shodor.org/os411/courses/_master/tools/calculators/solarrad/
 * @param cloudCoverInfo Information about the cloud coverage for several periods that span the entire day.
 * @param coordinates The coordinates of the location the data is from.
 * @return The total solar radiation for the day (in megajoules per square meter per day).
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

		// Calculate radiation and convert from watts to megajoules.
		const clearSkyIsolation = ( 990 * Math.sin( solarElevationAngle ) - 30 ) * 0.0036 * windowLength;

		return total + clearSkyIsolation * ( 1 - 0.75 * Math.pow( window.cloudCover, 3.4 ) );
	}, 0 );
}

export interface EToScalingAdjustmentOptions extends AdjustmentOptions {
	/** The watering site's height above sea level (in meters). */
	elevation?: number;
	/** Base ETo (in millimeters per day). */
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


const EToAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateEToWateringScale
};
export default EToAdjustmentMethod;
