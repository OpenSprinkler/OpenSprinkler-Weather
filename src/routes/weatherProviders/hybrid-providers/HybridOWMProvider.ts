import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";

/**
 * HybridOWMProvider - Combines local PWS data with OpenWeatherMap forecasts.
 * 
 * OWM-specific implementation notes:
 * - OWM provides forecast data via getWeatherDataInternal() which includes a forecast array
 * - We convert the daily forecast data to WateringData format
 * - OWM daily API provides: temp.min, temp.max, rain (precip already converted from mm to inches)
 * - Missing data (humidity, solar, wind) gets reasonable defaults or undefined
 */
export default class HybridOWMProvider extends BaseHybridProvider {
    
    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "OWM");
    }

    /**
     * Get forecast data from OWM and convert to WateringData format.
     * 
     * OWM returns forecast data through getWeatherDataInternal() in the forecast array.
     * Each forecast day includes: date, temp_min, temp_max, precip (already converted to inches)
     * 
     * We filter to only include days AFTER today (tomorrow onwards) to avoid overlap
     * with local historical data.
     * 
     * @param coordinates Geographic coordinates
     * @param pws PWS information (not used by OWM but required by interface)
     * @param currentDayEpoch Unix timestamp for start of current day
     * @returns Array of WateringData for future days
     */
    protected async getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]> {
        
        console.log(`[Hybrid-OWM] Fetching forecast data via WeatherData API`);
        
        // Get weather data which includes daily forecast
        const weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);
        
        // Convert forecast array to WateringData format
        const allForecastData: WateringData[] = weatherData.forecast.map(day => ({
            weatherProvider: "OWM",
            periodStartTime: day.date,
            temp: (day.temp_min + day.temp_max) / 2,  // Average temperature
            minTemp: day.temp_min,
            maxTemp: day.temp_max,
            humidity: 50,  // Default - OWM daily API doesn't provide hourly humidity averages
            minHumidity: 40,  // Reasonable defaults
            maxHumidity: 60,
            precip: day.precip,  // Already converted to inches in OWM provider
            solarRadiation: undefined,  // Not available in daily API
            windSpeed: undefined  // Not available in OWM daily API
        }));
        
        console.log(`[Hybrid-OWM DEBUG] Converted ${allForecastData.length} forecast days to WateringData`);
        
        if (allForecastData.length > 0) {
            console.log(`[Hybrid-OWM DEBUG] First entry periodStartTime: ${allForecastData[0].periodStartTime} (${new Date(allForecastData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-OWM DEBUG] Last entry periodStartTime: ${allForecastData[allForecastData.length-1].periodStartTime} (${new Date(allForecastData[allForecastData.length-1].periodStartTime * 1000).toISOString()})`);
        }
        
        console.log(`[Hybrid-OWM DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-OWM DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);
        
        // Filter to only keep FUTURE forecast data (starting tomorrow)
        // We exclude today because we already have real measurements from local PWS
        // This ensures today's data is always actual conditions, not predictions
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allForecastData.filter(data => 
            data.periodStartTime >= tomorrowEpoch
        );
        
        console.log(`[Hybrid-OWM DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);
        
        return futureData;
    }
}
