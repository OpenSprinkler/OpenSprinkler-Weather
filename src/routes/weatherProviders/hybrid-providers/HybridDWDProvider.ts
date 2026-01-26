import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";

/**
 * HybridDWDProvider - Combines local PWS data with DWD (Deutscher Wetterdienst) forecasts.
 * 
 * DWD-specific implementation notes:
 * - DWD provides forecast data via getWeatherDataInternal() which includes a forecast array
 * - Uses Bright Sky API (https://api.brightsky.dev) as DWD data source
 * - We convert the daily forecast data to WateringData format
 * - DWD daily API provides: temperature min/max (converted from C to F), precipitation (converted from mm to inches)
 * - Missing data (humidity, solar, wind) gets reasonable defaults or undefined
 * - NOTE: DWD is free and requires NO API key (government-provided weather service for Germany)
 */
export default class HybridDWDProvider extends BaseHybridProvider {
    
    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "DWD");
    }

    /**
     * Get forecast data from DWD and convert to WateringData format.
     * 
     * DWD returns forecast data through getWeatherDataInternal() in the forecast array.
     * Each forecast day includes: date (Unix timestamp), temp_min, temp_max, precip (already converted to inches)
     * 
     * We filter to only include days AFTER today (tomorrow onwards) to avoid overlap
     * with local historical data.
     * 
     * @param coordinates Geographic coordinates
     * @param pws PWS information (not used by DWD but required by interface)
     * @param currentDayEpoch Unix timestamp for start of current day
     * @returns Array of WateringData for future days
     */
    protected async getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]> {
        
        console.log(`[Hybrid-DWD] Fetching forecast data via WeatherData API`);
        
        // Get weather data which includes daily forecast (7 days from DWD)
        const weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);
        
        // Convert forecast array to WateringData format
        const allForecastData: WateringData[] = weatherData.forecast.map(day => ({
            weatherProvider: "DWD",
            periodStartTime: day.date,
            temp: (day.temp_min + day.temp_max) / 2,  // Average temperature
            minTemp: day.temp_min,
            maxTemp: day.temp_max,
            humidity: 50,  // Default - DWD daily API doesn't provide hourly humidity averages
            minHumidity: 40,  // Reasonable defaults
            maxHumidity: 60,
            precip: day.precip,  // Already converted from mm to inches in DWD provider
            solarRadiation: undefined,  // Not available in daily API
            windSpeed: undefined  // Not available in DWD daily forecast API
        }));
        
        console.log(`[Hybrid-DWD DEBUG] Converted ${allForecastData.length} forecast days to WateringData`);
        
        if (allForecastData.length > 0) {
            console.log(`[Hybrid-DWD DEBUG] First entry periodStartTime: ${allForecastData[0].periodStartTime} (${new Date(allForecastData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-DWD DEBUG] Last entry periodStartTime: ${allForecastData[allForecastData.length-1].periodStartTime} (${new Date(allForecastData[allForecastData.length-1].periodStartTime * 1000).toISOString()})`);
        }
        
        console.log(`[Hybrid-DWD DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-DWD DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);
        
        // Filter to only keep FUTURE forecast data (starting tomorrow)
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allForecastData.filter(data => 
            data.periodStartTime >= tomorrowEpoch
        );
        
        console.log(`[Hybrid-DWD DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);
        
        return futureData;
    }
}
