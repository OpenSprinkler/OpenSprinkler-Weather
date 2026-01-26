import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";

/**
 * HybridPirateWeatherProvider - Combines local PWS data with PirateWeather forecasts.
 * 
 * PirateWeather-specific implementation notes:
 * - PirateWeather provides forecast data via getWeatherDataInternal() which includes a forecast array
 * - PirateWeather is a free/open-source alternative to Dark Sky API
 * - We convert the daily forecast data to WateringData format
 * - PirateWeather daily API provides: temperatureMin, temperatureMax, precipIntensity (converted to daily total)
 * - Missing data (humidity, solar, wind) gets reasonable defaults or undefined
 * - NOTE: PirateWeather requires an API key (free tier available)
 */
export default class HybridPirateWeatherProvider extends BaseHybridProvider {
    
    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "PirateWeather");
    }

    /**
     * Get forecast data from PirateWeather and convert to WateringData format.
     * 
     * PirateWeather returns forecast data through getWeatherDataInternal() in the forecast array.
     * Each forecast day includes: time (Unix timestamp), temp_min, temp_max, precip (precipIntensity * 24)
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
        
        console.log(`[Hybrid-PirateWeather] Fetching forecast data via WeatherData API`);
        
        // Get weather data which includes daily forecast
        const weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);
        
        // Convert forecast array to WateringData format
        const allForecastData: WateringData[] = weatherData.forecast.map(day => ({
            weatherProvider: "PirateWeather",
            periodStartTime: day.date,
            temp: (day.temp_min + day.temp_max) / 2,  // Average temperature
            minTemp: day.temp_min,
            maxTemp: day.temp_max,
            humidity: 50,  // Default - PirateWeather daily API doesn't provide hourly humidity averages
            minHumidity: 40,  // Reasonable defaults
            maxHumidity: 60,
            precip: day.precip,  // Already converted (precipIntensity * 24) in PirateWeather provider
            solarRadiation: undefined,  // Not available in daily API
            windSpeed: undefined  // Not available in PirateWeather daily forecast API
        }));
        
        console.log(`[Hybrid-PirateWeather DEBUG] Converted ${allForecastData.length} forecast days to WateringData`);
        
        if (allForecastData.length > 0) {
            console.log(`[Hybrid-PirateWeather DEBUG] First entry periodStartTime: ${allForecastData[0].periodStartTime} (${new Date(allForecastData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-PirateWeather DEBUG] Last entry periodStartTime: ${allForecastData[allForecastData.length-1].periodStartTime} (${new Date(allForecastData[allForecastData.length-1].periodStartTime * 1000).toISOString()})`);
        }
        
        console.log(`[Hybrid-PirateWeather DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-PirateWeather DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);
        
        // Filter to only keep FUTURE forecast data (starting tomorrow)
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allForecastData.filter(data => 
            data.periodStartTime >= tomorrowEpoch
        );
        
        console.log(`[Hybrid-PirateWeather DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);
        
        return futureData;
    }
}
