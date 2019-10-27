import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { GeoCoordinates, PWS, ZimmermanWateringData } from "../../types";
import { validateValues } from "../weather";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";


/**
 * Calculates how much watering should be scaled based on weather and adjustment options using the Zimmerman method.
 * (https://github.com/rszimm/sprinklers_pi/wiki/Weather-adjustments#formula-for-setting-the-scale)
 */
async function calculateZimmermanWateringScale(
	adjustmentOptions: ZimmermanAdjustmentOptions,
	coordinates: GeoCoordinates,
	weatherProvider: WeatherProvider,
	pws?: PWS
): Promise< AdjustmentMethodResponse > {
	const wateringData: ZimmermanWateringData = await weatherProvider.getWateringData( coordinates, pws );

	// Temporarily disabled since OWM forecast data is checking if rain is forecasted for 3 hours in the future.
	/*
	// Don't water if it is currently raining.
	if ( wateringData && wateringData.raining ) {
		return {
			scale: 0,
			rawData: { raining: 1 },
			wateringData: wateringData
		}
	}
	*/

	const rawData = {
		weatherProvider: wateringData.weatherProvider,
		h: wateringData ? Math.round( wateringData.humidity * 100) / 100 : null,
		p: wateringData ? Math.round( wateringData.precip * 100 ) / 100 : null,
		t: wateringData ? Math.round( wateringData.temp * 10 ) / 10 : null,
		raining: wateringData ? ( wateringData.raining ? 1 : 0 ) : null
	};

	// Check to make sure valid data exists for all factors
	if ( !validateValues( [ "temp", "humidity", "precip" ], wateringData ) ) {
		// Default to a scale of 100% if fields are missing.
		throw new CodedError( ErrorCode.MissingWeatherField );
	}

	let humidityBase = 30, tempBase = 70, precipBase = 0;

	// Get baseline conditions for 100% water level, if provided
	humidityBase = adjustmentOptions.hasOwnProperty( "bh" ) ? adjustmentOptions.bh : humidityBase;
	tempBase = adjustmentOptions.hasOwnProperty( "bt" ) ? adjustmentOptions.bt : tempBase;
	precipBase = adjustmentOptions.hasOwnProperty( "br" ) ? adjustmentOptions.br : precipBase;

	let humidityFactor = ( humidityBase - wateringData.humidity ),
		tempFactor = ( ( wateringData.temp - tempBase ) * 4 ),
		precipFactor = ( ( precipBase - wateringData.precip ) * 200 );

	// Apply adjustment options, if provided, by multiplying the percentage against the factor
	if ( adjustmentOptions.hasOwnProperty( "h" ) ) {
		humidityFactor = humidityFactor * ( adjustmentOptions.h / 100 );
	}

	if ( adjustmentOptions.hasOwnProperty( "t" ) ) {
		tempFactor = tempFactor * ( adjustmentOptions.t / 100 );
	}

	if ( adjustmentOptions.hasOwnProperty( "r" ) ) {
		precipFactor = precipFactor * ( adjustmentOptions.r / 100 );
	}

	return {
		// Apply all of the weather modifying factors and clamp the result between 0 and 200%.
		scale: Math.floor( Math.min( Math.max( 0, 100 + humidityFactor + tempFactor + precipFactor ), 200 ) ),
		rawData: rawData,
		wateringData: wateringData
	}
}

export interface ZimmermanAdjustmentOptions extends AdjustmentOptions {
	/** Base humidity (as a percentage). */
	bh?: number;
	/** Base temperature (in Fahrenheit). */
	bt?: number;
	/** Base precipitation (in inches). */
	br?: number;
	/** The percentage to weight the humidity factor by. */
	h?: number;
	/** The percentage to weight the temperature factor by. */
	t?: number;
	/** The percentage to weight the precipitation factor by. */
	r?: number;
}


const ZimmermanAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateZimmermanWateringScale
};
export default ZimmermanAdjustmentMethod;
