import { expect } from "chai";
import MockDate from "mockdate";

import { Cached } from "./cache";

describe("Cached", () => {
	afterEach(() => MockDate.reset());

	it("reports when a value entered the cache", async () => {
		MockDate.set("2019-05-13T12:00:00Z");
		const cache = new Cached<number>();
		const result = await cache.get(
			async () => 42,
			new Date("2019-05-13T13:00:00Z")
		);

		expect(result.value).to.equal(42);
		expect(result.cachedAt).to.equal(1557748800000);
	});
});
