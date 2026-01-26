import fs from "fs";
import path from "path";

import { GeoCoordinates } from "../../types";
import { CodedError, ErrorCode } from "../../errors";

export abstract class Geocoder {

	// Use same data directory as other persistent data
	// Using PERSISTENCE_LOCATION as per PR #144, but with path.join() for cross-platform compatibility (Copilot suggestion)
	private static dataDir = process.env.PERSISTENCE_LOCATION || path.join(__dirname, '..', '..', 'data');
	private static cacheFile = path.join(Geocoder.dataDir, 'geocoderCache.json');

	private cache: Map<string, GeoCoordinates>;

	public constructor() {
		// Ensure data directory exists
		if (!fs.existsSync(Geocoder.dataDir)) {
			fs.mkdirSync(Geocoder.dataDir, { recursive: true });
		}

		// Load the cache from disk.
		if ( fs.existsSync( Geocoder.cacheFile ) ) {
			this.cache = new Map( JSON.parse( fs.readFileSync( Geocoder.cacheFile, "utf-8" ) ) );
		} else {
			this.cache = new Map();
		}

		// Write the cache to disk every 5 minutes.
		setInterval( () => {
			this.saveCache();
		}, 5 * 60 * 1000 );
	}

	private saveCache(): void {
		try {
			// Ensure data directory exists before writing
			if (!fs.existsSync(Geocoder.dataDir)) {
				fs.mkdirSync(Geocoder.dataDir, { recursive: true });
			}
			fs.writeFileSync( Geocoder.cacheFile, JSON.stringify( Array.from( this.cache.entries() ) ) );
		} catch (err) {
			console.error("Error saving geocoder cache:", err);
		}
	}

	/**
	 * Converts a location name to geographic coordinates.
	 * @param location A location name.
	 * @return A Promise that will be resolved with the GeoCoordinates of the specified location, or rejected with a
	 * CodedError.
	 */
	protected abstract geocodeLocation( location: string ): Promise<GeoCoordinates>;

	/**
	 * Converts a location name to geographic coordinates, first checking the cache and updating it if necessary.
	 */
	public async getLocation( location: string ): Promise<GeoCoordinates> {
		if ( this.cache.has( location ) ) {
			const coords: GeoCoordinates = this.cache.get( location );
			if ( coords == null ) {
				// Throw an error if there are no results for this location.
				throw new CodedError( ErrorCode.NoLocationFound );
			} else {
				return coords;
			}
		}

		try {
			const coords: GeoCoordinates = await this.geocodeLocation( location );
			this.cache.set( location, coords );
			return coords;
		} catch ( ex ) {
			if ( ex instanceof CodedError && ex.errCode == ErrorCode.NoLocationFound ) {
				// Store in the cache the fact that this location has no results.
				this.cache.set( location, null );
			}

			throw ex;
		}
	}
}