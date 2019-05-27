/** Geographic coordinates. The 1st element is the latitude, and the 2nd element is the longitude. */
export type GeoCoordinates = [number, number];

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

/**
 * Data from a 24 hour window that is used to calculate how watering levels should be scaled. This should ideally use
 * historic data from the past day, but may also use forecasted data for the next day if historical data is not
 * available.
 */
export interface WateringData {
    /** The WeatherProvider that generated this data. */
    weatherProvider: WeatherProviderId;
    /** The average temperature over the window (in Fahrenheit). */
    temp: number;
    /** The average humidity over the window (as a percentage). */
    humidity: number;
    /** The total precipitation over the window (in inches). */
    precip: number;
    /** A boolean indicating if it is raining at the time that this data was retrieved. */
    raining: boolean;
}

export interface WeatherProvider {
    /**
     * Retrieves weather data necessary for watering level calculations.
     * @param coordinates The coordinates to retrieve the watering data for.
     * @return A Promise that will be resolved with the WateringData if it is successfully retrieved,
     * or resolved with undefined if an error occurs while retrieving the WateringData.
     */
    getWateringData?( coordinates : GeoCoordinates ): Promise< WateringData >;

    /**
     * Retrieves the current weather data for usage in the mobile app.
     * @param coordinates The coordinates to retrieve the weather for
     * @return A Promise that will be resolved with the WeatherData if it is successfully retrieved,
     * or resolved with undefined if an error occurs while retrieving the WeatherData.
     */
    getWeatherData?( coordinates : GeoCoordinates ): Promise< WeatherData >;

    /**
     * Retrieves the data necessary for calculating ETo.
     * @param coordinates The coordinates to retrieve the data for.
     * @return A Promise that will be resolved with the EToData if it is successfully retrieved,
     * or resolved with undefined if an error occurs while retrieving the EToData.
     */
    getEToData?( coordinates: GeoCoordinates ): Promise< EToData >;
}

/**
 * Data used to calculate ETo. This data should be taken from a 24 hour time window.
 */
export interface EToData {
    /** The minimum temperature over the time period (in Celsius). */
    minTemp: number;
    /** The maximum temperature over the time period (in Celsius). */
    maxTemp: number;
    /** The minimum relative humidity over the time period (as a percentage). */
    minHumidity: number;
    /** The maximum relative humidity over the time period (as a percentage). */
    maxHumidity: number;
    /** The solar radiation, accounting for cloud coverage (in megajoules per square meter per day). */
    solarRadiation: number;
    /** The average wind speed over the time period (in meters per second). */
    windSpeed: number;
    /** The height the wind speed measurement was taken at (in meters). */
    windSpeedMeasurementHeight: number;
    /** The day of the year between 1 (January 1) and 365/366 (December 31). */
    dayOfYear: number;
    /** The latitude of the watering site (in degrees). */
    lat: number;
    /** The total precipitation over the time period (in millimeters). */
    precip: number;
}

export type WeatherProviderId = "OWM" | "DarkSky" | "local";
