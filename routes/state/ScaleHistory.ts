import * as fs from "fs";
import { GeoCoordinates } from "../../types";

/**
 * Daily watering-scale history behind the firmware's multi-day adjustment (wto.mda).
 *
 * The firmware (custom fork, weather.cpp) parses an optional `scales=[n,...]` array from the
 * watering response into md_scales/wls: index N-1 holds the scale an interval program with an
 * N-day interval should use — the average watering level over the most recent N weather days.
 * This module records the scale this service computed for each local day and produces those
 * rolling averages. It is deliberately provider- and method-agnostic: whatever today's decision
 * was (including a skip's 0%), that IS the day's watering level.
 *
 * Storage mirrors FileStateStore: one JSON file, in-memory-first, atomic temp-file rename.
 */

/** Mirror of the firmware's MAX_N_MD_SCALES (weather.h). */
export const MAX_MULTI_DAY_SCALES = 14;

interface ScaleHistoryFile {
	[ locationKey: string ]: { [ dateKey: string ]: number };
}

const DEFAULT_HISTORY_FILE = "scaleHistory.json";

export class FileScaleHistory {
	private readonly path: string;
	private cache: ScaleHistoryFile = {};
	private loaded = false;
	private writeSeq = 0;

	public constructor( filePath: string ) {
		this.path = filePath;
	}

	private load(): void {
		if ( this.loaded ) return;
		this.loaded = true;
		try {
			if ( fs.existsSync( this.path ) ) {
				const parsed = JSON.parse( fs.readFileSync( this.path, "utf8" ) );
				if ( parsed && typeof parsed === "object" ) this.cache = parsed;
			}
		} catch ( err ) {
			console.error( "ScaleHistory: failed to load state file; starting empty.", err );
			this.cache = {};
		}
	}

	/** Record (or overwrite) the scale for one local day, pruning beyond the rolling window. */
	public record( locationKey: string, dateKey: string, scale: number ): void {
		this.load();
		const days = this.cache[ locationKey ] || {};
		days[ dateKey ] = scale;
		const keep = Object.keys( days ).sort().slice( -MAX_MULTI_DAY_SCALES );
		this.cache[ locationKey ] = {};
		for ( const key of keep ) this.cache[ locationKey ][ key ] = days[ key ];
		const tmp = `${ this.path }.${ process.pid }.${ this.writeSeq++ }.tmp`;
		fs.writeFileSync( tmp, JSON.stringify( this.cache ) );
		fs.renameSync( tmp, this.path );
	}

	/**
	 * Rolling averages, newest-first window: result[i] averages the most recent i+1 recorded
	 * days. Length = number of recorded days (≤ MAX_MULTI_DAY_SCALES); an interval longer than
	 * the list uses the longest average available (firmware behavior), so short history simply
	 * yields a short array rather than fabricated values.
	 */
	public rollingScales( locationKey: string ): number[] {
		this.load();
		const days = this.cache[ locationKey ] || {};
		const newestFirst = Object.keys( days ).sort().reverse().map( ( key ) => days[ key ] );
		const out: number[] = [];
		let sum = 0;
		for ( let i = 0; i < newestFirst.length; i++ ) {
			sum += newestFirst[ i ];
			out.push( Math.round( sum / ( i + 1 ) ) );
		}
		return out;
	}
}

/** Coordinates rounded to ~100 m so geocoder jitter for one location shares one history. */
export function scaleHistoryKey( coordinates: GeoCoordinates ): string {
	return `${ coordinates[ 0 ].toFixed( 3 ) },${ coordinates[ 1 ].toFixed( 3 ) }`;
}

/** Local calendar date for the controller's timezone offset (minutes). */
export function localDateKey( timezoneMinutes: number, nowMs: number = Date.now() ): string {
	return new Date( nowMs + timezoneMinutes * 60_000 ).toISOString().slice( 0, 10 );
}

const sharedHistory = new FileScaleHistory( process.env.SCALE_HISTORY_FILE || DEFAULT_HISTORY_FILE );

/**
 * Record today's computed scale and return the rolling multi-day averages. Never throws for
 * storage problems — the watering response must not fail over history bookkeeping.
 */
export function recordDailyScale(
	coordinates: GeoCoordinates, timezoneMinutes: number, scale: number,
	history: FileScaleHistory = sharedHistory,
): number[] {
	try {
		const key = scaleHistoryKey( coordinates );
		history.record( key, localDateKey( timezoneMinutes ), scale );
		return history.rollingScales( key );
	} catch ( err ) {
		console.error( "ScaleHistory: record failed; omitting multi-day scales.", err );
		return [];
	}
}
