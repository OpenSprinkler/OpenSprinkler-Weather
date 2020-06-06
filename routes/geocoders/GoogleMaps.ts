import { GeoCoordinates } from "../../types";
import { CodedError, ErrorCode } from "../../errors";
import { httpJSONRequest } from "../weather";
import { Geocoder } from "./Geocoder";

export default class GoogleMaps extends Geocoder {
	private readonly API_KEY: string;

	public constructor() {
		super();
		this.API_KEY = process.env.GOOGLE_MAPS_API_KEY;
		if ( !this.API_KEY ) {
			throw "GOOGLE_MAPS_API_KEY environment variable is not defined.";
		}
	}

	public async geocodeLocation( location: string ): Promise<GeoCoordinates> {
		// Generate URL for Google Maps geocoding request
		const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${ this.API_KEY }&address=${ encodeURIComponent( location ) }`;

		let data;
		try {
			data = await httpJSONRequest( url );
		} catch ( err ) {
			// If the request fails, indicate no data was found.
			throw new CodedError( ErrorCode.LocationServiceApiError );
		}

		if ( !data.results.length ) {
			throw new CodedError( ErrorCode.NoLocationFound );
		}

		return [ data.results[ 0 ].geometry.location.lat, data.results[ 0 ].geometry.location.lng ];
	}
}
