/** Geographic coordinates. The 1st element is the latitude, and the 2nd element is the longitude. */
export type GeoCoordinates = [number, number];

/** A PWS ID and API key. */
export type PWS = { id: string, apiKey: string };

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
    /** The timestamp of the day this forecast is for (in Unix epoch seconds). */
    date: number;
    /** An icon ID that represents the weather at this forecast window. This will be used in http://openweathermap.org/img/w/<ICON_ID>.png */
    icon: string;
    /** A human-readable description of the weather. */
    description: string;
}

export interface BaseWateringData {
    /** The WeatherProvider that generated this data. */
    weatherProvider: WeatherProviderId;
    /** The total precipitation over the window (in inches). */
    precip: number;
}

/**
 * Data from a 24 hour window that is used to calculate how watering levels should be scaled. This should ideally use
 * historic data from the past day, but may also use forecasted data for the next day if historical data is not
 * available.
 */
export interface ZimmermanWateringData extends BaseWateringData {
    /** The average temperature over the window (in Fahrenheit). */
    temp: number;
    /** The average humidity over the window (as a percentage). */
    humidity: number;
    /** A boolean indicating if it is raining at the time that this data was retrieved. */
    raining: boolean;
}

export type WeatherProviderId = "OWM" | "DarkSky" | "local" | "mock" | "WUnderground";
