import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { WateringData } from "../../types";


/**
 * Only delays watering if it is currently raining and does not adjust the watering scale.
 */
async function calculateRainDelayWateringScale( adjustmentOptions: RainDelayAdjustmentOptions, wateringData: WateringData | undefined ): Promise< AdjustmentMethodResponse > {
	const raining = wateringData && wateringData.raining;
	const d = adjustmentOptions && adjustmentOptions.hasOwnProperty( "d" ) ? adjustmentOptions.d : 24;
	return {
		scale: undefined,
		rawData: { raining: raining ? 1 : 0 },
		rainDelay: raining ? d : undefined
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
