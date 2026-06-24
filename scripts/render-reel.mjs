#!/usr/bin/env node
/**
 * End-to-end reel render:
 *   1. Remotion render (compositions read src/edit-plan.json)
 *   2. ffmpeg LUT pass (CELLULOID_01_FU_LOW.cube)
 *   3. Output MP4 ready to drop into Palmier for final tweaks (or post directly)
 *
 *   node scripts/render-reel.mjs              # outputs out/reel.mp4 + reel__lut.mp4
 *   node scripts/render-reel.mjs --name v1
 *   node scripts/render-reel.mjs --no-lut
 */

import {existsSync, mkdirSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; }
const NAME = arg('name', 'reel');
const SKIP_LUT = args.includes('--no-lut');

const outDir = resolve(root, 'out');
mkdirSync(outDir, {recursive: true});
const remotionOut = join(outDir, `${NAME}.mp4`);
const finalOut = join(outDir, `${NAME}__lut.mp4`);

console.log(`▶ Remotion render → ${remotionOut}`);
const r1 = spawnSync(
  'npx',
  ['remotion', 'render', 'src/index.ts', 'ReelEdit', remotionOut, '--codec=h264'],
  {cwd: root, stdio: 'inherit'},
);
if (r1.status !== 0) {
  console.error('Remotion render failed.');
  process.exit(r1.status ?? 1);
}

if (SKIP_LUT) {
  console.log(`\n✓ done (LUT skipped): ${remotionOut}`);
  process.exit(0);
}

console.log(`\n▶ LUT pass → ${finalOut}`);
const r2 = spawnSync(
  'node',
  [join(root, 'scripts', 'apply-lut.mjs'), remotionOut],
  {cwd: root, stdio: 'inherit'},
);
if (r2.status !== 0) {
  console.error('LUT pass failed.');
  process.exit(r2.status ?? 1);
}

console.log(`\n✓ final reel: ${finalOut}`);
console.log(`  drop into Palmier Pro for final timeline tweaks, or post as-is.`);
