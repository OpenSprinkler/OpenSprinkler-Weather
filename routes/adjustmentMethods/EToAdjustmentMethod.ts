import * as SunCalc from "suncalc";
import moment from "moment";
import { AdjustmentMethod, AdjustmentMethodResponse, AdjustmentOptions } from "./AdjustmentMethod";
import { BaseWateringData, GeoCoordinates, PWS } from "../../types";
import { WeatherProvider } from "../weatherProviders/WeatherProvider";
import { CodedError, ErrorCode } from "../../errors";

// Import enhanced forecast interfaces
import { EnhancedWeatherProvider, ForecastEToData } from "../weatherProviders/local";
import { resolveCropCoefficient } from "./PlantCoefficients";

/**
 * Structural (duck-typed) capability check that ALSO narrows the type so the forecast block can
 * call the forecast methods. Replaces an `instanceof EnhancedWeatherProvider` check that (a)
 * excluded the FallbackWeatherProvider wrapper and (b) silently excluded OpenMeteo, whose
 * EnhancedWeatherProvider is a different class from local's.
 */
export function supportsForecast( wp: any ): wp is EnhancedWeatherProvider {
	return !!wp && typeof wp.supportsForecasting === "function" && wp.supportsForecasting();
}

/**
 * Enhanced turfgrass management with crop coefficients and seasonal intelligence
 */

// Turfgrass type definitions
export type GrassType = 'cool-season' | 'warm-season' | 'native' | 'mixed' | 'custom';
export type CoolSeasonVariety = 'kentucky-bluegrass' | 'tall-fescue' | 'perennial-rye' | 'fine-fescue' | 'cool-mix';
export type WarmSeasonVariety = 'bermuda' | 'zoysia' | 'st-augustine' | 'centipede' | 'buffalo';

// USDA Zone mapping for dormancy and stress periods
export const USDA_ZONE_DATA = {
    '3a': { firstFrost: 270, lastFrost: 120, summerStressStart: 180, summerStressEnd: 240 },
    '3b': { firstFrost: 275, lastFrost: 115, summerStressStart: 180, summerStressEnd: 240 },
    '4a': { firstFrost: 280, lastFrost: 110, summerStressStart: 170, summerStressEnd: 245 },
    '4b': { firstFrost: 285, lastFrost: 105, summerStressStart: 170, summerStressEnd: 245 },
    '5a': { firstFrost: 290, lastFrost: 100, summerStressStart: 165, summerStressEnd: 250 },
    '5b': { firstFrost: 295, lastFrost: 95, summerStressStart: 165, summerStressEnd: 250 },
    '6a': { firstFrost: 300, lastFrost: 90, summerStressStart: 160, summerStressEnd: 255 },
    '6b': { firstFrost: 305, lastFrost: 85, summerStressStart: 160, summerStressEnd: 255 },
    '7a': { firstFrost: 315, lastFrost: 75, summerStressStart: 150, summerStressEnd: 265 },
    '7b': { firstFrost: 320, lastFrost: 70, summerStressStart: 150, summerStressEnd: 265 },
    '8a': { firstFrost: 330, lastFrost: 60, summerStressStart: 140, summerStressEnd: 275 },
    '8b': { firstFrost: 335, lastFrost: 55, summerStressStart: 140, summerStressEnd: 275 }
};

/**
 * Comprehensive crop coefficient calculation based on turfgrass science
 */
export class TurfgrassManager {
    
    /**
     * Calculate crop coefficient based on grass type, season, weather conditions, and management practices
     */
    static calculateCropCoefficient(
        grassType: GrassType,
        variety: string,
        coordinates: GeoCoordinates,
        usdaZone: string,
        currentTemp: number,
        recentPrecip: number,
        dayOfYear: number,
        managementLevel: 'low' | 'medium' | 'high' = 'medium'
    ): { kc: number, factors: any } {
        
        console.log(`DEBUG: TurfgrassManager calculating Kc for ${grassType}/${variety} in zone ${usdaZone}`);
        
        // Base Kc by grass type and variety
        const baseKc = this.getBaseKc(grassType, variety, managementLevel);
        
        // Seasonal adjustment
        const seasonalKc = this.getSeasonalKc(grassType, dayOfYear, usdaZone);
        
        // Temperature stress adjustment
        const tempStress = this.getTemperatureStressAdjustment(grassType, currentTemp, dayOfYear, usdaZone);
        
        // Moisture stress adjustment (recent precipitation affects water needs)
        const moistureAdjustment = this.getMoistureAdjustment(recentPrecip, grassType);
        
        // Growth stage adjustment
        const growthStage = this.getGrowthStageAdjustment(grassType, dayOfYear, usdaZone, currentTemp);
        
        // Combine all factors
        let finalKc = baseKc * seasonalKc * tempStress * moistureAdjustment * growthStage;
        
        // Clamp Kc to reasonable bounds
        finalKc = Math.max(0.1, Math.min(1.2, finalKc));
        
        const factors = {
            baseKc: Math.round(baseKc * 100) / 100,
            seasonalKc: Math.round(seasonalKc * 100) / 100,
            tempStress: Math.round(tempStress * 100) / 100,
            moistureAdjustment: Math.round(moistureAdjustment * 100) / 100,
            growthStage: Math.round(growthStage * 100) / 100,
            finalKc: Math.round(finalKc * 100) / 100,
            grassType,
            variety,
            dayOfYear,
            managementLevel
        };
        
        console.log(`DEBUG: Kc calculation factors:`, factors);
        
        return { kc: finalKc, factors };
    }
    
