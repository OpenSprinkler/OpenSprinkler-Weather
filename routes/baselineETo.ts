/* This script requires the file Baseline_ETo_Data.bin file to be created in the baselineEToData directory. More
 * information about this is available in /baselineEToData/README.md.
 */
import * as express from "express";
import * as fs from "fs";
import { GeoCoordinates } from "../types";
import { getParameter, resolveCoordinates } from "./weather";

const DATA_FILE = __dirname + "/../../baselineEToData/Baseline_ETo_Data.bin";
let FILE_META: FileMeta;

readFileHeader().then( ( fileMeta ) => {
	FILE_META = fileMeta;
	console.log( "Loaded baseline ETo data." );
} ).catch( ( err ) => {
	console.error( "An error occurred while reading the annual ETo data file header. Baseline ETo endpoint will be unavailable.", err );
} );

export const getBaselineETo = async function( req: express.Request, res: express.Response ) {
	const location: string	= getParameter( req.query.loc );

	// Error if the file meta was not read (either the file is still being read or an error occurred and it could not be read).
	if ( !FILE_META ) {
		res.status( 503 ).send( "Baseline ETo calculation is currently unavailable." );
		return;
	}

	// Attempt to resolve provided location to GPS coordinates.
	let coordinates: GeoCoordinates;
	try {
		coordinates = await resolveCoordinates( location );
	} catch (err) {
		res.status( 404 ).send( `Error: Unable to resolve coordinates for location (${ err })` );
		return;
	}

	let eto: number;
	try {
		eto = await calculateAverageDailyETo( coordinates );
	} catch ( err ) {
		/* Use a 500 error code if a more appropriate error code is not specified, and prefer the error message over the
			full error object if a message is defined. */
		res.status( err.code || 500 ).send( err.message || err );
		return;
	}

	res.status( 200 ).json( {
		eto: Math.round( eto * 1000 ) / 1000
	} );
};

/**
 * Retrieves the average daily potential ETo for the specified location.
 * @param coordinates The location to retrieve the ETo for.
 * @return A Promise that will be resolved with the average potential ETo (in inches per day), or rejected with an error
 * (which may include a message and the appropriate HTTP status code to send the user) if the ETo cannot be retrieved.
 */
async function calculateAverageDailyETo( coordinates: GeoCoordinates ): Promise< number > {
	// Convert geographic coordinates into image coordinates.
	const x = Math.floor( FILE_META.origin.x + FILE_META.width * coordinates[ 1 ] / 360 );
	// Account for the 30+10 cropped degrees.
	const y = Math.floor( FILE_META.origin.y - FILE_META.height * coordinates[ 0 ] / ( 180 - 30 - 10 ) );

	// The offset (from the start of the data block) of the relevant pixel.
	const offset = y * FILE_META.width + x;

	/* Check if the specified coordinates were invalid or correspond to a part of the map that was cropped. */
	if ( offset < 0 || offset > FILE_META.width * FILE_META.height ) {
		throw { message: "Specified location is out of bounds.", code: 404 };
	}

	let byte: number;
	try {
		// Skip the 32 byte header.
		byte = await getByteAtOffset( offset + 32 );
	} catch ( err ) {
		console.error( `An error occurred while reading the baseline ETo data file for coordinates ${ coordinates }:`, err );
		throw { message: "An unexpected error occurred while retrieving the baseline ETo for this location.", code: 500 }
	}

	// The maximum value indicates that no data is available for this point.
	if ( ( byte === ( 1 << FILE_META.bitDepth ) - 1 ) ) {
		throw { message: "ETo data is not available for this location.", code: 404 };
	}

	return ( byte * FILE_META.scalingFactor + FILE_META.minimumETo ) / 365;
}

/**
 * Returns the byte at the specified offset in the baseline ETo data file.
 * @param offset The offset from the start of the file (the start of the header, not the start of the data block).
 * @return A Promise that will be resolved with the unsigned representation of the byte at the specified offset, or
 * rejected with an Error if an error occurs.
 */
function getByteAtOffset( offset: number ): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		const stream = fs.createReadStream( DATA_FILE, { start: offset, end: offset } );

		stream.on( "error", ( err ) => {
			reject( err );
		} );

		// There's no need to wait for the "end" event since the "data" event will contain the single byte being read.
		stream.on( "data", ( data ) => {
			resolve( data[ 0 ] );
		} );
	} );
}

/**
 * Parses information from the baseline ETo data file from the file header. The header format is documented in the README.
 * @return A Promise that will be resolved with the parsed header information, or rejected with an error if the header
 * is invalid or cannot be read.
 */
function readFileHeader(): Promise< FileMeta > {
	return new Promise( ( resolve, reject) => {
		const stream = fs.createReadStream( DATA_FILE, { start: 0, end: 32 } );
		const headerArray: number[] = [];

		stream.on( "error", ( err ) => {
			reject( err );
		} );

		stream.on( "data", ( data: number[] ) => {
			headerArray.push( ...data );
		} );

		stream.on( "end", () => {
			const buffer = Buffer.from( headerArray );
			const version = buffer.readUInt8( 0 );
			if ( version !== 1 ) {
				reject( `Unsupported data file version ${ version }. The maximum supported version is 1.` );
				return;
			}

			const width = buffer.readUInt32BE( 1 );
			const height = buffer.readUInt32BE( 5 );
			const fileMeta: FileMeta = {
				version: version,
				width: width,
				height: height,
				bitDepth: buffer.readUInt8( 9 ),
				minimumETo: buffer.readFloatBE( 10 ),
				scalingFactor: buffer.readFloatBE( 14 ),
				origin: {
					x: Math.floor( width / 2 ),
					// Account for the 30+10 cropped degrees.
					y: Math.floor( height / ( 180 - 10 - 30) * ( 90 - 10 ) )
				}
			};

			if ( fileMeta.bitDepth === 8 ) {
				resolve( fileMeta );
			} else {
				reject( "Bit depths other than 8 are not currently supported." );
			}
		} );
	} );
}

/** Information about the data file parsed from the file header. */
interface FileMeta {
	version: number;
	/** The width of the image (in pixels). */
	width: number;
	/** The height of the image (in pixels). */
	height: number;
	/** The number of bits used for each pixel. */
	bitDepth: number;
	/** The ETo that a pixel value of 0 represents (in inches/year). */
	minimumETo: number;
	/** The ratio of an increase in pixel value to an increase in ETo (in inches/year). */
	scalingFactor: number;
	/**
	 * The pixel coordinates of the geographic coordinates origin. These coordinates are off-center because the original
	 * image excludes the northernmost 10 degrees and the southernmost 30 degrees.
	 */
	origin: {
		x: number;
		y: number;
	};
}
