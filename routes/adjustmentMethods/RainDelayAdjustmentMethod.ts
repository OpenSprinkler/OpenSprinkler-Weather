import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { BaseWateringData, GeoCoordinates, PWS, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";


/**
 * Only delays watering if it is currently raining and does not adjust the watering scale.
 */
async function calculateRainDelayWateringScale(
	adjustmentOptions: RainDelayAdjustmentOptions,
	coordinates: GeoCoordinates,
	weatherProvider: WeatherProvider,
	pws?: PWS
): Promise< AdjustmentMethodResponse > {
	const wateringDataArr: ZimmermanWateringData[] = await weatherProvider.getWateringData( coordinates, pws );
	// Most recent day of data is the last in the data array.
	const wateringData: ZimmermanWateringData = wateringDataArr[wateringDataArr.length-1];
	const raining = wateringData && wateringData.raining;
	const d = adjustmentOptions.hasOwnProperty( "d" ) ? adjustmentOptions.d : 24;
	return {
		scale: undefined,
		rawData: {
			wp: wateringData.weatherProvider,
			raining: raining ? 1 : 0,
			},
		rainDelay: raining ? d : undefined,
		wateringData: wateringData
	}
}

export interface RainDelayAdjustmentOptions extends AdjustmentOptions {
	/** The rain delay to use (in hours). */
	d?: number;
}


const RainDelayAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateRainDelayWateringScale
};
export default RainDelayAdjustmentMethod;