    /**
     * Base crop coefficients by turfgrass type and variety
     */
    private static getBaseKc(grassType: GrassType, variety: string, managementLevel: string): number {
        const managementMultiplier = {
            'low': 0.85,      // Less frequent irrigation, lower Kc
            'medium': 1.0,    // Standard maintenance
            'high': 1.15      // Golf course level, higher Kc
        }[managementLevel] || 1.0;
        
        let baseKc = 0.7; // Default
        
        if (grassType === 'cool-season') {
            switch (variety) {
                case 'kentucky-bluegrass':
                    baseKc = 0.8;  // Higher water needs, dense growth
                    break;
                case 'tall-fescue':
                    baseKc = 0.65; // More drought tolerant
                    break;
                case 'perennial-rye':
                    baseKc = 0.75; // Moderate water needs
                    break;
                case 'fine-fescue':
                    baseKc = 0.55; // Very drought tolerant
                    break;
                case 'cool-mix':
                    baseKc = 0.7;  // Balanced mix
                    break;
            }
        } else if (grassType === 'warm-season') {
            switch (variety) {
                case 'bermuda':
                    baseKc = 0.75; // Efficient but needs water during growth
                    break;
                case 'zoysia':
                    baseKc = 0.6;  // Very drought tolerant
                    break;
                case 'st-augustine':
                    baseKc = 0.8;  // Higher water needs
                    break;
                case 'centipede':
                    baseKc = 0.5;  // Low maintenance, low water
                    break;
                case 'buffalo':
                    baseKc = 0.4;  // Extremely drought tolerant
                    break;
            }
        } else if (grassType === 'native') {
            baseKc = 0.3; // Native grasses typically very drought tolerant
        }
        
        return baseKc * managementMultiplier;
    }
    
    /**
     * Seasonal Kc adjustments based on growth patterns
     */
    private static getSeasonalKc(grassType: GrassType, dayOfYear: number, usdaZone: string): number {
        const zoneData = USDA_ZONE_DATA[usdaZone] || USDA_ZONE_DATA['5b'];
        
        if (grassType === 'cool-season') {
            // Cool season grass growth pattern
            if (dayOfYear < zoneData.lastFrost) {
                return 0.3; // Dormant winter period
            } else if (dayOfYear < zoneData.lastFrost + 60) {
                return 1.2; // Spring green-up and establishment (high water needs)
            } else if (dayOfYear >= zoneData.summerStressStart && dayOfYear <= zoneData.summerStressEnd) {
                return 0.7; // Summer stress/semi-dormancy
            } else if (dayOfYear > zoneData.summerStressEnd && dayOfYear < zoneData.firstFrost) {
                return 1.1; // Fall recovery period (high water needs)
            } else {
                return 0.4; // Late fall transition to dormancy
            }
        } else if (grassType === 'warm-season') {
            // Warm season grass growth pattern (opposite of cool season)
            if (dayOfYear < zoneData.lastFrost + 30) {
                return 0.2; // Dormant period
            } else if (dayOfYear < zoneData.lastFrost + 90) {
                return 1.1; // Spring green-up
            } else if (dayOfYear >= zoneData.summerStressStart && dayOfYear <= zoneData.summerStressEnd) {
                return 1.2; // Peak growing season
            } else if (dayOfYear > zoneData.firstFrost - 30) {
                return 0.5; // Fall dormancy transition
            } else {
                return 0.9; // Normal growing season
            }
        }
        
        return 1.0; // Default for native/mixed
    }
    
    /**
     * Temperature stress adjustments
     */
    private static getTemperatureStressAdjustment(grassType: GrassType, temp: number, dayOfYear: number, usdaZone: string): number {
        if (grassType === 'cool-season') {
            if (temp > 85) {
                return 1.3; // High heat stress, increased water needs
            } else if (temp > 80) {
                return 1.15; // Moderate heat stress
            } else if (temp < 40) {
                return 0.3; // Cold, minimal transpiration
            } else if (temp < 50) {
                return 0.6; // Cool weather, reduced needs
            }
            return 1.0; // Optimal temperature range (50-80°F)
        } else if (grassType === 'warm-season') {
            if (temp > 95) {
                return 1.2; // Even warm season grasses stress in extreme heat
            } else if (temp > 85) {
                return 1.1; // Optimal growing conditions
            } else if (temp < 45) {
                return 0.1; // Near dormancy
            } else if (temp < 60) {
                return 0.4; // Cool weather stress
            }
            return 1.0; // Good growing conditions
        }
        
        return 1.0; // Default
    }
    
    /**
     * Moisture adjustment based on recent precipitation
     */
    private static getMoistureAdjustment(recentPrecip: number, grassType: GrassType): number {
        // Recent significant rainfall reduces immediate water needs
        if (recentPrecip > 1.0) {
            return 0.6; // Significant recent rainfall
        } else if (recentPrecip > 0.5) {
            return 0.8; // Moderate recent rainfall
        } else if (recentPrecip > 0.25) {
            return 0.9; // Light recent rainfall
        }
        
        // No recent rainfall - potential drought stress
        return 1.1;
    }
    
