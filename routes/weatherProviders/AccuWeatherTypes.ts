export interface Conditions {
  LocalObservationDateTime: string;
  EpochTime: number;
  WeatherText: string;
  WeatherIcon: number;
  HasPrecipitation: boolean;
  PrecipitationType: any;
  IsDayTime: boolean;
  Temperature: MetricImperial;
  RealFeelTemperature: MetricImperial;
  RealFeelTemperatureShade: MetricImperial;
  RelativeHumidity: number;
  IndoorRelativeHumidity: number;
  DewPoint: MetricImperial;
  Wind: Wind;
  WindGust: WindGust;
  UVIndex: number;
  UVIndexText: string;
  Visibility: MetricImperial;
  ObstructionsToVisibility: string;
  CloudCover: number;
  Ceiling: MetricImperial;
  Pressure: MetricImperial;
  PressureTendency: PressureTendency;
  Past24HourTemperatureDeparture: MetricImperial;
  ApparentTemperature: MetricImperial;
  WindChillTemperature: MetricImperial;
  WetBulbTemperature: MetricImperial;
  Precip1hr: MetricImperial;
  PrecipitationSummary: PrecipitationSummary;
  TemperatureSummary: TemperatureSummary;
  MobileLink: string;
  Link: string;
}

export interface MetricImperial {
  Metric: UnitValue;
  Imperial: UnitValue;
}

export interface UnitValue {
  Value: number;
  Unit: string;
  UnitType: number;
  Phrase: string;
}

export interface Wind {
  Direction: Direction;
  Speed: MetricImperial;
}

export interface Direction {
  Degrees: number;
  Localized: string;
  English: string;
}

export interface WindGust {
  Speed: MetricImperial;
}

export interface PressureTendency {
  LocalizedText: string;
  Code: string;
}

export interface PrecipitationSummary {
  Precipitation: MetricImperial;
  PastHour: MetricImperial;
  Past3Hours: MetricImperial;
  Past6Hours: MetricImperial;
  Past9Hours: MetricImperial;
  Past12Hours: MetricImperial;
  Past18Hours: MetricImperial;
  Past24Hours: MetricImperial;
}

export interface TemperatureSummary {
  Past6HourRange: MetricImperialRange;
  Past12HourRange: MetricImperialRange;
  Past24HourRange: MetricImperialRange;
}

export interface Range {
  Minimum: UnitValue;
  Maximum: UnitValue;
}

export interface MetricImperialRange {
  Minimum: MetricImperial;
  Maximum: MetricImperial;
}

export interface LocationData {
  Version: number;
  Key: string;
  Type: string;
  Rank: number;
  LocalizedName: string;
  EnglishName: string;
  PrimaryPostalCode: string;
  Region: Country;
  Country: Country;
  AdministrativeArea: AdministrativeArea;
  TimeZone: TimeZone;
  GeoPosition: GeoPosition;
  IsAlias: boolean;
  SupplementalAdminAreas: SupplementalAdminArea[];
  DataSets: string[];
}

export interface AdministrativeArea {
  ID: string;
  LocalizedName: string;
  EnglishName: string;
  Level: number;
  LocalizedType: string;
  EnglishType: string;
  CountryID: string;
}

export interface Country {
  ID: string;
  LocalizedName: string;
  EnglishName: string;
}

export interface GeoPosition {
  Latitude: number;
  Longitude: number;
  Elevation: MetricImperial;
}

export interface SupplementalAdminArea {
  Level: number;
  LocalizedName: string;
  EnglishName: string;
}

export interface TimeZone {
  Code: string;
  Name: string;
  GmtOffset: number;
  IsDaylightSaving: boolean;
  NextOffsetChange: Date;
}

export interface DailyForecasts {
  Headline: Headline;
  DailyForecasts: DailyForecast[];
}

export interface DailyForecast {
  Date: Date;
  EpochDate: number;
  Sun: Sun;
  Moon: Moon;
  Temperature: Range;
  RealFeelTemperature: Range;
  RealFeelTemperatureShade: Range;
  HoursOfSun: number;
  DegreeDaySummary: DegreeDaySummary;
  AirAndPollen: AirAndPollen[];
  Day: DayNight;
  Night: DayNight;
  Sources: string[];
  MobileLink: string;
  Link: string;
}

export interface AirAndPollen {
  Name: string;
  Value: number;
  Category: string;
  CategoryValue: number;
  Type?: string;
}

export interface DayNight {
  Icon: number;
  IconPhrase: string;
  HasPrecipitation: boolean;
  ShortPhrase: string;
  LongPhrase: string;
  PrecipitationProbability: number;
  ThunderstormProbability: number;
  RainProbability: number;
  SnowProbability: number;
  IceProbability: number;
  Wind: ForecastWind;
  WindGust: ForecastWind;
  TotalLiquid: UnitValue;
  Rain: UnitValue;
  Snow: UnitValue;
  Ice: UnitValue;
  HoursOfPrecipitation: number;
  HoursOfRain: number;
  HoursOfSnow: number;
  HoursOfIce: number;
  CloudCover: number;
  Evapotranspiration: UnitValue;
  SolarIrradiance: UnitValue;
  PrecipitationType?: string;
  PrecipitationIntensity?: string;
}

export interface ForecastWind {
  Speed: UnitValue;
  Direction: Direction;
}

export interface Direction {
  Degrees: number;
  Localized: string;
  English: string;
}

export interface DegreeDaySummary {
  Heating: UnitValue;
  Cooling: UnitValue;
}

export interface Moon {
  Rise: Date;
  EpochRise: number;
  Set: Date;
  EpochSet: number;
  Phase: string;
  Age: number;
}

export interface Sun {
  Rise: Date;
  EpochRise: number;
  Set: Date;
  EpochSet: number;
}

export interface Headline {
  EffectiveDate: Date;
  EffectiveEpochDate: number;
  Severity: number;
  Text: string;
  Category: string;
  EndDate?: Date;
  EndEpochDate?: Date;
  MobileLink: string;
  Link: string;
}
