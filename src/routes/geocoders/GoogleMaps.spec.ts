import { expect } from "chai";
import { ErrorCode } from "../../errors";
import GoogleMapsGeocoder from "./GoogleMaps";

describe("Google Maps geocoder", () => {
	it("requires its API key only when geocoding is requested", async () => {
		const existingKey = process.env.GOOGLE_MAPS_API_KEY;
		delete process.env.GOOGLE_MAPS_API_KEY;

		try {
			const geocoder = new GoogleMapsGeocoder();
			let actual: ErrorCode | undefined;
			try {
				await geocoder.geocodeLocation("New York");
			} catch (err) {
				actual = (err as { errCode?: ErrorCode }).errCode;
			}
			expect(actual).to.equal(ErrorCode.NoAPIKeyProvided);
		} finally {
			if (existingKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
			else process.env.GOOGLE_MAPS_API_KEY = existingKey;
		}
	});
});
