module.exports = function( grunt ) {

	// Load node-modules;
	grunt.loadNpmTasks( "grunt-contrib-jshint" );
	grunt.loadNpmTasks( "grunt-jscs" );

	// Project configuration.
	grunt.initConfig( {
		pkg: grunt.file.readJSON( "package.json" ),

		jshint: {
			main: [ "Gruntfile.js", "server.js", "routes/**", "models/**" ],
			options: {
				jshintrc: true
			}
		},

		jscs: {
			main: [ "Gruntfile.js", "server.js", "routes/**", "models/**" ],
			options: {
				config: true,
				fix: true
			}
		}
	} );

	// Default task(s).
	grunt.registerTask( "default", [ "jshint", "jscs" ] );

};
