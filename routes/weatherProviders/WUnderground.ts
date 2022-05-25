import * as moment from "moment-timezone";

import { GeoCoordinates, PWS, WeatherData, ZimmermanWateringData } from "../../types";
import { WeatherProvider } from "./WeatherProvider";
import { httpJSONRequest } from "../weather";
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
		const historicUrl2 = `https://api.weather.com/v2/pws/history/all?stationId=${ pws.id }&format=json&units=e&date=${ toDateStr }&numericPrecision=decimal&apiKey=${ pws.apiKey }`;

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
		let precip: number = 0, precip1: number = 0, precip2: number = 0;
		let wind: number = 0, solar: number = 0;
		let n : number = 0;
		for ( const hour of historicData1.observations ) {
			if (moment(hour.obsTimeUtc) < fromDate)
				continue;

			minTemp = minTemp < hour.imperial.tempLow ? minTemp : hour.imperial.tempLow;
			maxTemp = maxTemp > hour.imperial.tempHigh ? maxTemp : hour.imperial.tempHigh;

			precip1 = hour.imperial.precipTotal;

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

			precip2 = hour.imperial.precipTotal;

			if (hour.imperial.windspeedAvg != null && hour.imperial.windspeedAvg > wind)
				wind = hour.imperial.windspeedAvg;

			if (hour.solarRadiationHigh != null)
				solar += hour.solarRadiationHigh;

			minHumidity = minHumidity < hour.humidityLow ? minHumidity : hour.humidityLow;
			maxHumidity = maxHumidity > hour.humidityHigh ? maxHumidity : hour.humidityHigh;
			n++;
		}

		solar = solar / n * 24 / 1000; //Watts/m2 in 24h -->KWh/m2
		precip = precip1 + precip2;
		
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
		console.log("WU 3: precip:%s solar:%s minTemp:%s maxTemp:%s minHum:%s maxHum:%s wind:%s n:%s",
			(this.inch2mm(precip)).toPrecision(3), 
			solar.toPrecision(3), 
			(this.F2C(minTemp)).toPrecision(3), (this.F2C(maxTemp)).toPrecision(3), minHumidity, maxHumidity, (this.mph2kmh(wind)).toPrecision(4), n);
		return result;
	}

	public shouldCacheWateringScale(): boolean {
		return false;
	}

	private getOWMIconCode(icon: string) {
		switch(icon) {
			case "partly-cloudy-night":
				return "02n";
			case "partly-cloudy-day":
				return "02d";
			case "cloudy":
				return "03d";
			case "fog":
			case "wind":
				return "50d";
			case "sleet":
			case "snow":
				return "13d";
			case "rain":
				return "10d";
			case "clear-night":
				return "01n";
			case "clear-day":
			default:
				return "01d";
		}
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
		return inch * 2.54;
	}
}
