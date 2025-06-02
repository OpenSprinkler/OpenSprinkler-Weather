import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['server.ts'],
    bundle: true,
    outfile: 'dist/index.cjs',
    platform: 'node',
    format: 'cjs',
});

await esbuild.build({
    entryPoints: ['routes/weatherProviders/*'],
    bundle: true,
    outdir: 'dist/weatherProviders',
    platform: 'node',
    format: 'cjs',
});