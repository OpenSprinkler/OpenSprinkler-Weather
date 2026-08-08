import { expect } from "chai";
import { resolveServerPort } from "./config";

describe("Server configuration", () => {
	it("uses the default port when neither port variable is set", () => {
		expect(resolveServerPort({})).to.equal(3000);
	});

	it("uses the documented PORT variable", () => {
		expect(resolveServerPort({ PORT: "3001" })).to.equal(3001);
	});

	it("accepts HTTP_PORT as a compatibility alias", () => {
		expect(resolveServerPort({ HTTP_PORT: "3002" })).to.equal(3002);
	});

	it("prefers PORT when both variables are set", () => {
		expect(resolveServerPort({ PORT: "3001", HTTP_PORT: "3002" })).to.equal(3001);
	});

	it("rejects malformed or out-of-range ports", () => {
		for (const value of ["", "0", "65536", "3000x", "1.5"]) {
			expect(() => resolveServerPort({ PORT: value })).to.throw("Invalid server port");
		}
	});
});
