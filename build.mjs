import esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['server.ts'],
    bundle: true,
    outfile: 'dist/index.cjs',
    platform: 'node',
    format: 'cjs',
});