import { GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";

/**
 * A WeatherProvider calls other WeatherProviders until one successfully returns a value.
 * This is a special utility WeatherProvider, and should NOT be selected with the WEATHER_PROVIDER environment variable.
 */
export default class CompositeWeatherProvider implements WeatherProvider {

	private readonly weatherProviders: WeatherProvider[];

	public constructor( weatherProviders: WeatherProvider[] ) {
		this.weatherProviders = weatherProviders;
	}

	public async getWateringData( coordinates : GeoCoordinates ): Promise< WateringData > {
		return await this.callMethod( "getWateringData", coordinates ) as WateringData;
	}

	public async getWeatherData( coordinates : GeoCoordinates ): Promise< WeatherData > {
		return await this.callMethod( "getWeatherData", coordinates ) as WeatherData;
	}

	/**
	 * Calls a specified function in each WeatherProvider until one returns a non-undefined value. If the function is
	 * not defined for a WeatherProvider, it will be skipped.
	 * @param func The name of the function to call.
	 * @param args The arguments to pass to the function.
	 * @return A promise that will be resolved with the first non-undefined value returned by a WeatherProvider, or
	 * resolved with undefined if none of the WeatherProviders returned a value.
	 */
	private async callMethod( func: "getWateringData" | "getWeatherData", ...args: any ): Promise< unknown > {
		for ( const weatherProvider of this.weatherProviders ) {
			if ( !weatherProvider[ func ] ) {
				continue;
			}

			// @ts-ignore
			const result = await weatherProvider[ func ]( ...args );
			if ( result ) {
				return result;
			}
		}
		return undefined;
	}
}
