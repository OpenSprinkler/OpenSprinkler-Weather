import { GeoCoordinates, WeatherData, WateringData, PWS } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { 
    HybridOpenMeteoProvider, 
    HybridAppleProvider, 
    HybridOWMProvider,
    HybridAccuWeatherProvider,
    HybridDWDProvider,
    HybridPirateWeatherProvider,
    HybridWUndergroundProvider
} from "./hybrid-providers";
import { CodedError, ErrorCode } from "../../errors";
import { CachedResult } from "../../cache";

/**
 * HybridWeatherProvider - Factory class that delegates to cloud-specific implementations.
 *
 * GOAL: Act EXACTLY like a standard provider (e.g. OpenMeteo), but with better data:
 * - Past + Current: Local weather station (actual measurements)
 * - Future: Cloud provider (professional forecasts)
 * 
 * For Zimmerman, Weather Restrictions, and UI, this is TRANSPARENT.
 * 
 * Supports all 7 providers:
 * - OpenMeteo (free, no API key)
 * - Apple
 * - OWM (OpenWeatherMap)
 * - AccuWeather
 * - DWD/Bright Sky (Germany)
 * - PirateWeather
 * - Weather Underground
 */
export default class HybridWeatherProvider extends WeatherProvider {
    private forecastProviders: Map<string, WeatherProvider>;
    private activeHybridProvider: WeatherProvider | null = null;
    private activeProviderName: string | null = null;

    // Cache for combined watering data (historical + forecast)
    private cachedCombinedData: readonly WateringData[] | null = null;
    private cacheCoordinates: GeoCoordinates | null = null;
    private cacheTimestamp: number = 0;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    public constructor(forecastProviders: Map<string, WeatherProvider>) {
        super();
        this.forecastProviders = forecastProviders;
    }

    /**
     * Factory method: Creates the appropriate Hybrid provider for ANY cloud provider.
     */
    private createHybridProvider(forecastProviderName: string): WeatherProvider {
        const cloudProvider = this.forecastProviders.get(forecastProviderName);

        if (!cloudProvider) {
            throw new CodedError(ErrorCode.InvalidProvider);
        }

        switch (forecastProviderName) {
            case 'OpenMeteo':
                console.log(`[HybridFactory] Creating HybridOpenMeteoProvider`);
                return new HybridOpenMeteoProvider(cloudProvider);

            case 'Apple':
                console.log(`[HybridFactory] Creating HybridAppleProvider`);
                return new HybridAppleProvider(cloudProvider);

            case 'OWM':
                console.log(`[HybridFactory] Creating HybridOWMProvider`);
                return new HybridOWMProvider(cloudProvider);

            case 'AccuWeather':
                console.log(`[HybridFactory] Creating HybridAccuWeatherProvider`);
                return new HybridAccuWeatherProvider(cloudProvider);

            case 'DWD':
                console.log(`[HybridFactory] Creating HybridDWDProvider`);
                return new HybridDWDProvider(cloudProvider);

            case 'PirateWeather':
                console.log(`[HybridFactory] Creating HybridPirateWeatherProvider`);
                return new HybridPirateWeatherProvider(cloudProvider);

            case 'WU':
                console.log(`[HybridFactory] Creating HybridWUndergroundProvider`);
                return new HybridWUndergroundProvider(cloudProvider);

            default:
                console.error(`[HybridFactory] Unknown provider: ${forecastProviderName}`);
                throw new CodedError(ErrorCode.InvalidProvider);
        }
    }

    /**
     * Get watering data using the appropriate hybrid provider.
     * Called from weather.ts BEFORE Zimmerman runs.
     */
    public async getWateringDataWithForecastProvider(
        coordinates: GeoCoordinates,
        pws: PWS | undefined,
        forecastProviderName: string
    ): Promise<readonly WateringData[]> {
        
        // Create or reuse the hybrid provider
        if (this.activeProviderName !== forecastProviderName || !this.activeHybridProvider) {
            console.log(`[HybridFactory] Switching to forecast provider: ${forecastProviderName}`);
            this.activeHybridProvider = this.createHybridProvider(forecastProviderName);
            this.activeProviderName = forecastProviderName;
        }

        // Get combined data and CACHE it
        const combinedData = await this.activeHybridProvider.getWateringDataInternal(coordinates, pws);
        
        this.cachedCombinedData = combinedData;
        this.cacheCoordinates = coordinates;
        this.cacheTimestamp = Date.now();
        
        console.log(`[HybridFactory] Cached ${combinedData.length} days of combined watering data`);
        
        return combinedData;
    }

