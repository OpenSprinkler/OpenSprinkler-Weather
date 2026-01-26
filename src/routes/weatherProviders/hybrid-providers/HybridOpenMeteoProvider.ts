import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";
import { getUnixTime } from "date-fns";

/**
 * HybridOpenMeteoProvider - Combines local PWS data with OpenMeteo forecasts.
 *
 * OpenMeteo-specific implementation notes:
 * - OpenMeteo provides forecast data via getWeatherDataInternal() which includes a forecast array
 * - We convert the daily forecast data to WateringData format
 * - OpenMeteo daily API provides: temp_min, temp_max, precip
 * - Missing data (humidity, solar, wind) gets reasonable defaults
 */
export default class HybridOpenMeteoProvider extends BaseHybridProvider {

    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "OpenMeteo");
    }

    /**
     * Get forecast data from OpenMeteo and convert to WateringData format.
     *
     * OpenMeteo returns forecast data through getWeatherDataInternal() in the forecast array.
     * Each forecast day includes: date, temp_min, temp_max, precip
     *
     * We filter to only include days AFTER today (tomorrow onwards) to avoid overlap
     * with local historical data.
     *
     * @param coordinates Geographic coordinates
     * @param pws PWS information (not used by OpenMeteo but required by interface)
     * @param currentDayEpoch Unix timestamp for start of current day
     * @returns Array of WateringData for future days
     */
    protected async getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]> {

        console.log(`[Hybrid-OpenMeteo] Fetching forecast data via WeatherData API`);

        // Get weather data which includes daily forecast
        const weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);

        // Convert forecast array to WateringData format
        const allForecastData: WateringData[] = weatherData.forecast.map(day => ({
            weatherProvider: "OpenMeteo",
            periodStartTime: day.date,
            temp: (day.temp_min + day.temp_max) / 2,  // Average temperature
            minTemp: day.temp_min,
            maxTemp: day.temp_max,
            humidity: 50,  // Default - OpenMeteo daily API doesn't provide hourly humidity averages
            minHumidity: 40,  // Reasonable defaults
            maxHumidity: 60,
            precip: day.precip,
            solarRadiation: undefined,  // Not available in daily API
            windSpeed: undefined  // Not available in daily API (could add windspeed_10m_max if needed)
        }));

        console.log(`[Hybrid-OpenMeteo DEBUG] Converted ${allForecastData.length} forecast days to WateringData`);
        console.log(`[Hybrid-OpenMeteo DEBUG] Raw forecast precip values:`);
        weatherData.forecast.forEach((day, i) => {
            const date = new Date(day.date * 1000).toISOString().split('T')[0];
            console.log(`  ${i+1}. ${date}: precip=${day.precip}" (from OpenMeteo)`);
        });

        if (allForecastData.length > 0) {
            console.log(`[Hybrid-OpenMeteo DEBUG] First entry periodStartTime: ${allForecastData[0].periodStartTime} (${new Date(allForecastData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-OpenMeteo DEBUG] Last entry periodStartTime: ${allForecastData[allForecastData.length-1].periodStartTime} (${new Date(allForecastData[allForecastData.length-1].periodStartTime * 1000).toISOString()})`);
        }

        console.log(`[Hybrid-OpenMeteo DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-OpenMeteo DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);

        // Filter to only keep FUTURE forecast data (starting tomorrow)
        // We exclude today because we already have real measurements from local PWS
        // This ensures today's data is always actual conditions, not predictions
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allForecastData.filter(data =>
            data.periodStartTime >= tomorrowEpoch
        );

        console.log(`[Hybrid-OpenMeteo DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);

        return futureData;
    }
}