import { EToData, GeoCoordinates, WateringData, WeatherData, WeatherProvider } from "../../types";

/**
 * A WeatherProvider for testing purposes that returns weather data that is provided in the constructor.
 * This is a special WeatherProvider and should not be activated using the WEATHER_PROVIDER environment variable.
 */
export default class MockWeatherProvider implements WeatherProvider{

	private readonly mockData: MockWeatherData;

	public constructor(mockData: MockWeatherData) {
		this.mockData = mockData;
	}

	public async getWateringData( coordinates: GeoCoordinates ): Promise< WateringData > {
		const data = this.mockData.wateringData;
		if ( !data.weatherProvider ) {
			data.weatherProvider = "mock";
		}

		return data;
	}

	public async getWeatherData( coordinates: GeoCoordinates ): Promise< WeatherData > {
		const data = this.mockData.weatherData;
		if ( !data.weatherProvider ) {
			data.weatherProvider = "mock";
		}

		return data;
	}

	public async getEToData( coordinates: GeoCoordinates ): Promise< EToData > {
		const data = this.mockData.etoData;
		if ( !data.weatherProvider ) {
			data.weatherProvider = "mock";
		}

		return data;
	}
}

interface MockWeatherData {
	wateringData?: WateringData,
	weatherData?: WeatherData,
	etoData?: EToData
}
