#!/usr/bin/env node
/**
 * Reads every video in public/broll/, sorts by filename,
 * and rewrites the broll[] array in src/edit-plan.json,
 * spacing them evenly across the timeline.
 *
 * Run after dropping new Hyperframes exports into public/broll/.
 *
 *   node scripts/import-broll.mjs
 */

import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planPath = join(root, 'src', 'edit-plan.json');
const brollDir = join(root, 'public', 'broll');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const files = readdirSync(brollDir)
  .filter((f) => VIDEO_EXT.has('.' + f.split('.').pop().toLowerCase()))
  .sort();

if (files.length === 0) {
  console.log('No B-roll files found in public/broll/. Drop Hyperframes exports there first.');
  process.exit(0);
}

const total = plan.totalDurationSec;
const each = 1.6;
const gap = (total - files.length * each) / (files.length + 1);

plan.broll = files.map((file, i) => ({
  src: `broll/${file}`,
  startSec: +(gap + i * (each + gap)).toFixed(2),
  durationSec: each,
  trimStartSec: 0,
  kind: 'broll',
}));

writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
console.log(`Updated ${files.length} B-roll clip(s) in edit-plan.json`);
files.forEach((f, i) => console.log(`  ${i + 1}. ${f} @ ${plan.broll[i].startSec}s`));
