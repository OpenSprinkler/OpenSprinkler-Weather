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
    /** The current temperature (in Fahrenheit). */
    temp: number;
    /** The current humidity (as a percentage). */
    humidity: number;
    wind: number;
    description: string;
    icon: string;
    region: string;
    city: string;
    minTemp: number;
    maxTemp: number;
    precip: number;
    forecast: WeatherDataForecast[]
}

export interface WeatherDataForecast {
    temp_min: number;
    temp_max: number;
    date: number;
    icon: string;
    description: string;
}

export interface WateringData {
    /** The average forecasted temperature over the next 30 hours (in Fahrenheit). */
    temp: number;
    /** The average forecasted humidity over the next 30 hours (as a percentage). */
    humidity: number;
    /** The forecasted total precipitation over the next 30 hours (in inches). */
    precip: number;
    /** A boolean indicating if it is currently raining. */
    raining: boolean;
}

export interface AdjustmentOptions {
    /** Base humidity (as a percentage). */
    bh?: number;
    /** Base temperature (in Fahrenheit). */
    bt?: number;
    /** Base precipitation (in inches). */
    br?: number;
    /** The percentage to weight the humidity factor by. */
    h?: number;
    /** The percentage to weight the temperature factor by. */
    t?: number;
    /** The percentage to weight the precipitation factor by. */
    r?: number;
    /** The rain delay to use (in hours). */
    d?: number;
}

export interface WeatherProvider {
    /**
     * Retrieves weather data necessary for watering level calculations.
     * @param coordinates The coordinates to retrieve the watering data for.
     * @return A Promise that will be resolved with the WateringData if it is successfully retrieved,
     * or resolved with undefined if an error occurs while retrieving the WateringData.
     */
    getWateringData( coordinates : GeoCoordinates ): Promise< WateringData >;

    /**
     * Retrieves the current weather data for usage in the mobile app.
     * @param coordinates The coordinates to retrieve the weather for
     * @return A Promise that will be resolved with the WeatherData if it is successfully retrieved,
     * or resolved with undefined if an error occurs while retrieving the WeatherData.
     */
    getWeatherData( coordinates : GeoCoordinates ): Promise< WeatherData >;
}
