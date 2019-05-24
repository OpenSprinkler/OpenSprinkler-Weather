import { EToData } from "./types";

// The implementation of this algorithm was guided by a step-by-step breakdown (http://edis.ifas.ufl.edu/pdffiles/ae/ae45900.pdf)
/**
 * Calculates the reference evapotranspiration using the Penman-Monteith (FAO-56) method (http://www.fao.org/3/X0490E/x0490e07.htm).
 *
 * @param etoData The data to calculate the ETo with.
 * @param elevation The elevation above sea level of the watering site (in meters).
 * @return The reference evapotranspiration (in millimeters per day).
 */
export function calculateETo( etoData: EToData, elevation: number ): number {
	const avgTemp = ( etoData.maxTemp + etoData.minTemp ) / 2;

	// Adjust the wind speed to a 2m height.
	const windSpeed = etoData.windSpeed * 4.87 / Math.log( 67.8 * etoData.windSpeedMeasurementHeight - 5.42 );

	const saturationVaporPressureCurveSlope = 4098 * 0.6108 * Math.exp( 17.27 * avgTemp / ( avgTemp + 237.3 ) ) / Math.pow( avgTemp + 237.3, 2 );

	const pressure = 101.3 * Math.pow( ( 293 - 0.0065 * elevation ) / 293, 2.36 );

	const psychrometricConstant = 0.000665 * pressure;

	const deltaTerm = saturationVaporPressureCurveSlope / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

	const psiTerm = psychrometricConstant / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

	const tempTerm = ( 900 / ( avgTemp + 273 ) ) * windSpeed;

	const minSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * etoData.minTemp / ( etoData.minTemp + 237.3 ) );

	const maxSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * etoData.maxTemp / ( etoData.maxTemp + 237.3 ) );

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

	const netOutgoingLongWaveRadiation = 4.903e-9 * ( Math.pow( etoData.maxTemp + 273.16, 4 ) + Math.pow( etoData.minTemp + 273.16, 4 ) ) / 2 * ( 0.34 - 0.14 * Math.sqrt( actualVaporPressure ) ) * ( 1.35 * solarRadiation / clearSkyRadiation - 0.35);

	const netRadiation = netShortWaveRadiation - netOutgoingLongWaveRadiation;

	const radiationTerm = deltaTerm * 0.408 * netRadiation;

	const windTerm = psiTerm * tempTerm * ( avgSaturationVaporPressure - actualVaporPressure );

	return windTerm + radiationTerm;
}
