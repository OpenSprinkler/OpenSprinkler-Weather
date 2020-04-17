#!/usr/bin/env node

/**
 * This is used for development only and simply launches a web server and
 * injects a script to trigger a reload when a file changes in the serve
 * directory.
 */

const exec = require( "child_process" ).exec;
const path = require( "path" );

const routesPath = path.join( __dirname, "../routes/" );
const serverPath = path.join( __dirname, "../server.ts" );

const watch = require( "node-watch" );

compile();
console.log( "OpenSprinkler Development Server Started..." );

/** Start the web server */
exec( `nodemon js/server` );

/** Watch for changes and recompile */
watch( routesPath, { recursive: true }, recompile );
watch( serverPath, { recursive: true }, recompile );

function recompile() {
    console.log( "Changes detected, reloading..." );
    compile();
}

function compile() {
    exec( `npm run compile` );
}