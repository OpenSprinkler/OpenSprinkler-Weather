import * as NodeCache from "node-cache";
import { GeoCoordinates, PWS } from "./types";
import { AdjustmentOptions } from "./routes/adjustmentMethods/AdjustmentMethod";
import * as moment from "moment-timezone";
import * as geoTZ from "geo-tz";
import { Moment } from "moment-timezone/moment-timezone";

export default class WateringScaleCache {
	private readonly cache: NodeCache = new NodeCache();

	/**
	 * Stores the results of a watering scale calculation. The scale will be cached until the end of the day in the local
	 * timezone of the specified coordinates. If a scale has already been cached for the specified calculation parameters,
	 * this method will have no effect.
	 * @param adjustmentMethodId The ID of the AdjustmentMethod used to calculate this watering scale. This value should
	 * have the appropriate bits set for any restrictions that were used.
	 * @param coordinates The coordinates the watering scale was calculated for.
	 * @param pws The PWS used to calculate the watering scale, or undefined if one was not used.
	 * @param adjustmentOptions Any user-specified adjustment options that were used when calculating the watering scale.
	 * @param wateringScale The results of the watering scale calculation.
	 */
	public storeWateringScale(
		adjustmentMethodId: number,
		coordinates: GeoCoordinates,
		pws: PWS,
		adjustmentOptions: AdjustmentOptions,
		wateringScale: CachedScale
	): void {
		// The end of the day in the controller's timezone.
		const expirationDate: Moment = moment().tz( geoTZ( coordinates[ 0 ], coordinates[ 1 ] )[ 0 ] ).endOf( "day" );
		const ttl: number = ( expirationDate.unix() - moment().unix() );
		const key = this.makeKey( adjustmentMethodId, coordinates, pws, adjustmentOptions );
		this.cache.set( key, wateringScale, ttl );
	}

	/**
	 * Retrieves a cached scale that was previously calculated with the given parameters.
	 * @param adjustmentMethodId The ID of the AdjustmentMethod used to calculate this watering scale. This value should
	 * have the appropriate bits set for any restrictions that were used.
	 * @param coordinates The coordinates the watering scale was calculated for.
	 * @param pws The PWS used to calculate the watering scale, or undefined if one was not used.
	 * @param adjustmentOptions Any user-specified adjustment options that were used when calculating the watering scale.
	 * @return The cached result of the watering scale calculation, or undefined if no values were cached.
	 */
	public getWateringScale(
		adjustmentMethodId: number,
		coordinates: GeoCoordinates,
		pws: PWS,
		adjustmentOptions: AdjustmentOptions
	): CachedScale | undefined {
		const key = this.makeKey( adjustmentMethodId, coordinates, pws, adjustmentOptions );
		return this.cache.get( key );
	}

	private makeKey(
		adjustmentMethodId: number,
		coordinates: GeoCoordinates,
		pws: PWS,
		adjustmentOptions: AdjustmentOptions
	): string {
		return `${ adjustmentMethodId }#${ coordinates.join( "," ) }#${ pws ? pws.id : "" }#${ JSON.stringify( adjustmentOptions ) }`
	}
}

export interface CachedScale {
	scale: number;
	rawData: object;
	rainDelay: number;
}
