import * as geoTZ from "geo-tz";
import { TZDate } from "@date-fns/tz";
import { GeoCoordinates, PWS, WeatherData, WateringData } from "../../types";
import { CodedError, ErrorCode } from "../../errors";
import { Cached, CachedResult } from "../../cache";
import { httpJSONRequest } from "../weather";
import { addDays, addHours, endOfDay, startOfDay } from "date-fns";

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
	 * Returns a boolean indicating if watering scales calculated using data from this WeatherProvider should be cached
	 * until the end of the day in timezone the data was for.
	 * @return a boolean indicating if watering scales calculated using data from this WeatherProvider should be cached.
	 */
	shouldCacheWateringScale(): boolean {
		return false;
	}

    private forcastCache: {[key: string]: Cached<object>} = {};
    private historicalCache: {[key: string]: Cached<object>} = {};

    private getCacheKey(coordinates: GeoCoordinates, pws?: PWS): string {
        return pws?.id || `${coordinates[0]};s${coordinates[1]}`
    }

    protected async getForcast(coordinates: GeoCoordinates, pws: PWS | undefined, url: string, headers?: any, body?: any): Promise<CachedResult<object>> {
        const key = this.getCacheKey(coordinates, pws);
        if (!this.forcastCache[key]) {
            this.forcastCache[key] = new Cached();
        }

        let tz = geoTZ.find(coordinates[0], coordinates[1])[0];

        const date = TZDate.tz(tz);
        const expiresAt = addHours(startOfDay(date), (Math.floor(date.getHours() / 6) + 1) * 6);

        return this.forcastCache[key].get(() => httpJSONRequest(url, headers, body), expiresAt);
    }

    protected async getHistorical(coordinates: GeoCoordinates, pws: PWS | undefined, url: string, headers?: any, body?: any): Promise<CachedResult<object>> {
        const key = this.getCacheKey(coordinates, pws);
        if (!this.forcastCache[key]) {
            this.forcastCache[key] = new Cached();
        }

        let tz = geoTZ.find(coordinates[0], coordinates[1])[0];

        const expiresAt = addDays(startOfDay(TZDate.tz(tz)), 1);

        return this.forcastCache[key].get(() => httpJSONRequest(url, headers, body), expiresAt);
    }
}
