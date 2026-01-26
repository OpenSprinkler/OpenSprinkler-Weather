import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";

/**
 * HybridAccuWeatherProvider - Combines local PWS data with AccuWeather forecasts.
 * 
 * AccuWeather-specific implementation notes:
 * - AccuWeather provides forecast data via getWeatherDataInternal() which includes a forecast array
 * - We convert the daily forecast data to WateringData format
 * - AccuWeather daily API provides: Temperature.Minimum/Maximum.Value, Rain.Value (day + night)
 * - Missing data (humidity, solar, wind) gets reasonable defaults or undefined
 * - NOTE: AccuWeather requires an API key
 */
export default class HybridAccuWeatherProvider extends BaseHybridProvider {
    
    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "AccuWeather");
    }

    /**
     * Get forecast data from AccuWeather and convert to WateringData format.
     * 
     * AccuWeather returns forecast data through getWeatherDataInternal() in the forecast array.
     * Each forecast day includes: EpochDate, temp_min, temp_max, precip (Day.Rain + Night.Rain)
     * 
     * We filter to only include days AFTER today (tomorrow onwards) to avoid overlap
     * with local historical data.
     * 
     * @param coordinates Geographic coordinates
     * @param pws PWS information (may contain API key)
     * @param currentDayEpoch Unix timestamp for start of current day
     * @returns Array of WateringData for future days
     */
    protected async getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]> {
        
        console.log(`[Hybrid-AccuWeather] Fetching forecast data via WeatherData API`);
        
        // Get weather data which includes daily forecast
        const weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);
        
        // Convert forecast array to WateringData format
        const allForecastData: WateringData[] = weatherData.forecast.map(day => ({
            weatherProvider: "AccuWeather",
            periodStartTime: day.date,
            temp: (day.temp_min + day.temp_max) / 2,  // Average temperature
            minTemp: day.temp_min,
            maxTemp: day.temp_max,
            humidity: 50,  // Default - AccuWeather daily API doesn't provide hourly humidity averages
            minHumidity: 40,  // Reasonable defaults
            maxHumidity: 60,
            precip: day.precip,  // Already combined (Day.Rain + Night.Rain) in AccuWeather provider
            solarRadiation: undefined,  // Not available in daily API
            windSpeed: undefined  // Not available in AccuWeather daily forecast API
        }));
        
        console.log(`[Hybrid-AccuWeather DEBUG] Converted ${allForecastData.length} forecast days to WateringData`);
        
        if (allForecastData.length > 0) {
            console.log(`[Hybrid-AccuWeather DEBUG] First entry periodStartTime: ${allForecastData[0].periodStartTime} (${new Date(allForecastData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-AccuWeather DEBUG] Last entry periodStartTime: ${allForecastData[allForecastData.length-1].periodStartTime} (${new Date(allForecastData[allForecastData.length-1].periodStartTime * 1000).toISOString()})`);
        }
        
        console.log(`[Hybrid-AccuWeather DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-AccuWeather DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);
        
        // Filter to only keep FUTURE forecast data (starting tomorrow)
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allForecastData.filter(data => 
            data.periodStartTime >= tomorrowEpoch
        );
        
        console.log(`[Hybrid-AccuWeather DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);
        
        return futureData;
    }
}
