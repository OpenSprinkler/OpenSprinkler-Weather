import { GeoCoordinates, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import { BaseHybridProvider } from "./BaseHybridProvider";

/**
 * HybridAppleProvider - Combines local PWS data with Apple Weather forecasts.
 * 
 * Apple Weather-specific implementation notes:
 * - Apple provides forecast data via getWateringDataInternal() which returns WateringData[]
 * - Unlike OpenMeteo, we can use the data directly without conversion
 * - Apple's forecastDaily includes: temperatureMin, temperatureMax, precipitationAmount, humidity, windSpeed
 * - Data is already in the correct WateringData format
 */
export default class HybridAppleProvider extends BaseHybridProvider {
    
    constructor(cloudProvider: WeatherProvider) {
        super(cloudProvider, "Apple");
    }

    /**
     * Get forecast data from Apple Weather.
     * 
     * Apple Weather returns forecast data through getWateringDataInternal() already
     * in WateringData format. We just need to filter to keep only future days.
     * 
     * Apple's getWateringDataInternal() fetches both historical and forecast data,
     * so we filter to only include days AFTER today to avoid overlap with local data.
     * 
     * @param coordinates Geographic coordinates
     * @param pws PWS information (not used by Apple but required by interface)
     * @param currentDayEpoch Unix timestamp for start of current day
     * @returns Array of WateringData for future days
     */
    protected async getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]> {
        
        console.log(`[Hybrid-Apple] Fetching forecast data via getWateringDataInternal`);
        
        // Get watering data from Apple (includes past + future)
        const allData = await this.cloudProvider.getWateringDataInternal(coordinates, pws);
        
        console.log(`[Hybrid-Apple DEBUG] Apple returned ${allData.length} total entries`);
        
        if (allData.length > 0) {
            console.log(`[Hybrid-Apple DEBUG] First entry periodStartTime: ${allData[0].periodStartTime} (${new Date(allData[0].periodStartTime * 1000).toISOString()})`);
            console.log(`[Hybrid-Apple DEBUG] Last entry periodStartTime: ${allData[allData.length-1].periodStartTime} (${new Date(allData[allData.length-1].periodStartTime * 1000).toISOString()})`);
        }
        
        console.log(`[Hybrid-Apple DEBUG] Current day epoch: ${currentDayEpoch} (${new Date(currentDayEpoch * 1000).toISOString()})`);
        console.log(`[Hybrid-Apple DEBUG] Tomorrow epoch: ${currentDayEpoch + (24*60*60)} (${new Date((currentDayEpoch + 24*60*60) * 1000).toISOString()})`);
        
        // Filter to only keep FUTURE forecast data (starting tomorrow)
        // We exclude today because we already have real measurements from local PWS
        const tomorrowEpoch = currentDayEpoch + (24 * 60 * 60);
        const futureData = allData.filter(data => 
            data.periodStartTime >= tomorrowEpoch
        );
        
        console.log(`[Hybrid-Apple DEBUG] After filtering (>= tomorrow): ${futureData.length} entries`);
        
        return futureData;
    }
}
