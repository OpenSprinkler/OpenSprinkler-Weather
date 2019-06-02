import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { EToData, GeoCoordinates, WateringData, WeatherProvider } from "../../types";


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

	const eto: number = calculateETo( etoData, elevation );

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
 * @return The reference evapotranspiration (in inches per day).
 */
export function calculateETo( etoData: EToData, elevation: number ): number {
	// Convert to Celsius.
	const minTemp = ( etoData.minTemp - 32 ) * 5 / 9;
	const maxTemp = ( etoData.maxTemp - 32 ) * 5 / 9;
	elevation = elevation / 3.281;

	const avgTemp = ( maxTemp + minTemp ) / 2;

	// Convert the wind speed to metric and adjust it to a 2m height.
	const windSpeed = etoData.windSpeed / 2.237 * 4.87 / Math.log( 67.8 * etoData.windSpeedMeasurementHeight / 3.281 - 5.42 );

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

	const inverseRelativeEarthSunDistance = 1 + 0.033 * Math.cos( 2 * Math.PI / 365 * etoData.dayOfYear );

	const solarDeclination = 0.409 * Math.sin( 2 * Math.PI / 365 * etoData.dayOfYear - 1.39 );

	const latitudeRads = Math.PI / 180 * etoData.lat;

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


export interface EToScalingAdjustmentOptions extends AdjustmentOptions {
	/** The watering site's height above sea level (in meters). */
	elevation?: number;
	/** Base ETo (in millimeters per day). */
	baseETo?: number;
}


const EToAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateEToWateringScale
};
export default EToAdjustmentMethod;
