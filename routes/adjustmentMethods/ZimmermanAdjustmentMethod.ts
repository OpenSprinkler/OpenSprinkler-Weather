import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { GeoCoordinates, PWS, WateringData } from "../../types";
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
	const wateringData: WateringData[] = await weatherProvider.getWateringData( coordinates, pws );

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

	// Flip the array so it is in reverse chronological order
	// Now the order is indexed by days going backwards, with 0 index referring to the most recent day of data.
	wateringData.reverse();

	// Map data into proper format
	const rawData = wateringData.map(data => {
		return {
			wp: data.weatherProvider,
			h: data ? Math.round( data.humidity * 100) / 100 : null,
			p: data ? Math.round( data.precip * 100 ) / 100 : null,
			t: data ? Math.round( data.temp * 10 ) / 10 : null,
			raining: data ? ( data.raining ? 1 : 0 ) : null
		};
	});

	for ( let i = 0; i < wateringData.length; i++ ) {
		// Check to make sure valid data exists for all factors
		if ( !validateValues( [ "temp", "humidity", "precip" ], wateringData[i] ) ) {
			// Default to a scale of 100% if fields are missing.
			throw new CodedError( ErrorCode.MissingWeatherField );
		}
	}

	let humidityBase = 30, tempBase = 70, precipBase = 0;

	// Get baseline conditions for 100% water level, if provided
	humidityBase = adjustmentOptions.hasOwnProperty( "bh" ) ? adjustmentOptions.bh : humidityBase;
	tempBase = adjustmentOptions.hasOwnProperty( "bt" ) ? adjustmentOptions.bt : tempBase;
	precipBase = adjustmentOptions.hasOwnProperty( "br" ) ? adjustmentOptions.br : precipBase;

	// Compute uncapped scales for each day
	const uncappedScales = wateringData.map(data => {
		let humidityFactor = ( humidityBase - data.humidity ),
			tempFactor = ( ( data.temp - tempBase ) * 4 ),
			precipFactor = ( ( precipBase - data.precip ) * 200 );

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

		return 100 + humidityFactor + tempFactor + precipFactor;
	});

	// Compute a rolling average for each scale and cap them to 0-200
	let sum = 0;
	let count = 1;
	const scales = uncappedScales.map(scale => {
		sum += scale;
		const result = Math.floor( Math.min( Math.max( 0, sum / count ), 200 ) );
		count ++;
		return result;
	});

	return {
		// Apply all of the weather modifying factors and clamp the result between 0 and 200%.
		scale: scales[0],
		rawData: rawData[0],
		wateringData: wateringData[0],
		scales: scales
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
