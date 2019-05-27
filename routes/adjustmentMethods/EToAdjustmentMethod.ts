import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { EToData, GeoCoordinates, WateringData, WeatherProvider } from "../../types";
import { calculateETo } from "../../EToCalculator";


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

	if ( wateringData && wateringData.raining ) {
		return {
			scale: 0,
			rawData: { raining: 1 }
		}
	}

	const etoData: EToData = await weatherProvider.getEToData( coordinates );

	if ( !etoData ) {
		return {
			scale: undefined
		};
	}

	// TODO this default baseETo is not based on any data. Automatically determine ETo based on geographic location instead.
	let elevation = 150, baseETo = 2;

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
			baseETo: Math.round( baseETo * 100) / 100,
			eto: Math.round( eto * 100) / 100,
			radiation: Math.round( etoData.solarRadiation * 100) / 100
		}
	}
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
