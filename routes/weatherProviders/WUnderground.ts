import moment from "moment-timezone";

import { GeoCoordinates, PWS, WeatherData, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { normalizeWeatherData } from "./normalizeWeatherData";
import { httpJSONRequest, redactLogString } from "../weather";
import { approximateSolarRadiation, CloudCoverInfo, EToData } from "../adjustmentMethods/EToAdjustmentMethod";
import { CodedError, ErrorCode } from "../../errors";

export default class WUnderground extends WeatherProvider {

	async getWateringData( coordinates: GeoCoordinates, pws?: PWS ): Promise< ZimmermanWateringData > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getWateringData request for coordinates: %s", coordinates);

		const url = `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${ pws.id }&format=json&units=e&apiKey=${ pws.apiKey }`;
		let data;
		try {
			data = await httpJSONRequest( url );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		// Take the 24 most recent observations.
		const samples = data.observations.slice( -24 );

		// Fail if not enough data is available.
		if ( samples.length !== 24 ) {
			throw new CodedError( ErrorCode.InsufficientWeatherData );
		}

		const totals = { temp: 0, humidity: 0, precip: 0 };
		let lastPrecip = samples[0].imperial.precipTotal;
		for ( const sample of samples ) {
			totals.temp += sample.imperial.tempAvg;
			totals.humidity += sample.humidityAvg;
			totals.precip += ( sample.imperial.precipTotal - lastPrecip > 0 ) ? sample.imperial.precipTotal - lastPrecip : 0;
			lastPrecip = sample.imperial.precipTotal
		}

		return {
			weatherProvider: "WU",
			temp: totals.temp / samples.length,
			humidity: totals.humidity / samples.length,
			precip: totals.precip,
			raining: samples[ samples.length - 1 ].imperial.precipRate > 0
		}
	}

	public async getWeatherData( coordinates: GeoCoordinates, pws?: PWS ): Promise< WeatherData > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getWeatherData request for coordinates: %s", coordinates);

		const forecastURL = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${ coordinates[ 0 ] },${ coordinates[ 1 ] }&format=json&language=en-US&units=e&apiKey=${ pws.apiKey }`;

		let forecast;
		try {
			forecast = await httpJSONRequest( forecastURL );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const currentURL = `https://api.weather.com/v2/pws/observations/current?stationId=${ pws.id }&format=json&units=e&apiKey=${ pws.apiKey }`;

		let data;
		try {
			data = await httpJSONRequest( currentURL );
		} catch ( err ) {
			console.error( "Error retrieving weather information from WUnderground:", err );
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		const hourlyURL = `https://api.weather.com/v3/wx/forecast/hourly/2day?geocode=${ coordinates[ 0 ] },${ coordinates[ 1 ] }&format=json&language=en-US&units=e&apiKey=${ pws.apiKey }`;

		// The hourly forecast is an optional enrichment; a failure here must not break the
		// daily forecast payload the App depends on.
		let hourlyForecast: any = {};
		try {
			hourlyForecast = await httpJSONRequest( hourlyURL );
		} catch ( err ) {
			console.error( "Error retrieving hourly weather information from WUnderground (continuing without hourly):", err );
		}

		const current = data.observations[0];

		// The v3 daily-forecast daypart arrays hold TWO slots per day (day = 2i, night = 2i + 1),
		// and today's day slot (plus temperatureMax[0]) turns null after ~3 p.m. local time. The
		// old [index] addressing read the wrong day past index 0 and Math.floor(null) fabricated
		// a 0° maximum that made the App reject the whole payload.
		const finite = ( value: any ): value is number => typeof value === "number" && Number.isFinite( value );
		const dayparts = ( forecast.daypart && forecast.daypart[0] ) || {};
		const partValue = ( values: any[] | undefined, index: number ): any => {
			const day = values ? values[ 2 * index ] : undefined;
			return ( day === null || day === undefined ) ? ( values ? values[ 2 * index + 1 ] : undefined ) : day;
		};
		const dailyQpf = ( index: number ): number =>
			( finite( forecast.qpf?.[index] ) ? forecast.qpf[index] : 0 ) +
			( finite( forecast.qpfSnow?.[index] ) ? forecast.qpfSnow[index] : 0 );

		const currentIcon = partValue( dayparts.iconCode, 0 );
		const maxTemp = finite( forecast.temperatureMax[0] ) ? forecast.temperatureMax[0]
			: finite( forecast.calendarDayTemperatureMax?.[0] ) ? forecast.calendarDayTemperatureMax[0]
			: current.imperial.temp;

		const weather: WeatherData = {
			weatherProvider: "WUnderground",
			temp: Math.floor( current.imperial.temp ),
			humidity: Math.floor( current.humidity ),
			wind: Math.floor( current.imperial.windSpeed ),
			description: forecast.narrative[0],
			icon: this.getWUIconCode( finite( currentIcon ) ? currentIcon : -1 ),

			region: current.country,
			city: "",
			minTemp: Math.floor( forecast.temperatureMin[0] ),
			maxTemp: Math.floor( maxTemp ),
			precip: dailyQpf( 0 ),
			forecast: [],
			...( finite( current.epoch ) ? { observedAt: current.epoch } : {} )
		};

		for ( let index = 0; index < forecast.dayOfWeek.length; index++ ) {
			const min = forecast.temperatureMin[index];
			const max = finite( forecast.temperatureMax[index] ) ? forecast.temperatureMax[index]
				: finite( forecast.calendarDayTemperatureMax?.[index] ) ? forecast.calendarDayTemperatureMax[index]
				: index === 0 ? current.imperial.temp : undefined;
			// Never emit a fabricated day; the App validates every entry and rejects the payload.
			if ( !finite( min ) || !finite( max ) ) {
				continue;
			}
			const icon = partValue( dayparts.iconCode, index );
			const entry: WeatherData["forecast"][number] = {
				temp_min: Math.floor( min ),
				temp_max: Math.floor( max ),
				date: forecast.validTimeUtc[index],
				icon: this.getWUIconCode( finite( icon ) ? icon : -1 ),
				description: forecast.narrative[index],
				precip: dailyQpf( index )
			};
			const pop = partValue( dayparts.precipChance, index );
			const humidity = partValue( dayparts.relativeHumidity, index );
			const wind = partValue( dayparts.windSpeed, index );
			const uv = partValue( dayparts.uvIndex, index );
			if ( finite( pop ) ) entry.pop = pop;
			if ( finite( humidity ) ) entry.humidity = humidity;
			if ( finite( wind ) ) entry.wind = wind;
			if ( finite( uv ) ) entry.uv = uv;
			weather.forecast.push( entry );
		}

		const hourly = [] as NonNullable< WeatherData["hourly"] >;
		const hourlyTimes = Array.isArray( hourlyForecast.validTimeUtc ) ? hourlyForecast.validTimeUtc : [];
		for ( let index = 0; index < Math.min( hourlyTimes.length, 24 ); index++ ) {
			const time = hourlyTimes[index];
			const temp = hourlyForecast.temperature?.[index];
			if ( !finite( time ) || !finite( temp ) ) continue;
			const precip = hourlyForecast.qpf?.[index];
			const icon = hourlyForecast.iconCode?.[index];
			const hour: NonNullable< WeatherData["hourly"] >[number] = {
				time,
				temp,
				precip: finite( precip ) ? precip : 0,
				icon: this.getWUIconCode( finite( icon ) ? icon : -1 )
			};
			const pop = hourlyForecast.precipChance?.[index];
			if ( finite( pop ) ) hour.pop = pop;
			hourly.push( hour );
		}
		if ( hourly.length > 0 ) weather.hourly = hourly;

		return normalizeWeatherData( "WUnderground", weather );
	}

	public async getEToData( coordinates: GeoCoordinates, pws?: PWS ): Promise< EToData > {
		if ( !pws ) {
			throw new CodedError( ErrorCode.NoPwsProvided );
		}

		console.log("WU getEToData request for coordinates: %s %s", coordinates, pws.id);

		//We need the date from the last 24h, not bound to day boundary!
		//So we take the values from 2 days: today+yesterday
		const fromDate = moment().subtract( 1, "day" );
		const fromDateStr: string = fromDate.format("YYYYMMDD");
		const toDate = moment();
		const toDateStr = toDate.format("YYYYMMDD");
		const historicUrl1 = `https://api.weather.com/v2/pws/history/all?stationId=${ pws.id }&format=json&units=e&date=${ fromDateStr }&numericPrecision=decimal&apiKey=${ pws.apiKey }`;
		//const historicUrl2 = `https://api.weather.com/v2/pws/history/all?stationId=${ pws.id }&format=json&units=e&date=${ toDateStr }&numericPrecision=decimal&apiKey=${ pws.apiKey }`;
		const historicUrl2 = `https://api.weather.com/v2/pws/observations/all/1day?stationId=${ pws.id }&format=json&units=e&numericPrecision=decimal&apiKey=${ pws.apiKey }`;
		console.log(redactLogString(historicUrl1));
		console.log(redactLogString(historicUrl2));

		let historicData1, historicData2;
		try {
			historicData1 = await httpJSONRequest( historicUrl1 );
			historicData2 = await httpJSONRequest( historicUrl2 );
		} catch (err) {
			throw new CodedError( ErrorCode.WeatherApiError );
		}

		if ( !historicData1 || !historicData1.observations || !historicData2 || !historicData2.observations) {
			throw "Necessary field(s) were missing from weather information returned by Wunderground.";
		}

		let minHumidity: number = undefined, maxHumidity: number = undefined;
		let minTemp: number = undefined, maxTemp: number = undefined
		let precip: number = 0, previousPrecip: number = 0;
		let wind: number = 0, solar: number = 0;
		let n : number = 0, nig : number = 0;
		const fromEpoch = fromDate.unix();
		const addPrecipDelta = ( currentPrecip: number ) => {
			const delta = currentPrecip - previousPrecip;
			precip += delta >= 0 ? delta : Math.max( currentPrecip, 0 );
			previousPrecip = currentPrecip;
		};

		for ( const hour of historicData1.observations ) {
			if (hour.epoch < fromEpoch) {
				previousPrecip = hour.imperial.precipTotal;
				nig++;
				continue;
			}

			minTemp = minTemp < hour.imperial.tempLow ? minTemp : hour.imperial.tempLow;
			maxTemp = maxTemp > hour.imperial.tempHigh ? maxTemp : hour.imperial.tempHigh;

			addPrecipDelta( hour.imperial.precipTotal );

			if (hour.imperial.windspeedAvg != null && hour.imperial.windspeedAvg > wind)
				wind = hour.imperial.windspeedAvg;

			if (hour.solarRadiationHigh != null)
				solar += hour.solarRadiationHigh;

			minHumidity = minHumidity < hour.humidityLow ? minHumidity : hour.humidityLow;
			maxHumidity = maxHumidity > hour.humidityHigh ? maxHumidity : hour.humidityHigh;
			n++;
		}

		for ( const hour of historicData2.observations ) {
			minTemp = minTemp < hour.imperial.tempLow ? minTemp : hour.imperial.tempLow;
			maxTemp = maxTemp > hour.imperial.tempHigh ? maxTemp : hour.imperial.tempHigh;

			addPrecipDelta( hour.imperial.precipTotal );

			if (hour.imperial.windspeedAvg != null && hour.imperial.windspeedAvg > wind)
				wind = hour.imperial.windspeedAvg;

			if (hour.solarRadiationHigh != null)
				solar += hour.solarRadiationHigh;

			minHumidity = minHumidity < hour.humidityLow ? minHumidity : hour.humidityLow;
			maxHumidity = maxHumidity > hour.humidityHigh ? maxHumidity : hour.humidityHigh;
			n++;
		}

		solar = solar / n * 24 / 1000; //Watts/m2 in 24h -->KWh/m2
		const result : EToData = {
			weatherProvider: "WU",
			periodStartTime: fromDate.unix(),
			minTemp: minTemp,
			maxTemp: maxTemp,
			minHumidity: minHumidity,
			maxHumidity: maxHumidity,
			solarRadiation: solar,
			// Assume wind speed measurements are taken at 2 meters.
			windSpeed: wind,
			precip: precip,
		}

		console.log("WU 3: precip:%s solar:%s minTemp:%s maxTemp:%s minHum:%s maxHum:%s wind:%s n:%s nig:%s",
			(this.inch2mm(precip)).toPrecision(3),
			solar.toPrecision(3),
			(this.F2C(minTemp)).toPrecision(3), (this.F2C(maxTemp)).toPrecision(3), minHumidity, maxHumidity, (this.mph2kmh(wind)).toPrecision(4), n, nig);

		return result;
	}

	public shouldCacheWateringScale(): boolean {
		return false;
	}

	private getWUIconCode(code: number) {
		const mapping = [
			"50d", // Tornado
			"09d", // Tropical Storm
			"09d", // Hurricane
			"11d", // Strong Storms
			"11d", // Thunderstorms
			"13d", // Rain + Snow
			"13d", // Rain + Sleet
			"13d", // Wintry Mix
			"13d", // Freezing Drizzle
			"09d", // Drizzle
			"13d", // Freezing Rain
			"09d", // Showers
			"09d", // Rain
			"13d", // Flurries
			"13d", // Snow Showers
			"13d", // Blowing/Drifting Snow
			"13d", // Snow
			"13d", // Hail
			"13d", // Sleet
			"50d", // Blowing Dust/Sand
			"50d", // Foggy
			"50d", // Haze
			"50d", // Smoke
			"50d", // Breezy
			"50d", // Windy
			"13d", // Frigid/Ice Crystals
			"04d", // Cloudy
			"03n", // Mostly Cloudy (night)
			"03d", // Mostly Cloudy (day)
			"02n", // Partly Cloudy (night)
			"02d", // Partly Cloudy (day)
			"01n", // Clear night
			"01d", // Sunny
			"02n", // Mostly clear night
			"02d", // Mostly sunny
			"13d", // Rain and Hail
			"01d", // Hot
			"11d", // Isolated thunderstorms (Day)
			"11d", // Scattered thunderstorms (Day)
			"09d", // Scattered showers (Day)
			"09d", // Heavy rain
			"13d", // Scattered snow shower (Day)
			"13d", // Heavy snow
			"13d", // Blizzard
			"01d", // Not available
			"09n", // Scattered showers (Night)
			"13n", // Scattered snow shower (Night)
			"09n" // Scattered thunderstorm (Night)
		];
		return (code >= 0 && code < mapping.length) ? mapping[code] : "50d";
	}

	// Fahrenheit to Grad Celcius:
	private F2C(fahrenheit: number): number {
		return (fahrenheit-32) / 1.8;
	}

	//mph to kmh:
	private mph2kmh(mph : number): number {
		return mph * 1.609344;
	}

	//inch to mm:
	private inch2mm(inch : number): number {
		return inch * 25.4;
	}
}
