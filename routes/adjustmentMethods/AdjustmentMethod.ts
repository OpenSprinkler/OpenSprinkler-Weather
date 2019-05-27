import { GeoCoordinates, WateringData, WeatherProvider } from "../../types";

export interface AdjustmentMethod {
	/**
	 * Calculates the percentage that should be used to scale watering time.
	 * @param adjustmentOptions The user-specified options for the calculation, or undefined/null if no custom values
	 * are to be used. No checks will be made to ensure the AdjustmentOptions are the correct type that the function
	 * is expecting or to ensure that any of its fields are valid.
	 * @param wateringData The basic weather information of the watering site. This may be undefined if an error occurred
	 * while retrieving the data.
	 * @param coordinates The coordinates of the watering site.
	 * @param weatherProvider The WeatherProvider that should be used if the adjustment method needs to obtain any more
	 * weather data.
	 * @return A Promise that will be resolved with the result of the calculation.
	 */
	calculateWateringScale(
		adjustmentOptions: AdjustmentOptions,
		wateringData: WateringData | undefined,
		coordinates: GeoCoordinates,
		weatherProvider: WeatherProvider
	): Promise< AdjustmentMethodResponse >;
}

export interface AdjustmentMethodResponse {
	/**
	 * The percentage that should be used to scale the watering level. This should be an integer between 0-200 (inclusive)
	 * for a normal calculation, some negative value that the OS firmware will understand to indicate special behavior,
	 * or undefined if the watering level could not be calculated for some reason. If this is set to undefined and the
	 * `errorMessage` property is not set, the user will be sent a reasonable scale value instead (such as a default
	 * value of 100% or a value provided by a different AdjustmentMethod).
	 * If watering should be delayed because it is currently raining, this value should typically be set to 0 (but it may
	 * be negative if the OS firmware has been configured to expect such a value).
	 */
	scale: number;
	/** The raw data that was used to calculate the watering scale. This will be sent directly to the OS controller, so
	 * it should format each field in a way that the controller understands and round numbers appropriately to remove
	 * excessive figures. If no data was used (e.g. an error occurred), this should be undefined.
	 */
	rawData?: object;
	/**
	 * A human-readable error message to send to the user if an error occurred while calculating the watering scale and
	 * the user should be notified of the error. This should typically be set if the error was the user's fault, and
	 * should be undefined if an internal error occurred. If this field is set, it will be sent to the user as an
	 * error message instead of the calculated watering scale.
	 */
	errorMessage?: string;
	/**
	 * How long watering should be delayed for (in hours) due to rain, or undefined if watering should not be delayed for a
	 * specific amount of time (either it should be delayed indefinitely or it should not be delayed at all). This
	 * property has no effect on its own and should be used in conjunction with the `scale` property (by setting it to
	 * 0 or some negative value that the OS firmware will understand).
	 */
	rainDelay?: number;
}

export interface AdjustmentOptions {}
