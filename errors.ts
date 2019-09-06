export enum ErrorCode {
	/** No error occurred. This code should be included with all successful responses because the firmware expects some
	 * code to be present.
	 */
	NoError = 0,

	/** The watering scale could not be calculated due to a problem with the weather information. */
	BadWeatherData = 1,
	/** Data for a full 24 hour period was not available. */
	InsufficientWeatherData = 10,
	/** A necessary field was missing from weather data returned by the API. */
	MissingWeatherField = 11,
	/** An HTTP or parsing error occurred when retrieving weather information. */
	WeatherApiError = 12,

	/** The specified location name could not be resolved. */
	LocationError = 2,
	/** An HTTP or parsing error occurred when resolving the location. */
	LocationServiceApiError = 20,
	/** No matches were found for the specified location name. */
	NoLocationFound = 21,
	/** The location name was specified in an invalid format (e.g. a PWS ID). */
	InvalidLocationFormat = 22,

	/** An Error related to personal weather stations. */
	PwsError = 3,
	/** The PWS ID did not use the correct format. */
	InvalidPwsId = 30,
	/** The PWS API key did not use the correct format. */
	InvalidPwsApiKey = 31,
	// TODO use this error code.
	/** The PWS API returned an error because a bad API key was specified. */
	PwsAuthenticationError = 32,
	/** A PWS was specified but the data for the specified AdjustmentMethod cannot be retrieved from a PWS. */
	PwsNotSupported = 33,
	/** A PWS is required by the WeatherProvider but was not provided. */
	NoPwsProvided = 34,

	/** An error related to AdjustmentMethods or watering restrictions. */
	AdjustmentMethodError = 4,
	/** The WeatherProvider is incompatible with the specified AdjustmentMethod. */
	UnsupportedAdjustmentMethod = 40,
	/** An invalid AdjustmentMethod ID was specified. */
	InvalidAdjustmentMethod = 41,

	/** An error related to adjustment options (wto). */
	AdjustmentOptionsError = 5,
	/** The adjustment options could not be parsed. */
	MalformedAdjustmentOptions = 50,
	/** A required adjustment option was not provided. */
	MissingAdjustmentOption = 51,

	/** An error was not properly handled and assigned a more specific error code. */
	UnexpectedError = 99
}

/** An error with a numeric code that can be used to identify the type of error. */
export class CodedError extends Error {
	public readonly errCode: ErrorCode;

	public constructor( errCode: ErrorCode, message?: string ) {
		super( message );
		// https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
		Object.setPrototypeOf( this, CodedError.prototype );
		this.errCode = errCode;
	}
}

/**
 * Returns a CodedError representing the specified error. This function can be used to ensure that errors caught in try-catch
 * statements have an error code and do not contain any sensitive information in the error message. If `err` is a
 * CodedError, the same object will be returned. If `err` is not a CodedError, it is assumed that the error wasn't
 * properly handled, so a CodedError with a generic message and an "UnexpectedError" code will be returned. This ensures
 * that the user will only be sent errors that were initially raised by the OpenSprinkler weather service and have
 * had any sensitive information (like API keys) removed from the error message.
 * @param err Any error caught in a try-catch statement.
 * @return A CodedError representing the error that was passed to the function.
 */
export function makeCodedError( err: any ): CodedError {
	if ( err instanceof CodedError ) {
		return err;
	} else {
		return new CodedError( ErrorCode.UnexpectedError );
	}
}