    /**
     * Growth stage adjustments throughout the season
     */
    private static getGrowthStageAdjustment(grassType: GrassType, dayOfYear: number, usdaZone: string, temp: number): number {
        const zoneData = USDA_ZONE_DATA[usdaZone] || USDA_ZONE_DATA['5b'];
        
        if (grassType === 'cool-season') {
            // Spring establishment phase
            if (dayOfYear >= zoneData.lastFrost && dayOfYear <= zoneData.lastFrost + 45) {
                return 1.2; // Root development and tillering
            }
            // Fall establishment phase  
            if (dayOfYear >= zoneData.summerStressEnd && dayOfYear <= zoneData.summerStressEnd + 45) {
                return 1.15; // Fall root growth and recovery
            }
            // Summer survival mode
            if (dayOfYear >= zoneData.summerStressStart && dayOfYear <= zoneData.summerStressEnd && temp > 80) {
                return 0.8; // Reduced growth, survival mode
            }
        }
        
        return 1.0; // Normal growth
    }
    
    /**
     * Get irrigation efficiency factor based on system type and management
     */
    static getIrrigationEfficiency(systemType: 'sprinkler' | 'drip' | 'micro' | 'manual' = 'sprinkler'): number {
        const efficiencies = {
            'drip': 0.9,        // Very efficient
            'micro': 0.85,      // High efficiency  
            'sprinkler': 0.75,  // Standard efficiency
            'manual': 0.6       // Lower efficiency due to inconsistency
        };
        
        return efficiencies[systemType] || 0.75;
    }
}

/**
 * Enhanced ETo calculation with comprehensive turfgrass management
 */
async function calculateEToWateringScale(
    adjustmentOptions: EToScalingAdjustmentOptions,
    coordinates: GeoCoordinates,
    weatherProvider: WeatherProvider,
    pws?: PWS
): Promise< AdjustmentMethodResponse > {

    console.log("DEBUG: Enhanced EToAdjustmentMethod with Crop Coefficients - Starting calculation");

    // Get required parameters
    let baseETo: number;
    let elevation = 600; // Default elevation

    if ( adjustmentOptions && "baseETo" in adjustmentOptions ) {
        baseETo = adjustmentOptions.baseETo;
    } else {
        throw new CodedError( ErrorCode.MissingAdjustmentOption );
    }

    if ( !Number.isFinite( baseETo ) || baseETo <= 0 ) {
        throw new CodedError( ErrorCode.MissingAdjustmentOption, "baseETo must be a finite number greater than 0." );
    }

    if ( adjustmentOptions && "elevation" in adjustmentOptions ) {
        elevation = adjustmentOptions.elevation;
    }

    // Get turfgrass parameters from options or environment
    const grassType = adjustmentOptions.grassType || process.env.GRASS_TYPE as GrassType || 'cool-season';
    const grassVariety = adjustmentOptions.grassVariety || process.env.GRASS_VARIETY || 'cool-mix';
    const usdaZone = adjustmentOptions.usdaZone || process.env.USDA_ZONE || '5b';
    const managementLevel = adjustmentOptions.managementLevel || process.env.MANAGEMENT_LEVEL as any || 'medium';
    const irrigationSystem = adjustmentOptions.irrigationSystem || process.env.IRRIGATION_SYSTEM as any || 'sprinkler';
    const enableCropCoefficient = adjustmentOptions.enableCropCoefficient ?? 
                                 (process.env.ENABLE_CROP_COEFFICIENT !== 'false');

    // Get historical ETo data
    const historicalEtoData: EToData = await weatherProvider.getEToData( coordinates, pws );
    const historicalEto: number = calculateETo( historicalEtoData, elevation, coordinates );

    console.log(`DEBUG: Historical ETo: ${historicalEto}, Grass: ${grassType}/${grassVariety}, Zone: ${usdaZone}`);

    let finalScale: number;
    let rawData: any;
    let method: string = "historical-only";
    let cropFactors: any = {};

    // Calculate crop coefficient if enabled
    let cropCoefficient = 1.0;
    if (enableCropCoefficient) {
        const avgTemp = (historicalEtoData.maxTemp + historicalEtoData.minTemp) / 2;
        const dayOfYear = moment.unix(historicalEtoData.periodStartTime).dayOfYear();

        const kcResult = resolveCropCoefficient(
            adjustmentOptions,
            dayOfYear,
            () => TurfgrassManager.calculateCropCoefficient(
                grassType,
                grassVariety,
                coordinates,
                usdaZone,
                avgTemp,
                historicalEtoData.precip,
                dayOfYear,
                managementLevel
            )
        );

        cropCoefficient = kcResult.kc;
        cropFactors = kcResult.factors;

        console.log(`DEBUG: Crop coefficient resolved: ${cropCoefficient} (source: ${cropFactors && cropFactors.source})`);
    }

    // Get irrigation efficiency
    const irrigationEfficiency = TurfgrassManager.getIrrigationEfficiency(irrigationSystem);

    // Try enhanced forecast integration if provider supports it
    if (supportsForecast(weatherProvider)) {
        const enableForecast = process.env.ENABLE_FORECAST !== 'false';
        
        if (enableForecast) {
            console.log("DEBUG: Attempting enhanced forecast integration with crop coefficients");
            
            try {
                const forecastDays = parseInt(process.env.FORECAST_DAYS) || 3;
                const forecastData = await weatherProvider.getForecastData(coordinates, forecastDays, pws);
                const bestMethod = weatherProvider.getBestForecastMethod(forecastData);
                
                console.log(`DEBUG: Forecast method: ${bestMethod}, crop Kc: ${cropCoefficient}`);
                
                switch(bestMethod) {
                    case 'full':
                        ({ scale: finalScale, rawData, method } = calculateFullForecastScaleWithCrop(
                            historicalEto, historicalEtoData, forecastData, baseETo, elevation, coordinates, 
                            adjustmentOptions, cropCoefficient, irrigationEfficiency, cropFactors));
                        break;
                    case 'hybrid':
                        ({ scale: finalScale, rawData, method } = calculateHybridForecastScaleWithCrop(
                            historicalEto, historicalEtoData, forecastData, baseETo, elevation, coordinates, 
                            adjustmentOptions, cropCoefficient, irrigationEfficiency, cropFactors));
                        break;
                    case 'precip':
                        ({ scale: finalScale, rawData, method } = calculatePrecipForecastScaleWithCrop(
                            historicalEto, historicalEtoData, forecastData, baseETo, 
                            adjustmentOptions, cropCoefficient, irrigationEfficiency, cropFactors));
                        break;
                    default:
                        ({ scale: finalScale, rawData, method } = calculateHistoricalOnlyScaleWithCrop(
                            historicalEto, historicalEtoData, baseETo, cropCoefficient, irrigationEfficiency, cropFactors));
                }
            } catch (err) {
                console.error("DEBUG: Forecast integration failed, falling back to historical:", err.message);
                ({ scale: finalScale, rawData, method } = calculateHistoricalOnlyScaleWithCrop(
                    historicalEto, historicalEtoData, baseETo, cropCoefficient, irrigationEfficiency, cropFactors));
                method = "historical-fallback";
                rawData.forecastError = err.message;
            }
        } else {
            ({ scale: finalScale, rawData, method } = calculateHistoricalOnlyScaleWithCrop(
                historicalEto, historicalEtoData, baseETo, cropCoefficient, irrigationEfficiency, cropFactors));
        }
    } else {
        ({ scale: finalScale, rawData, method } = calculateHistoricalOnlyScaleWithCrop(
            historicalEto, historicalEtoData, baseETo, cropCoefficient, irrigationEfficiency, cropFactors));
    }

    console.log(`DEBUG: Final scale: ${finalScale} using method: ${method} with Kc: ${cropCoefficient}`);

    return {
        scale: Math.floor( Math.min( Math.max( 0, finalScale ), 200 ) ),
        rawData: {
            ...rawData,
            method: method,
            wp: historicalEtoData.weatherProvider,
            historical_eto: Math.round( historicalEto * 1000) / 1000,
            crop_coefficient: Math.round( cropCoefficient * 100) / 100,
            irrigation_efficiency: Math.round( irrigationEfficiency * 100) / 100,
            crop_factors: cropFactors
        },
        wateringData: historicalEtoData
    }
}

