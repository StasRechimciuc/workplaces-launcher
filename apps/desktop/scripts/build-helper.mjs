// Builds the native wl-helper (native/wl-helper/Sources/*.swift) into a
// universal binary at native/build/wl-helper — see
// WCs/WC__window-tracking.md's Stage 2 plan, section 1.
//
// Each architecture is compiled with an explicit target triple
// (arm64-apple-macos11 / x86_64-apple-macos11) and the two are merged
// with lipo, rather than relying on swiftc's host default — a default
// build would silently ship an Apple-Silicon-only (or Intel-only)
// helper, and on the other architecture every window feature would
// fail at runtime instead of at build time.
//
// Skips the compile when the binary is newer than every source file
// and than the Sources folder itself (whose mtime changes when a file
// is added, deleted or renamed — a deletion leaves nothing newer to
// notice otherwise), so `npm run dev` doesn't pay for two full
// compiles on every start.
// Pass --force to rebuild regardless. Exits non-zero, loudly, on any
// failure — `package:mac` runs this first and must not continue
// without a helper (verify-helper.cjs checks the packaged app too).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(desktopDir, 'native/wl-helper/Sources');
const buildDir = join(desktopDir, 'native/build');
const output = join(buildDir, 'wl-helper');
const TARGETS = ['arm64-apple-macos11', 'x86_64-apple-macos11'];

function fail(message) {
  console.error(`build-helper: ${message}`);
  process.exit(1);
}

// Not an error elsewhere: `npm run dev` runs this on every platform,
// and nothing outside macOS uses the helper. package:mac can only run
// on macOS, and verify-helper.cjs checks the packed app regardless.
if (process.platform !== 'darwin') {
  console.log('build-helper: skipped — wl-helper is macOS-only');
  process.exit(0);
}

const sources = readdirSync(sourcesDir)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => join(sourcesDir, name));
if (sources.length === 0) {
  fail(`no Swift sources found in ${sourcesDir}`);
}

function mtimeOrZero(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

const newestSource = Math.max(
  ...sources.map(mtimeOrZero),
  mtimeOrZero(sourcesDir),
  mtimeOrZero(fileURLToPath(import.meta.url)),
);
if (!process.argv.includes('--force') && mtimeOrZero(output) > newestSource) {
  console.log('build-helper: native/build/wl-helper is up to date');
  process.exit(0);
}

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'inherit' });
  } catch (err) {
    fail(`${command} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

mkdirSync(buildDir, { recursive: true });
const slices = TARGETS.map((target) => {
  const slice = join(buildDir, `wl-helper-${target.split('-')[0]}`);
  console.log(`build-helper: compiling for ${target}`);
  run('xcrun', [
    'swiftc',
    '-O',
    '-swift-version',
    '5',
    '-target',
    target,
    '-framework',
    'AppKit',
    '-framework',
    'ApplicationServices',
    '-o',
    slice,
    ...sources,
  ]);
  return slice;
});

run('lipo', ['-create', '-output', output, ...slices]);
console.log(`build-helper: wrote ${output}`);
