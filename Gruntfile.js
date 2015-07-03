module.exports = function( grunt ) {

	// Load node-modules;
	grunt.loadNpmTasks( "grunt-contrib-jshint" );

	// Project configuration.
	grunt.initConfig( {
		pkg: grunt.file.readJSON( "package.json" ),

		jshint: {
			main: [ "Gruntfile.js", "server.js", "routes/*.js", "models/*.js" ],
			options: {
				jshintrc: true
			}
		}
	} );

	// Default task(s).
	grunt.registerTask( "default", [ "jshint" ] );

};
