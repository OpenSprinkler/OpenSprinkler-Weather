import { GeoCoordinates, WateringData, WeatherData } from "../../types";

export class WeatherProvider {
	/**
	 * Retrieves weather data necessary for watering level calculations.
	 * @param coordinates The coordinates to retrieve the watering data for.
	 * @return A Promise that will be resolved with the WateringData if it is successfully retrieved,
	 * or rejected with an error message if an error occurs while retrieving the WateringData or the WeatherProvider
	 * does not support this method.
	 */
	getWateringData( coordinates : GeoCoordinates ): Promise< WateringData > {
		throw "Selected WeatherProvider does not support getWateringData";
	}

	/**
	 * Retrieves the current weather data for usage in the mobile app.
	 * @param coordinates The coordinates to retrieve the weather for
	 * @return A Promise that will be resolved with the WeatherData if it is successfully retrieved,
	 * or rejected with an error message if an error occurs while retrieving the WeatherData or the WeatherProvider does
	 * not support this method.
	 */
	getWeatherData( coordinates : GeoCoordinates ): Promise< WeatherData > {
		throw "Selected WeatherProvider does not support getWeatherData";
	}
}
