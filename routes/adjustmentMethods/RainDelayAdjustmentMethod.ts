import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { GeoCoordinates, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";


/**
 * Only delays watering if it is currently raining and does not adjust the watering scale.
 */
async function calculateRainDelayWateringScale( adjustmentOptions: RainDelayAdjustmentOptions, coordinates: GeoCoordinates, weatherProvider: WeatherProvider ): Promise< AdjustmentMethodResponse > {
	const wateringData: ZimmermanWateringData = await weatherProvider.getWateringData( coordinates );
	const raining = wateringData && wateringData.raining;
	const d = adjustmentOptions.hasOwnProperty( "d" ) ? adjustmentOptions.d : 24;
	return {
		scale: undefined,
		rawData: { raining: raining ? 1 : 0 },
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
