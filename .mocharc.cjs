process.env.GOOGLE_MAPS_API_KEY ||= "TEST_KEY";
process.env.OWM_API_KEY ||= "TEST_KEY";
process.env.WU_API_KEY ||= "TEST_KEY";

require("ts-node").register({
	transpileOnly: true,
	compilerOptions: {
		module: "CommonJS",
		esModuleInterop: true,
	},
});

module.exports = {
	exit: true,
	extension: ["ts"],
	spec: ["src/**/*.spec.ts"],
};
