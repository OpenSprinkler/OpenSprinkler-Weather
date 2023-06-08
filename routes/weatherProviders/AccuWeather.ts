import * as moment from "moment-timezone";

import {
  GeoCoordinates,
  WeatherData,
  ZimmermanWateringData,
} from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";
import {
  approximateSolarRadiation,
  CloudCoverInfo,
  EToData,
	standardizeWindSpeed,
} from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";
import {
  Conditions,
  DailyForecasts,
  LocationData,
} from "./AccuWeatherTypes";

export default class AccuWeather extends WeatherProvider {
  private readonly API_KEY: string;

  public constructor() {
    super();
    this.API_KEY = process.env.ACCUWEATHER_API_KEY;
    if (!this.API_KEY) {
      throw "ACCUWEATHER_API_KEY environment variable is not defined.";
    }
  }

  public async getWateringData(
    coordinates: GeoCoordinates
  ): Promise<ZimmermanWateringData> {

		const location = await this.getLocationData(coordinates);
    const yesterdayUrl = `http://dataservice.accuweather.com/currentconditions/v1/${location.Key}/historical/24?apikey=${this.API_KEY}&details=true`;

    let yesterdayData: Conditions[];
    try {
      yesterdayData = await httpJSONRequest(yesterdayUrl);
    } catch (err) {
      console.error(
        "Error retrieving weather information from AccuWeather:",
        err
      );
      throw new CodedError(ErrorCode.WeatherApiError);
    }

    if (!yesterdayData) {
      throw new CodedError(ErrorCode.MissingWeatherField);
    }

    const samples = yesterdayData;

    // Fail if not enough data is available.
    // There will only be 23 samples on the day that daylight saving time begins.
    if (samples.length !== 24 && samples.length !== 23) {
      throw new CodedError(ErrorCode.InsufficientWeatherData);
    }

    const totals = { temp: 0, humidity: 0 };
    for (const sample of samples) {
      /*
       * If temperature or humidity is missing from a sample, the total will become NaN. This is intended since
       * calculateWateringScale will treat NaN as a missing value and temperature/humidity can't be accurately
       * calculated when data is missing from some samples (since they follow diurnal cycles and will be
       * significantly skewed if data is missing for several consecutive hours).
       */
      totals.temp += sample.Temperature.Imperial.Value;
      totals.humidity += sample.RelativeHumidity;
    }

    return {
      weatherProvider: "AW",
      temp: totals.temp / samples.length,
      humidity: (totals.humidity / samples.length),
      precip: yesterdayData[0].PrecipitationSummary.Past24Hours.Imperial.Value,
      raining: samples[samples.length - 1].HasPrecipitation,
    };
  }

  public async getWeatherData(
    coordinates: GeoCoordinates
  ): Promise<WeatherData> {
    let location = await this.getLocationData(coordinates);

    const currentUrl = `http://dataservice.accuweather.com/currentconditions/v1/${location.Key}?apikey=${this.API_KEY}&details=true`,
      forecastDailyUrl = `http://dataservice.accuweather.com/forecasts/v1/daily/10day/${location.Key}?apikey=${this.API_KEY}&details=true`;

    let current: Conditions[];
    let forecast: DailyForecasts;
    try {
      current = await httpJSONRequest(currentUrl);
      forecast = await httpJSONRequest(forecastDailyUrl);
    } catch (err) {
      console.error(
        "Error retrieving weather information from AccuWeather:",
        err
      );
      throw "An error occurred while retrieving weather information from AccuWeather.";
    }

    if (!current || current.length == 0 || !forecast?.DailyForecasts) {
      throw "Necessary field(s) were missing from weather information returned by AccuWeather.";
    }

    const weather: WeatherData = {
      weatherProvider: "AccuWeather",
      temp: Math.floor(current[0].Temperature.Imperial.Value),
      humidity: Math.floor(current[0].RelativeHumidity),
      wind: Math.floor(current[0].Wind.Speed.Imperial.Value),
      description: current[0].WeatherText,
      icon: this.getOWMIconCode(current[0].WeatherIcon),

      region: location.Region.EnglishName,
      city: location.EnglishName,
      minTemp: Math.floor(
        forecast.DailyForecasts[0].Temperature.Minimum.Value
      ),
      maxTemp: Math.floor(
        forecast.DailyForecasts[0].Temperature.Maximum.Value
      ),
      precip:
        forecast.DailyForecasts[0].Day.TotalLiquid.Value +
        forecast.DailyForecasts[0].Night.TotalLiquid.Value,
      forecast: [],
    };

    for (let index = 0; index < forecast.DailyForecasts.length; index++) {
      const day = forecast.DailyForecasts[index];
      weather.forecast.push({
        temp_min: Math.floor(day.Temperature.Minimum.Value),
        temp_max: Math.floor(day.Temperature.Maximum.Value),
        date: moment().add(index, "day").unix(),
        icon: this.getOWMIconCode(day.Day.Icon),
        description: day.Day.ShortPhrase,
      });
    }

    return weather;
  }

