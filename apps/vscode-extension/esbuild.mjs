import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
