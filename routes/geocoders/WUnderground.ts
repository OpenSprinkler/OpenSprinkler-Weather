import { GeoCoordinates } from "../../types";
import { CodedError, ErrorCode } from "../../errors";
import { httpJSONRequest } from "../weather";
import { Geocoder } from "./Geocoder";

export default class WUnderground extends Geocoder {
	public async geocodeLocation( location: string ): Promise<GeoCoordinates> {
		// Generate URL for autocomplete request
		const url = "http://autocomplete.wunderground.com/aq?h=0&query=" +
			encodeURIComponent( location );

		let data;
		try {
			data = await httpJSONRequest( url );
		} catch ( err ) {
			// If the request fails, indicate no data was found.
			throw new CodedError( ErrorCode.LocationServiceApiError );
		}

		// Check if the data is valid
		if ( typeof data.RESULTS === "object" && data.RESULTS.length && data.RESULTS[ 0 ].tz !== "MISSING" ) {

			// If it is, reply with an array containing the GPS coordinates
			return [ parseFloat( data.RESULTS[ 0 ].lat ), parseFloat( data.RESULTS[ 0 ].lon ) ];
		} else {

			// Otherwise, indicate no data was found
			throw new CodedError( ErrorCode.NoLocationFound );
		}
	}
}