    /**
     * CRITICAL: Override getWeatherData() to return WeatherData with forecast[] array.
     * 
     * This is what Weather Restrictions use to check future rain!
     * We must act EXACTLY like standard OpenMeteo/Apple providers.
     */
    async getWeatherData(coordinates: GeoCoordinates, pws?: PWS): Promise<CachedResult<WeatherData>> {
        console.log('[HybridFactory] getWeatherData() called (for Weather Restrictions)');
        
        // Get current weather from local station
        let currentWeather: WeatherData;
        try {
            currentWeather = await this.getWeatherDataInternal(coordinates, pws);
        } catch (err) {
            console.error('[HybridFactory] Failed to get current weather:', err);
            throw err;
        }

        // Convert cached WateringData to forecast[] array
        if (this.cachedCombinedData && this.cachedCombinedData.length > 0) {
            console.log(`[HybridFactory] Converting ${this.cachedCombinedData.length} WateringData entries to forecast[] array`);
            
            currentWeather.forecast = this.cachedCombinedData.map(wd => ({
                temp_min: wd.minTemp,
                temp_max: wd.maxTemp,
                precip: wd.precip,
                date: wd.periodStartTime,
                icon: "01d",  // Default icon
                description: ""  // Not critical for restrictions
            }));
            
            console.log(`[HybridFactory] Created forecast[] with ${currentWeather.forecast.length} days`);
            console.log(`[HybridFactory] First forecast: ${new Date(currentWeather.forecast[0].date * 1000).toISOString().split('T')[0]}, precip=${currentWeather.forecast[0].precip}"`);
            if (currentWeather.forecast.length > 1) {
                console.log(`[HybridFactory] Second forecast: ${new Date(currentWeather.forecast[1].date * 1000).toISOString().split('T')[0]}, precip=${currentWeather.forecast[1].precip}"`);
            }
        } else {
            console.warn('[HybridFactory] No cached data available for forecast[] array');
            currentWeather.forecast = [];
        }

        return {
            value: currentWeather,
            ttl: Date.now() + this.CACHE_TTL
        };
    }

    /**
     * Get current weather from local station.
     */
    protected async getWeatherDataInternal(
        coordinates: GeoCoordinates, 
        pws: PWS | undefined
    ): Promise<WeatherData> {
        if (!this.activeHybridProvider) {
            const defaultProvider = 'Apple';
            console.log(`[HybridFactory] No active provider, defaulting to ${defaultProvider}`);
            this.activeHybridProvider = this.createHybridProvider(defaultProvider);
            this.activeProviderName = defaultProvider;
        }

        return await this.activeHybridProvider.getWeatherDataInternal(coordinates, pws);
    }

    /**
     * CRITICAL: Override getWateringData() to return combined data to Zimmerman.
     * 
     * This bypasses the base class cache and returns our cached combined data.
     */
    getWateringData(coordinates: GeoCoordinates, pws?: PWS): Promise<CachedResult<readonly WateringData[]>> {
        console.log('[HybridFactory] getWateringData() called (for Zimmerman)');
        
        const now = Date.now();
        const cacheValid = this.cachedCombinedData &&
                          this.cacheCoordinates &&
                          this.cacheCoordinates[0] === coordinates[0] &&
                          this.cacheCoordinates[1] === coordinates[1] &&
                          (now - this.cacheTimestamp) < this.CACHE_TTL;

        if (cacheValid && this.cachedCombinedData) {
            console.log(`[HybridFactory] Returning cached ${this.cachedCombinedData.length} days to Zimmerman`);
            return Promise.resolve({
                value: this.cachedCombinedData,
                ttl: this.cacheTimestamp + this.CACHE_TTL
            });
        }

        console.warn('[HybridFactory] No cached data, falling back to base class');
        return super.getWateringData(coordinates, pws);
    }

    public shouldCacheWateringScale(): boolean {
        return true;
    }
}
