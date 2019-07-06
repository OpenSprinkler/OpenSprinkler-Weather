import { BaseWateringData, GeoCoordinates, PWS } from "../../types";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";


export interface AdjustmentMethod {
	/**
	 * Calculates the percentage that should be used to scale watering time.
	 * @param adjustmentOptions The user-specified options for the calculation. No checks will be made to ensure the
	 * AdjustmentOptions are the correct type that the function is expecting or to ensure that any of its fields are valid.
	 * @param coordinates The coordinates of the watering site.
	 * @param weatherProvider The WeatherProvider that should be used if the adjustment method needs to obtain any
	 * weather data.
	 * @param pws The PWS to retrieve weather data from, or undefined if a PWS should not be used. If the implementation
	 * of this method does not have PWS support, this parameter may be ignored and coordinates may be used instead.
	 * @return A Promise that will be resolved with the result of the calculation, or rejected with an error message if
	 * the watering scale cannot be calculated.
	 * @throws An error message can be thrown if an error occurs while calculating the watering scale.
	 */
	calculateWateringScale(
		adjustmentOptions: AdjustmentOptions,
		coordinates: GeoCoordinates,
		weatherProvider: WeatherProvider,
		pws?: PWS
	): Promise< AdjustmentMethodResponse >;
}

export interface AdjustmentMethodResponse {
	/**
	 * The percentage that should be used to scale the watering level. This should be an integer between 0-200 (inclusive),
	 * or undefined if the watering level should not be changed.
	 */
	scale: number | undefined;
	/**
	 * The raw data that was used to calculate the watering scale. This will be sent directly to the OS controller, so
	 * each field should be formatted in a way that the controller understands and numbers should be rounded
	 * appropriately to remove excessive figures. If no data was used (e.g. an error occurred), this should be undefined.
	 */
	rawData?: object;
	/**
	 * How long watering should be delayed for (in hours) due to rain, or undefined if watering should not be delayed
	 * for a specific amount of time (either it should be delayed indefinitely or it should not be delayed at all). This
	 * property will not stop watering on its own, and the `scale` property should be set to 0 to actually prevent
	 * watering.
	 */
	rainDelay?: number;
	// TODO consider removing this field and breaking backwards compatibility to handle all errors consistently.
	/**
	 * An message to send to the OS firmware to indicate that an error occurred while calculating the watering
	 * scale and the returned scale either defaulted to some reasonable value or was calculated with incomplete data.
	 * Older firmware versions will ignore this field (they will silently swallow the error and use the returned scale),
	 * but newer firmware versions may be able to alert the user that an error occurred and/or default to a
	 * user-configured watering scale instead of using the one returned by the AdjustmentMethod.
	 */
	errorMessage?: string;
	/** The data that was used to calculate the watering scale, or undefined if no data was used. */
	wateringData: BaseWateringData;
}

export interface AdjustmentOptions {
	/** The ID of the PWS to use, prefixed with "pws:". */
	pws?: string;
	/** The API key to use to access PWS data. */
	key?: string;
}