/**
 * Enhanced calculation functions with crop coefficient support
 */

/**
 * Estimate daily reference ETo with the Hargreaves-Samani temperature method. It derives
 * extraterrestrial radiation from latitude and day-of-year, then converts the result to inches/day.
 * This is intentionally an approximation for forecasts that lack radiation, humidity, and wind data;
 * it should not be treated as equivalent to a full FAO-56 Penman-Monteith calculation.
 */
export function calculateHargreavesSamaniETo(maxTempF: number, minTempF: number, coordinates: GeoCoordinates, periodStartTime: number): number {
    const maxTempC = (maxTempF - 32) * 5 / 9;
    const minTempC = (minTempF - 32) * 5 / 9;
    const avgTempC = (maxTempC + minTempC) / 2;
    const dayOfYear = moment.unix(periodStartTime).dayOfYear();

    const inverseRelativeEarthSunDistance = 1 + 0.033 * Math.cos(2 * Math.PI / 365 * dayOfYear);
    const solarDeclination = 0.409 * Math.sin(2 * Math.PI / 365 * dayOfYear - 1.39);
    const latitudeRads = Math.PI / 180 * coordinates[0];
    const sunsetHourAngleArgument = -Math.tan(latitudeRads) * Math.tan(solarDeclination);
    const sunsetHourAngle = Math.acos(Math.max(-1, Math.min(1, sunsetHourAngleArgument)));
    const extraterrestrialRadiationMj = 24 * 60 / Math.PI * 0.0820 * inverseRelativeEarthSunDistance *
        (sunsetHourAngle * Math.sin(latitudeRads) * Math.sin(solarDeclination) +
        Math.cos(latitudeRads) * Math.cos(solarDeclination) * Math.sin(sunsetHourAngle));
    const extraterrestrialRadiationMm = 0.408 * extraterrestrialRadiationMj;

    const tempRangeC = Math.max(0, maxTempC - minTempC);
    const etoMm = 0.0023 * (avgTempC + 17.8) * Math.sqrt(tempRangeC) * extraterrestrialRadiationMm;

    return Math.max(0, etoMm / 25.4);
}

