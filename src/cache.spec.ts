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

	it("reuses a successful value until it expires", async () => {
		MockDate.set("2019-05-13T12:00:00Z");
		const cache = new Cached<number>();
		let calls = 0;
		const getter = async () => ++calls;

		const first = await cache.get(getter, new Date("2019-05-13T13:00:00Z"));
		const second = await cache.get(getter, new Date("2019-05-13T13:00:00Z"));

		expect(first.value).to.equal(1);
		expect(second.value).to.equal(1);
		expect(calls).to.equal(1);
	});

	it("coalesces concurrent cache misses", async () => {
		MockDate.set("2019-05-13T12:00:00Z");
		const cache = new Cached<number>();
		let calls = 0;
		let resolveValue: (value: number) => void;
		const pending = new Promise<number>(resolve => resolveValue = resolve);
		const getter = async () => {
			calls++;
			return pending;
		};

		const first = cache.get(getter, new Date("2019-05-13T13:00:00Z"));
		const second = cache.get(getter, new Date("2019-05-13T13:00:00Z"));
		await Promise.resolve();
		resolveValue(42);

		expect((await first).value).to.equal(42);
		expect((await second).value).to.equal(42);
		expect(calls).to.equal(1);
	});

	it("refreshes an expired value", async () => {
		MockDate.set("2019-05-13T12:00:00Z");
		const cache = new Cached<number>();
		let calls = 0;
		const getter = async () => ++calls;

		expect((await cache.get(getter, new Date("2019-05-13T13:00:00Z"))).value).to.equal(1);
		MockDate.set("2019-05-13T14:00:00Z");
		expect((await cache.get(getter, new Date("2019-05-13T15:00:00Z"))).value).to.equal(2);
		expect(calls).to.equal(2);
	});

	it("retries after a failed getter instead of caching the rejection", async () => {
		MockDate.set("2019-05-13T12:00:00Z");
		const cache = new Cached<number>();
		let calls = 0;
		const getter = async () => {
			calls++;
			if (calls === 1) throw new Error("temporary failure");
			return 42;
		};

		let failed = false;
		try {
			await cache.get(getter, new Date("2019-05-13T13:00:00Z"));
		} catch (_) {
			failed = true;
		}
		expect(failed).to.equal(true);
		expect((await cache.get(getter, new Date("2019-05-13T13:00:00Z"))).value).to.equal(42);
		expect(calls).to.equal(2);
	});
});
