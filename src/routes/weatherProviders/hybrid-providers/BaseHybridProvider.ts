import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../../types";
import { WeatherProvider } from "../WeatherProvider";
import LocalWeatherProvider from "../local";
import { CodedError, ErrorCode } from "../../../errors";
import { getUnixTime, startOfDay } from "date-fns";
import { localTime } from "../../weather";

/**
 * BaseHybridProvider - Abstract base class for all Hybrid weather providers.
 *
 * Design Philosophy:
 * - CURRENT WEATHER (now): Uses local weather station for real-time conditions
 *   → Used for rain delay decisions and current weather display in app
 * - HISTORICAL DATA (past 7 days): Uses local weather station for accurate measurements
 *   → Provides actual temperature, humidity, rainfall, solar, wind from your station
 * - FORECAST DATA (next 7 days): Uses external provider (Apple, OpenMeteo, etc.) for predictions
 *   → Professional forecasts for future watering calculations
 *
 * Each concrete implementation (HybridOpenMeteoProvider, HybridAppleProvider, etc.) must implement:
 * - getForecastData(): Method to fetch and convert forecast data from the specific cloud provider
 */
export abstract class BaseHybridProvider extends WeatherProvider {
    protected localProvider: LocalWeatherProvider;
    protected cloudProvider: WeatherProvider;
    protected cloudProviderName: string;

    constructor(cloudProvider: WeatherProvider, cloudProviderName: string) {
        super();
        this.localProvider = new LocalWeatherProvider();
        this.cloudProvider = cloudProvider;
        this.cloudProviderName = cloudProviderName;
    }

    /**
     * Abstract method that each concrete hybrid provider must implement.
     * This method is responsible for fetching forecast data from the specific cloud provider
     * and converting it to the WateringData format.
     *
     * @param coordinates Geographic coordinates
     * @param pws PWS information
     * @param currentDayEpoch Unix timestamp for start of current day (to filter future data)
     * @returns Array of WateringData for future days (tomorrow onwards)
     */
    protected abstract getForecastData(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        currentDayEpoch: number
    ): Promise<readonly WateringData[]>;

    /**
     * Get current weather data for display in the mobile app and rain delay decisions.
     *
     * This method returns REAL-TIME conditions from your local weather station.
     * It ensures that current rain, temperature, and humidity are from actual measurements,
     * not forecasts. This is critical for accurate rain delay activation.
     *
     * Data returned represents conditions RIGHT NOW (based on last 24 hours of observations).
     * Falls back to forecast provider only if local station data is unavailable.
     *
     * @param coordinates Geographic coordinates
     * @param pws PWS information
     * @returns Current weather conditions from local station (or forecast fallback)
     */
    protected async getWeatherDataInternal(
        coordinates: GeoCoordinates,
        pws: PWS | undefined
    ): Promise<WeatherData> {
        let weatherData: WeatherData;

        try {
            // Try to get current weather from local station first
            // This ensures rain delay and current conditions use real measurements
            weatherData = await this.localProvider.getWeatherDataInternal(coordinates, pws);
        } catch (err) {
            console.warn(`[Hybrid-${this.cloudProviderName}] Local weather data unavailable, falling back to cloud provider:`, err);

            // Fallback to cloud provider if local unavailable
            weatherData = await this.cloudProvider.getWeatherDataInternal(coordinates, pws);
        }

        // Override weatherProvider to show hybrid mode in UI
        // Format: "local+OpenMeteo", "local+WU", etc.
        weatherData.weatherProvider = `local+${this.cloudProviderName}`;

        return weatherData;
    }

