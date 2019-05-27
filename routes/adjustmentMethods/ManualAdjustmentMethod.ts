import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";


/**
 * Only returns time data.
 */
async function calculateManualWateringScale( ): Promise< AdjustmentMethodResponse > {
	return {
		scale: -1
	}
}

const ManualAdjustmentMethod: AdjustmentMethod = {
	calculateWateringScale: calculateManualWateringScale
};
export default ManualAdjustmentMethod;
