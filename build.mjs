import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import url from 'url';

const geoTzEntryUrl = import.meta.resolve('geo-tz');
const geoTzRoot = path.dirname(url.fileURLToPath(geoTzEntryUrl));
const source = path.join(geoTzRoot, '../data');

const target = path.resolve('./dist/data');

function copyFolder(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const items = fs.readdirSync(src);

    items.forEach(item => {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);

        const stats = fs.statSync(srcPath);

        if (stats.isDirectory()) {
            copyFolder(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    });
}

copyFolder(source, target);

await esbuild.build({
    entryPoints: ['server.ts'],
    bundle: true,
    outfile: 'dist/index.cjs',
    platform: 'node',
    format: 'cjs',
});