  public async getEToData(coordinates: GeoCoordinates): Promise<EToData> {
		const location = await this.getLocationData(coordinates);
    const historicUrl = `http://dataservice.accuweather.com/currentconditions/v1/${location.Key}/historical/24?apikey=${this.API_KEY}&details=true`;

    let historicData: Conditions[];
    try {
      historicData = await httpJSONRequest(historicUrl);
    } catch (err) {
      throw new CodedError(ErrorCode.WeatherApiError);
    }

    const cloudCoverInfo = historicData.map(
      (hour): CloudCoverInfo => {
        return {
          startTime: moment.unix(hour.EpochTime),
          endTime: moment.unix(hour.EpochTime).add(1, "hours"),
          cloudCover: (hour.CloudCover ?? 0) / 100,
        };
      }
    );

    let minHumidity: number = undefined,
      maxHumidity: number = undefined,
			windSpeed = 0;
    for (const hour of historicData) {
      // Skip hours where humidity measurement does not exist to prevent result from being NaN.
      if (!hour.RelativeHumidity) {
        continue;
      }

      // If minHumidity or maxHumidity is undefined, these comparisons will yield false.
      minHumidity = minHumidity < hour.RelativeHumidity ? minHumidity : hour.RelativeHumidity;
      maxHumidity = maxHumidity > hour.RelativeHumidity ? maxHumidity : hour.RelativeHumidity;

			windSpeed += hour.Wind.Speed.Imperial.Value ?? 0;
    }

    return {
      weatherProvider: "AW",
      periodStartTime: historicData[0].EpochTime,
      minTemp: historicData[0].TemperatureSummary.Past24HourRange.Minimum.Imperial.Value,
      maxTemp: historicData[0].TemperatureSummary.Past24HourRange.Maximum.Imperial.Value,
      minHumidity: minHumidity,
      maxHumidity: maxHumidity,
      solarRadiation: approximateSolarRadiation(cloudCoverInfo, coordinates),
			// WMO standard wind measurement height is 10 meters
      windSpeed: standardizeWindSpeed(windSpeed / historicData.length, 32.8),
      precip: (historicData[0].PrecipitationSummary.Past24Hours.Imperial.Value ?? 0),
    };
  }

  private async getLocationData(
    coordinates: GeoCoordinates
  ): Promise<LocationData> {
    const url = `http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${this.API_KEY}&q=${coordinates[0]},${coordinates[1]}`;

    let locationData;
    try {
      locationData = await httpJSONRequest(url);
    } catch (err) {
      console.error("Error retrieving location data from AccuWeather:", err);
      throw new CodedError(ErrorCode.WeatherApiError);
    }

    if (!locationData.Key) {
      throw new CodedError(ErrorCode.MissingWeatherField);
    }

    return locationData;
  }

  public shouldCacheWateringScale(): boolean {
    return false;
  }

  private getOWMIconCode(icon: number) {
    switch (icon) {
      case 1:
      case 2:
      default:
        return "01d";
      case 3:
      case 4:
      case 5:
        return "02d";
      case 6:
      case 7:
      case 8:
        return "03d";
      case 11:
        return "50d";
      case 12:
      case 15:
      case 18:
      case 25:
      case 26:
        return "09d";
      case 13:
      case 14:
				return "10d";
      case 16:
      case 17:
        return "11d";
      case 19:
      case 20:
      case 21:
      case 22:
      case 23:
      case 24:
      case 29:
        return "13d";
      case 33:
      case 34:
        return "01n";
			case 35:
			case 36:
			case 37:
				return "02n";
			case 38:
				return "03n";
			case 39:
				return "10n";
			case 40:
				return "09n";
			case 41:
			case 42:
				return "11n";
			case 43:
			case 44:
				return "13n";
    }
  }
}
