// Bundles the extension into dist/, ready for chrome://extensions → "Load unpacked".
// Build-time defaults point at local development; change them in the extension's
// Options page (or set EXT_* variables) for another environment.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'fs';

const watch = process.argv.includes('--watch');
const env = (k, fallback) => JSON.stringify(process.env[k] ?? fallback);

const define = {
  __DEFAULT_API_URL__: env('EXT_API_URL', 'http://localhost:3000'),
  __DEFAULT_COGNITO_DOMAIN__: env('EXT_COGNITO_DOMAIN', 'https://job-apply-dev-418272768931.auth.us-east-1.amazoncognito.com'),
  __DEFAULT_CLIENT_ID__: env('EXT_COGNITO_CLIENT_ID', '2vvuu6ucikoeidtdc6sl4kapl1'),
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });

const common = { bundle: true, target: 'chrome116', define, logLevel: 'info', sourcemap: watch ? 'inline' : false };
const builds = [
  // Content scripts can't be modules.
  { ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' },
  { ...common, entryPoints: ['src/background.ts', 'src/panel.ts', 'src/options.ts'], outdir: 'dist', format: 'esm' },
];

if (watch) {
  for (const b of builds) await (await context(b)).watch();
} else {
  await Promise.all(builds.map((b) => build(b)));
}
