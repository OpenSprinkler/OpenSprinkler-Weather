/** Geographic coordinates. The 1st element is the latitude, and the 2nd element is the longitude. */
export type GeoCoordinates = [number, number];

/** A PWS ID and API key. */
export type PWS = { id?: string, apiKey: string };

export interface TimeData {
	/** The UTC offset, in minutes. This uses POSIX offsets, which are the negation of typically used offsets
	 * (https://github.com/eggert/tz/blob/2017b/etcetera#L36-L42).
	 */
	timezone: number;
	/** The time of sunrise, in minutes from UTC midnight. */
	sunrise: number;
	/** The time of sunset, in minutes from UTC midnight. */
	sunset: number;
}

export interface WeatherData {
	/** The WeatherProvider that generated this data. */
	weatherProvider: WeatherProviderId;
	/** The current temperature (in Fahrenheit). */
	temp: number;
	/** The current humidity (as a percentage). */
	humidity: number;
	/** The current wind speed (in miles per hour). */
	wind: number;
	/** A flag if it is currently raining. */
	raining: boolean;
	/** A human-readable description of the weather. */
	description: string;
	/** An icon ID that represents the current weather. This will be used in http://openweathermap.org/img/w/<ICON_ID>.png */
	icon: string;
	region: string;
	city: string;
	/** The forecasted minimum temperature for the current day (in Fahrenheit). */
	minTemp: number;
	/** The forecasted minimum temperature for the current day (in Fahrenheit). */
	maxTemp: number;
	/** The forecasted total precipitation for the current day (in inches). */
	precip: number;
	forecast: WeatherDataForecast[]
}

/** The forecasted weather for a specific day in the future. */
export interface WeatherDataForecast {
	/** The forecasted minimum temperature for this day (in Fahrenheit). */
	temp_min: number;
	/** The forecasted maximum temperature for this day (in Fahrenheit). */
	temp_max: number;
	/** The forecaseted precipitation for this day (in inches). */
	precip: number;
	/** The timestamp of the day this forecast is for (in Unix epoch seconds). */
	date: number;
	/** An icon ID that represents the weather at this forecast window. This will be used in http://openweathermap.org/img/w/<ICON_ID>.png */
	icon: string;
	/** A human-readable description of the weather. */
	description: string;
}

/**
 * Data from a set of 24 hour windows that is used to calculate how watering levels should be scaled. This should ideally use
 * as many days of historic data as possible based on the selected provider.
 */

export interface WateringData {
	/** The WeatherProvider that generated this data. */
	weatherProvider: WeatherProviderShortId;
	/** The total precipitation over the window (in inches). */
	precip: number;
	/** The average temperature over the window (in Fahrenheit). */
	temp: number;
	/** The average humidity over the window (as a percentage). */
	humidity: number;
	/** The Unix epoch seconds timestamp of the start of this 24 hour time window. */
	periodStartTime: number;
	/** The minimum temperature over the time period (in Fahrenheit). */
	minTemp: number;
	/** The maximum temperature over the time period (in Fahrenheit). */
	maxTemp: number;
	/** The minimum relative humidity over the time period (as a percentage). */
	minHumidity: number;
	/** The maximum relative humidity over the time period (as a percentage). */
	maxHumidity: number;
	/** The solar radiation, accounting for cloud coverage (in kilowatt hours per square meter per day). */
	solarRadiation: number;
	/**
	 * The average wind speed measured at 2 meters over the time period (in miles per hour). A measurement taken at a
	 * different height can be standardized to 2m using the `standardizeWindSpeed` function in EToAdjustmentMethod.
	 */
	windSpeed: number;
}

export type WeatherProviderId = "OWM" | "PirateWeather" | "local" | "mock" | "WUnderground" | "DWD" | "OpenMeteo" | "AccuWeather" | "Apple";
export type WeatherProviderShortId = "OWM" | "PW" | "local" | "mock" | "WU" | "DWD" | "OpenMeteo" | "AW" | "Apple";
