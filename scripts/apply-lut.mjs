#!/usr/bin/env node
/**
 * Post-process a Remotion MP4 with the cinematic celluloid LUT.
 * Uses ffmpeg's lut3d filter against the .cube file.
 *
 *   node scripts/apply-lut.mjs out/reel.mp4
 *   node scripts/apply-lut.mjs out/reel.mp4 --strength 0.6   # blend with original
 *   node scripts/apply-lut.mjs out/reel.mp4 --lut path/to/other.cube
 *
 * Output is written next to the input as <name>__lut.mp4.
 */

import {existsSync, statSync} from 'node:fs';
import {basename, dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync, spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/apply-lut.mjs <input.mp4> [--lut path.cube] [--strength 0..1]');
  process.exit(1);
}

const input = resolve(args[0]);
if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  process.exit(1);
}

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

const lut = resolve(arg('lut', resolve(root, '..', 'LUT', 'CELLULOID_01_FU_LOW.cube')));
const strength = Math.max(0, Math.min(1, Number(arg('strength', '1'))));

if (!existsSync(lut)) {
  console.error(`LUT not found: ${lut}`);
  process.exit(1);
}

const stem = basename(input, extname(input));
const out = resolve(dirname(input), `${stem}__lut.mp4`);

console.log(`input    : ${input}`);
console.log(`LUT      : ${lut}`);
console.log(`strength : ${strength}`);
console.log(`output   : ${out}\n`);

const filter = strength === 1
  ? `lut3d=file='${lut.replace(/'/g, "'\\''")}'`
  : `[0:v]split[orig][graded];[graded]lut3d=file='${lut.replace(/'/g, "'\\''")}'[graded];[orig][graded]blend=all_mode=normal:all_opacity=${strength}`;

const cmd = [
  '-y', '-i', input,
  '-filter_complex', filter,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-c:a', 'copy',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  out,
];

const r = spawnSync('ffmpeg', cmd, {stdio: 'inherit'});
if (r.status !== 0) {
  console.error(`\nffmpeg failed (exit ${r.status})`);
  process.exit(r.status ?? 1);
}

const sz = statSync(out).size;
console.log(`\n✓ wrote ${out}  (${(sz / 1024 / 1024).toFixed(1)} MB)`);