function calculateFullForecastScaleWithCrop(
    historicalEto: number,
    historicalData: EToData,
    forecastData: ForecastEToData[],
    baseETo: number,
    elevation: number,
    coordinates: GeoCoordinates,
    options: EToScalingAdjustmentOptions,
    cropCoefficient: number,
    irrigationEfficiency: number,
    cropFactors: any
): { scale: number, rawData: any, method: string } {
    
    const forecastWeight = parseFloat(process.env.FORECAST_WEIGHT) || 0.3;
    const precipThreshold = parseFloat(process.env.FORECAST_PRECIP_THRESHOLD) || 0.5;
    
    // Calculate crop-adjusted ETo for historical and forecast
    const cropEtoHistorical = historicalEto * cropCoefficient;
    
    let forecastEtoSum = 0;
    let totalForecastPrecip = 0;
    
    for (const dayData of forecastData) {
        const dailyEto = calculateETo(dayData, elevation, coordinates);
        const cropAdjustedDaily = dailyEto * cropCoefficient;
        forecastEtoSum += cropAdjustedDaily;
        totalForecastPrecip += dayData.precip;
    }
    
    const avgForecastCropEto = forecastEtoSum / forecastData.length;
    const combinedCropEto = (cropEtoHistorical * (1 - forecastWeight)) + (avgForecastCropEto * forecastWeight);
    
    // Enhanced rain adjustment with turfgrass considerations
    let rainAdjustment = 1.0;
    if (totalForecastPrecip > precipThreshold) {
        const reductionFactor = Math.min(totalForecastPrecip / precipThreshold, 3.0);
        rainAdjustment = Math.max(0.1, 1.0 - (reductionFactor * 0.3));
        console.log(`DEBUG: Rain adjustment: ${rainAdjustment} due to ${totalForecastPrecip}" forecast precipitation`);
    }
    
    // Apply irrigation efficiency
    const effectiveCropEto = Math.max(0, combinedCropEto - historicalData.precip);
    const irrigationAdjustedEto = effectiveCropEto / irrigationEfficiency;
    const baseScale = (irrigationAdjustedEto / baseETo * 100);
    const finalScale = baseScale * rainAdjustment;
    
    return {
        scale: finalScale,
        rawData: {
            historical_eto: Math.round(historicalEto * 1000) / 1000,
            historical_crop_eto: Math.round(cropEtoHistorical * 1000) / 1000,
            forecast_crop_eto_avg: Math.round(avgForecastCropEto * 1000) / 1000,
            combined_crop_eto: Math.round(combinedCropEto * 1000) / 1000,
            irrigation_adjusted_eto: Math.round(irrigationAdjustedEto * 1000) / 1000,
            forecast_weight: forecastWeight,
            forecast_precip_total: Math.round(totalForecastPrecip * 100) / 100,
            rain_adjustment: Math.round(rainAdjustment * 100) / 100,
            base_scale: Math.round(baseScale * 10) / 10,
            // Historical data for compatibility
            eto: Math.round( historicalEto * 1000) / 1000,
            radiation: Math.round( historicalData.solarRadiation * 100) / 100,
            minT: Math.round( historicalData.minTemp ),
            maxT: Math.round( historicalData.maxTemp ),
            minH: Math.round( historicalData.minHumidity ),
            maxH: Math.round( historicalData.maxHumidity ),
            wind: Math.round( historicalData.windSpeed * 10 ) / 10,
            p: Math.round( historicalData.precip * 100 ) / 100
        },
        method: "full-forecast-crop"
    };
}

