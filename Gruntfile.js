module.exports = function( grunt ) {

	// Load node-modules;
	grunt.loadNpmTasks( "grunt-contrib-jshint" );
	grunt.loadNpmTasks( "grunt-contrib-compress" );
	grunt.loadNpmTasks( "grunt-jscs" );

	// Project configuration.
	grunt.initConfig( {
		pkg: grunt.file.readJSON( "package.json" ),

		jshint: {
			main: [ "server.js", "routes/**" ],
			options: {
				jshintrc: true
			}
		},

		jscs: {
			main: [ "server.js", "routes/**" ],
			options: {
				config: true,
				fix: true
			}
		},

		compress: {
			build: {
				options: {
					archive: "WeatherService.zip"
				},
				files: [ {
					src: [ ".ebextensions/*", "routes/*", "server.js", "package.json" ],
					expand: true
				} ]
			}
		}

	} );

	// Default task(s).
	grunt.registerTask( "default", [ "jshint", "jscs" ] );
	grunt.registerTask( "build", [ "jshint", "jscs", "compress:build" ] );

};
