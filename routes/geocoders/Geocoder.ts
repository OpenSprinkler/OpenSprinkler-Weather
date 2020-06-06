import { GeoCoordinates } from "../../types";

export abstract class Geocoder {
	/**
	 * Converts a location name to geographic coordinates.
	 * @param location A location name.
	 * @return A Promise that will be resolved with the GeoCoordinates of the specified location, or rejected with a
	 * CodedError.
	 */
	public abstract geocodeLocation( location: string ): Promise<GeoCoordinates>;
}