function calculateHybridForecastScaleWithCrop(
    historicalEto: number,
    historicalData: EToData,
    forecastData: ForecastEToData[],
    baseETo: number,
    elevation: number,
    coordinates: GeoCoordinates,
    options: EToScalingAdjustmentOptions,
    cropCoefficient: number,
    irrigationEfficiency: number,
    cropFactors: any
): { scale: number, rawData: any, method: string } {
    
    const forecastWeight = (parseFloat(process.env.FORECAST_WEIGHT) || 0.3) * 0.7;
    const precipThreshold = parseFloat(process.env.FORECAST_PRECIP_THRESHOLD) || 0.5;
    
    const cropEtoHistorical = historicalEto * cropCoefficient;
    
    let forecastEtoSum = 0;
    let totalForecastPrecip = 0;
    
    for (const dayData of forecastData) {
        let dailyEto: number;
        if (dayData.estimatedFields.length > 2) {
            // Hargreaves temperature-only fallback used when too many fields are estimated.
            dailyEto = calculateHargreavesSamaniETo(dayData.maxTemp, dayData.minTemp, coordinates, dayData.periodStartTime);
        } else {
            dailyEto = calculateETo(dayData, elevation, coordinates);
        }
        
        const cropAdjustedDaily = dailyEto * cropCoefficient;
        forecastEtoSum += cropAdjustedDaily;
        totalForecastPrecip += dayData.precip;
    }
    
    const avgForecastCropEto = forecastEtoSum / forecastData.length;
    const combinedCropEto = (cropEtoHistorical * (1 - forecastWeight)) + (avgForecastCropEto * forecastWeight);
    
    let rainAdjustment = 1.0;
    if (totalForecastPrecip > precipThreshold) {
        const reductionFactor = Math.min(totalForecastPrecip / precipThreshold, 2.0);
        rainAdjustment = Math.max(0.2, 1.0 - (reductionFactor * 0.2));
    }
    
    const effectiveCropEto = Math.max(0, combinedCropEto - historicalData.precip);
    const irrigationAdjustedEto = effectiveCropEto / irrigationEfficiency;
    const baseScale = (irrigationAdjustedEto / baseETo * 100);
    const finalScale = baseScale * rainAdjustment;
    
    return {
        scale: finalScale,
        rawData: {
            historical_crop_eto: Math.round(cropEtoHistorical * 1000) / 1000,
            forecast_crop_eto_avg: Math.round(avgForecastCropEto * 1000) / 1000,
            combined_crop_eto: Math.round(combinedCropEto * 1000) / 1000,
            irrigation_adjusted_eto: Math.round(irrigationAdjustedEto * 1000) / 1000,
            forecast_weight: forecastWeight,
            forecast_precip_total: Math.round(totalForecastPrecip * 100) / 100,
            rain_adjustment: Math.round(rainAdjustment * 100) / 100,
            estimated_fields: forecastData[0].estimatedFields,
            base_scale: Math.round(baseScale * 10) / 10,
            // Historical data for compatibility
            eto: Math.round( historicalEto * 1000) / 1000,
            radiation: Math.round( historicalData.solarRadiation * 100) / 100,
            minT: Math.round( historicalData.minTemp ),
            maxT: Math.round( historicalData.maxTemp ),
            minH: Math.round( historicalData.minHumidity ),
            maxH: Math.round( historicalData.maxHumidity ),
            wind: Math.round( historicalData.windSpeed * 10 ) / 10,
            p: Math.round( historicalData.precip * 100 ) / 100
        },
        method: "hybrid-forecast-crop"
    };
}

function calculatePrecipForecastScaleWithCrop(
    historicalEto: number,
    historicalData: EToData,
    forecastData: ForecastEToData[],
    baseETo: number,
    options: EToScalingAdjustmentOptions,
    cropCoefficient: number,
    irrigationEfficiency: number,
    cropFactors: any
): { scale: number, rawData: any, method: string } {
    
    const precipThreshold = parseFloat(process.env.FORECAST_PRECIP_THRESHOLD) || 0.5;
    
    let totalForecastPrecip = 0;
    for (const dayData of forecastData) {
        totalForecastPrecip += dayData.precip;
    }
    
    let rainAdjustment = 1.0;
    if (totalForecastPrecip > precipThreshold) {
        const reductionFactor = Math.min(totalForecastPrecip / precipThreshold, 2.5);
        rainAdjustment = Math.max(0.15, 1.0 - (reductionFactor * 0.25));
    }
    
    const cropEtoHistorical = historicalEto * cropCoefficient;
    const effectiveCropEto = Math.max(0, cropEtoHistorical - historicalData.precip);
    const irrigationAdjustedEto = effectiveCropEto / irrigationEfficiency;
    const baseScale = (irrigationAdjustedEto / baseETo * 100);
    const finalScale = baseScale * rainAdjustment;
    
    return {
        scale: finalScale,
        rawData: {
		   historical_crop_eto: Math.round(cropEtoHistorical * 1000) / 1000,
		   irrigation_adjusted_eto: Math.round(irrigationAdjustedEto * 1000) / 1000,
		   forecast_precip_total: Math.round(totalForecastPrecip * 100) / 100,
		   rain_adjustment: Math.round(rainAdjustment * 100) / 100,
           base_scale: Math.round(baseScale * 10) / 10,
           // Historical data for compatibility
           eto: Math.round( historicalEto * 1000) / 1000,
           radiation: Math.round( historicalData.solarRadiation * 100) / 100,
           minT: Math.round( historicalData.minTemp ),
           maxT: Math.round( historicalData.maxTemp ),
           minH: Math.round( historicalData.minHumidity ),
           maxH: Math.round( historicalData.maxHumidity ),
           wind: Math.round( historicalData.windSpeed * 10 ) / 10,
           p: Math.round( historicalData.precip * 100 ) / 100
       },
       method: "precip-forecast-crop"
   };
}

function calculateHistoricalOnlyScaleWithCrop(
   historicalEto: number,
   historicalData: EToData,
   baseETo: number,
   cropCoefficient: number,
   irrigationEfficiency: number,
   cropFactors: any
): { scale: number, rawData: any, method: string } {
   
   const cropEtoHistorical = historicalEto * cropCoefficient;
   const effectiveCropEto = Math.max(0, cropEtoHistorical - historicalData.precip);
   const irrigationAdjustedEto = effectiveCropEto / irrigationEfficiency;
   const scale = (irrigationAdjustedEto / baseETo * 100);
   
   return {
       scale: scale,
       rawData: {
           historical_crop_eto: Math.round(cropEtoHistorical * 1000) / 1000,
           irrigation_adjusted_eto: Math.round(irrigationAdjustedEto * 1000) / 1000,
           // Historical data for compatibility
           eto: Math.round( historicalEto * 1000) / 1000,
           radiation: Math.round( historicalData.solarRadiation * 100) / 100,
           minT: Math.round( historicalData.minTemp ),
           maxT: Math.round( historicalData.maxTemp ),
           minH: Math.round( historicalData.minHumidity ),
           maxH: Math.round( historicalData.maxHumidity ),
           wind: Math.round( historicalData.windSpeed * 10 ) / 10,
           p: Math.round( historicalData.precip * 100 ) / 100
       },
       method: "historical-only-crop"
   };
}

