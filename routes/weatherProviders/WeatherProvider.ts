import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export class WeatherProvider {
	/**
	 * Retrieves weather data necessary for watering level calculations.
	 * @param coordinates The coordinates to retrieve the watering data for.
	 * @param pws The PWS to retrieve the weather from, or undefined if a PWS should not be used. If the implementation
	 * of this method does not have PWS support, this parameter may be ignored and coordinates may be used instead.
	 * @return A Promise that will be resolved with the WateringData if it is successfully retrieved,
	 * or rejected with a CodedError if an error occurs while retrieving the WateringData (or the WeatherProvider
	 * does not support this method).
	 */
	getWateringData( coordinates: GeoCoordinates, pws?: PWS ): Promise< WateringData[] > {
		throw new CodedError( ErrorCode.UnsupportedAdjustmentMethod );
	}

	/**
	 * Retrieves the current weather data for usage in the mobile app.
	 * @param coordinates The coordinates to retrieve the weather for
	 * @return A Promise that will be resolved with the WeatherData if it is successfully retrieved,
	 * or rejected with an error message if an error occurs while retrieving the WeatherData or the WeatherProvider does
	 * not support this method.
	 */
	getWeatherData( coordinates : GeoCoordinates, pws?: PWS ): Promise< WeatherData > {
		throw "Selected WeatherProvider does not support getWeatherData";
	}

	/**
	 * Retrieves the data necessary for calculating potential ETo.
	 * @param coordinates The coordinates to retrieve the data for.
	 * @return A Promise that will be resolved with an array of the maximum amount of possible days of EToData according
	 * to the provider if it is successfully retrieved, or rejected with a CodedError if an error occurs while retrieving
	 * the EToData (or the WeatherProvider does not support this method). Ensure this array is returned in chronological order.
	 */
	getEToData( coordinates: GeoCoordinates, pws?: PWS  ): Promise< EToData[] > {
		throw new CodedError( ErrorCode.UnsupportedAdjustmentMethod );
	};

	/**
	 * Returns a boolean indicating if watering scales calculated using data from this WeatherProvider should be cached
	 * until the end of the day in timezone the data was for.
	 * @return a boolean indicating if watering scales calculated using data from this WeatherProvider should be cached.
	 */
	shouldCacheWateringScale(): boolean {
		return false;
	}
}