    /**
     * Get watering data combining local historical measurements with external forecasts.
     *
     * This is the core method for Zimmerman watering calculations in hybrid mode.
     * It combines the best of both worlds:
     *
     * LOCAL PWS (past + today):
     * - Day -7 to Day -1: Complete days with actual measurements
     * - Day 0 (today): Partial day with measurements up to current time
     * → These are YOUR exact conditions: temp, humidity, rain, solar, wind
     *
     * FORECAST PROVIDER (future):
     * - Day +1 to Day +7: Professional weather forecasts
     * → Reliable predictions for upcoming week
     *
     * Example timeline (if called at 18:00 on Jan 18):
     * - Jan 11-17: Your station's actual measurements (7 complete days)
     * - Jan 18 (00:00-18:00): Your station's measurements for today so far
     * - Jan 19-25: Forecast provider's predictions (7 future days)
     *
     * The Zimmerman algorithm uses all this data to calculate optimal watering.
     *
     * @param coordinates Geographic coordinates
     * @param pws PWS information (used for local station)
     * @returns Array of WateringData in reverse chronological order (newest first)
     */
    protected async getWateringDataInternal(
        coordinates: GeoCoordinates,
        pws: PWS | undefined
    ): Promise<readonly WateringData[]> {

        const currentDay = startOfDay(localTime(coordinates));
        const currentDayEpoch = getUnixTime(currentDay);

        // 1. Get historical + today's data from local weather station
        let historicalData: readonly WateringData[] = [];
        let localDataAvailable = false;

        try {
            const localResult = await this.localProvider.getWateringDataInternal(coordinates, pws);

            // Check if we actually got data (not just empty array)
            if (localResult.length > 0) {
                // Local provider returns past 7 days + today (partial day up to now)
                // This is all MEASURED data from your station - keep all of it!
                historicalData = localResult;
                localDataAvailable = true;

                console.log(`[Hybrid-${this.cloudProviderName}] Retrieved ${historicalData.length} days of data from local station (including today)`);
            } else {
                console.warn(`[Hybrid-${this.cloudProviderName}] Local provider returned empty data set`);
                localDataAvailable = false;
            }

        } catch (err) {
            console.warn(`[Hybrid-${this.cloudProviderName}] Local historical data unavailable:`, err);
            localDataAvailable = false;
            // Continue without local data - will use forecast for everything
        }

        // 2. Get forecast data from cloud provider (implementation-specific)
        let forecastData: readonly WateringData[] = [];

        try {
            // Call the abstract method that each concrete provider implements
            forecastData = await this.getForecastData(coordinates, pws, currentDayEpoch);

            console.log(`[Hybrid-${this.cloudProviderName}] Retrieved ${forecastData.length} days of forecast data (tomorrow onwards)`);

        } catch (err) {
            console.warn(`[Hybrid-${this.cloudProviderName}] Forecast data unavailable:`, err);

            if (!localDataAvailable) {
                throw new CodedError(ErrorCode.InsufficientWeatherData);
            }

            // If we have local data but no forecast, just return local data
            console.warn(`[Hybrid-${this.cloudProviderName}] Using only local historical data (forecast failed)`);
            return historicalData;
        }

        // 3. Check for data overlap and remove if necessary
        if (localDataAvailable && historicalData.length > 0 && forecastData.length > 0) {
            const latestHistorical = Math.max(...historicalData.map(d => d.periodStartTime));
            const earliestForecast = Math.min(...forecastData.map(d => d.periodStartTime));

            if (earliestForecast <= latestHistorical) {
                console.warn(`[Hybrid-${this.cloudProviderName}] Overlap detected! Latest historical: ${new Date(latestHistorical * 1000).toISOString()}, Earliest forecast: ${new Date(earliestForecast * 1000).toISOString()}`);
                // Filter out any forecast data that overlaps with historical
                forecastData = forecastData.filter(d => d.periodStartTime > latestHistorical);
                console.log(`[Hybrid-${this.cloudProviderName}] After overlap removal: ${forecastData.length} forecast days`);
            }
        }

        // 4. Combine local measurements + forecast predictions
        const combinedData = [...historicalData, ...forecastData];

        if (combinedData.length === 0) {
            console.error(`[Hybrid-${this.cloudProviderName}] No data available from either local or cloud providers`);
            throw new CodedError(ErrorCode.InsufficientWeatherData);
        }

        // 5. Sort by periodStartTime (newest first = reverse chronological)
        // This is what the Zimmerman algorithm expects
        combinedData.sort((a, b) => b.periodStartTime - a.periodStartTime);

        console.log(`[Hybrid-${this.cloudProviderName}] Combined data: ${historicalData.length} days (local+today) + ${forecastData.length} days (forecast) = ${combinedData.length} total days`);
        console.log(`[Hybrid-${this.cloudProviderName}] Data sources: Local PWS (historical+today), ${this.cloudProviderName} (tomorrow+)`);
        console.log(`[Hybrid-${this.cloudProviderName}] Date range: ${new Date(combinedData[combinedData.length-1].periodStartTime * 1000).toISOString().split('T')[0]} to ${new Date(combinedData[0].periodStartTime * 1000).toISOString().split('T')[0]}`);

        // Return as readonly array (TypeScript requirement)
        return combinedData as readonly WateringData[];
    }

    /**
     * Cache settings for hybrid provider.
     *
     * Historical data from local station doesn't change (past is past),
     * so we can cache until end of day. Forecast data gets refreshed
     * according to the forecast provider's own cache settings.
     */
    public shouldCacheWateringScale(): boolean {
        return true;
    }
}