/* The implementation of this algorithm was guided by a step-by-step breakdown
   (http://edis.ifas.ufl.edu/pdffiles/ae/ae45900.pdf) */
/**
* Calculates the reference potential evapotranspiration using the Penman-Monteith (FAO-56) method
* (http://www.fao.org/3/X0490E/x0490e07.htm).
*
* @param etoData The data to calculate the ETo with.
* @param elevation The elevation above sea level of the watering site (in feet).
* @param coordinates The coordinates of the watering site.
* @return The reference potential evapotranspiration (in inches per day).
*/
export function calculateETo( etoData: EToData, elevation: number, coordinates: GeoCoordinates ): number {
   // Convert to Celsius.
   const minTemp = ( etoData.minTemp - 32 ) * 5 / 9;
   const maxTemp = ( etoData.maxTemp - 32 ) * 5 / 9;
   // Convert to meters.
   elevation = elevation / 3.281;
   // Convert to meters per second.
   const windSpeed = etoData.windSpeed / 2.237;
   // Convert to megajoules.
   const solarRadiation = etoData.solarRadiation * 3.6;

   const avgTemp = ( maxTemp + minTemp ) / 2;

   const saturationVaporPressureCurveSlope = 4098 * 0.6108 * Math.exp( 17.27 * avgTemp / ( avgTemp + 237.3 ) ) / Math.pow( avgTemp + 237.3, 2 );

   const pressure = 101.3 * Math.pow( ( 293 - 0.0065 * elevation ) / 293, 5.26 );

   const psychrometricConstant = 0.000665 * pressure;

   const deltaTerm = saturationVaporPressureCurveSlope / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

   const psiTerm = psychrometricConstant / ( saturationVaporPressureCurveSlope + psychrometricConstant * ( 1 + 0.34 * windSpeed ) );

   const tempTerm = ( 900 / ( avgTemp + 273 ) ) * windSpeed;

   const minSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * minTemp / ( minTemp + 237.3 ) );

   const maxSaturationVaporPressure = 0.6108 * Math.exp( 17.27 * maxTemp / ( maxTemp + 237.3 ) );

   const avgSaturationVaporPressure = ( minSaturationVaporPressure + maxSaturationVaporPressure ) / 2;

   const actualVaporPressure = ( minSaturationVaporPressure * etoData.maxHumidity / 100 + maxSaturationVaporPressure * etoData.minHumidity / 100 ) / 2;

   const dayOfYear = moment.unix( etoData.periodStartTime ).dayOfYear();

   const inverseRelativeEarthSunDistance = 1 + 0.033 * Math.cos( 2 * Math.PI / 365 * dayOfYear );

   const solarDeclination = 0.409 * Math.sin( 2 * Math.PI / 365 * dayOfYear - 1.39 );

   const latitudeRads = Math.PI / 180 * coordinates[ 0 ];

   const sunsetHourAngleArgument = -Math.tan( latitudeRads ) * Math.tan( solarDeclination );
   const sunsetHourAngle = Math.acos( Math.max( -1, Math.min( 1, sunsetHourAngleArgument ) ) );

   const extraterrestrialRadiation = 24 * 60 / Math.PI * 0.082 * inverseRelativeEarthSunDistance * ( sunsetHourAngle * Math.sin( latitudeRads ) * Math.sin( solarDeclination ) + Math.cos( latitudeRads ) * Math.cos( solarDeclination ) * Math.sin( sunsetHourAngle ) );

   const clearSkyRadiation = ( 0.75 + 2e-5 * elevation ) * extraterrestrialRadiation;

   const netShortWaveRadiation = ( 1 - 0.23 ) * solarRadiation;

   const clearSkyRadiationRatio = Number.isFinite( clearSkyRadiation ) && clearSkyRadiation > 0 ? solarRadiation / clearSkyRadiation : 0;
   const netOutgoingLongWaveRadiation = 4.903e-9 * ( Math.pow( maxTemp + 273.16, 4 ) + Math.pow( minTemp + 273.16, 4 ) ) / 2 * ( 0.34 - 0.14 * Math.sqrt( actualVaporPressure ) ) * ( 1.35 * clearSkyRadiationRatio - 0.35);

   const netRadiation = netShortWaveRadiation - netOutgoingLongWaveRadiation;

   const radiationTerm = deltaTerm * 0.408 * netRadiation;

   const windTerm = psiTerm * tempTerm * ( avgSaturationVaporPressure - actualVaporPressure );

   return ( windTerm + radiationTerm ) / 25.4;
}

/**
* Approximates the wind speed at 2 meters using the wind speed measured at another height.
* @param speed The wind speed measured at the specified height (in miles per hour).
* @param height The height of the measurement (in feet).
* @returns The approximate wind speed at 2 meters (in miles per hour).
*/
export function standardizeWindSpeed( speed: number, height: number ) {
   return speed * 4.87 / Math.log( 67.8 * height / 3.281 - 5.42 );
}

/* For hours where the Sun is too low to emit significant radiation, the formula for clear sky isolation will yield a
* negative value. "radiationStart" marks the times of day when the Sun will rise high for solar isolation formula to
* become positive, and "radiationEnd" marks the time of day when the Sun sets low enough that the equation will yield
* a negative result. For any times outside of these ranges, the formula will yield incorrect results (they should be
* clamped at 0 instead of being negative).
*/
SunCalc.addTime( Math.asin( 30 / 990 ) * 180 / Math.PI, "radiationStart", "radiationEnd" );

/**
* Approximates total solar radiation for a day given cloud coverage information using a formula from
* http://www.shodor.org/os411/courses/_master/tools/calculators/solarrad/
* @param cloudCoverInfo Information about the cloud coverage for several periods that span the entire day.
* @param coordinates The coordinates of the location the data is from.
* @return The total solar radiation for the day (in kilowatt hours per square meter per day).
*/
export function approximateSolarRadiation(cloudCoverInfo: CloudCoverInfo[], coordinates: GeoCoordinates ): number {
   return cloudCoverInfo.reduce( ( total, window: CloudCoverInfo ) => {
   	const radiationStart: moment.Moment = moment( SunCalc.getTimes( window.endTime.toDate(), coordinates[ 0 ], coordinates[ 1 ])[ "radiationStart" ] );
   	const radiationEnd: moment.Moment = moment( SunCalc.getTimes( window.startTime.toDate(), coordinates[ 0 ], coordinates[ 1 ])[ "radiationEnd" ] );

   	// Clamp the start and end times of the window within time when the sun was emitting significant radiation.
   	const startTime: moment.Moment = radiationStart.isAfter( window.startTime ) ? radiationStart : window.startTime;
   	const endTime: moment.Moment = radiationEnd.isBefore( window.endTime ) ? radiationEnd: window.endTime;

   	// The length of the window that will actually be used (in hours).
   	const windowLength = ( endTime.unix() - startTime.unix() ) / 60 / 60;

   	// Skip the window if there is no significant radiation during the time period.
   	if ( windowLength <= 0 ) {
   		return total;
   	}

   	const startPosition = SunCalc.getPosition( startTime.toDate(), coordinates[ 0 ], coordinates[ 1 ] );
   	const endPosition = SunCalc.getPosition( endTime.toDate(), coordinates[ 0 ], coordinates[ 1 ] );
   	const solarElevationAngle = ( startPosition.altitude + endPosition.altitude ) / 2;

   	// Calculate radiation and convert from watts to kilowatts.
   	const clearSkyIsolation = ( 990 * Math.sin( solarElevationAngle ) - 30 ) / 1000 * windowLength;

   	return total + clearSkyIsolation * ( 1 - 0.75 * Math.pow( window.cloudCover, 3.4 ) );
   }, 0 );
}

export interface EToScalingAdjustmentOptions extends AdjustmentOptions {
   /** The watering site's height above sea level (in feet). */
   elevation?: number;
   /** Baseline potential ETo (in inches per day). */
   baseETo?: number;
   /** NEW: Turfgrass type for crop coefficient calculation */
   grassType?: GrassType;
   /** NEW: Specific grass variety */
   grassVariety?: string;
   /** NEW: USDA hardiness zone */
   usdaZone?: string;
   /** NEW: Management intensity level */
   managementLevel?: 'low' | 'medium' | 'high';
   /** NEW: Irrigation system type for efficiency calculation */
   irrigationSystem?: 'sprinkler' | 'drip' | 'micro' | 'manual';
   /** NEW: Enable/disable crop coefficient calculations */
   enableCropCoefficient?: boolean;
   /** NEW: Custom crop coefficient override */
   customCropCoefficient?: number;
   /** NEW: Named plant preset selecting a seasonal Kc curve (see PlantCoefficients). */
   plantType?: string;
}

/** Data about the cloud coverage for a period of time. */
export interface CloudCoverInfo {
   /** The start of this period of time. */
   startTime: moment.Moment;
   /** The end of this period of time. */
   endTime: moment.Moment;
   /** The average fraction of the sky covered by clouds during this time period. */
   cloudCover: number;
}

/**
* Data used to calculate ETo. This data should be taken from a 24 hour time window.
*/
export interface EToData extends BaseWateringData {
   /** The Unix epoch seconds timestamp of the start of this 24 hour time window. */
   periodStartTime: number;
   /** The minimum temperature over the time period (in Fahrenheit). */
   minTemp: number;
   /** The maximum temperature over the time period (in Fahrenheit). */
   maxTemp: number;
   /** The minimum relative humidity over the time period (as a percentage). */
   minHumidity: number;
   /** The maximum relative humidity over the time period (as a percentage). */
   maxHumidity: number;
   /** The solar radiation, accounting for cloud coverage (in kilowatt hours per square meter per day). */
   solarRadiation: number;
   /**
    * The average wind speed measured at 2 meters over the time period (in miles per hour). A measurement taken at a
    * different height can be standardized to 2m using the `standardizeWindSpeed` function in EToAdjustmentMethod.
    */
   windSpeed: number;
}

const EToAdjustmentMethod: AdjustmentMethod = {
   calculateWateringScale: calculateEToWateringScale
};
export default EToAdjustmentMethod;
