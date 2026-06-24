#!/usr/bin/env node
/**
 * Generate src/edit-plan.json from rich editorial signal:
 *   - style-analysis/editorial-style.json   (synthesized cutting rules + hook formula)
 *   - style-analysis/style.json             (fallback pacing if editorial missing)
 *   - public/aroll/*.mp4|.mov                your raw footage
 *   - public/broll/*.mp4                     Pexels / Hyperframes / manual exports
 *
 *   node scripts/generate-plan.mjs                       # default 30s
 *   node scripts/generate-plan.mjs --duration 20
 *   node scripts/generate-plan.mjs --aroll talking-head.mp4  # specific A-roll
 */

import {readFileSync, writeFileSync, readdirSync, existsSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const TARGET_DURATION = Number(arg('duration', 30));
const SPECIFIC_AROLL = arg('aroll', null);

const editorialPath = join(root, 'style-analysis', 'editorial-style.json');
const stylePath = join(root, 'style-analysis', 'style.json');
const planPath = join(root, 'src', 'edit-plan.json');
const arollDir = join(root, 'public', 'aroll');
const brollDir = join(root, 'public', 'broll');

const editorial = existsSync(editorialPath) ? JSON.parse(readFileSync(editorialPath, 'utf8')) : null;
const style = existsSync(stylePath) ? JSON.parse(readFileSync(stylePath, 'utf8')) : null;

if (!editorial && !style) {
  console.error('Need editorial-style.json or style.json. Run analyze.py first.');
  process.exit(1);
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const arollFiles = readdirSync(arollDir).filter((f) => VIDEO_EXT.test(f)).sort();
const brollFiles = readdirSync(brollDir).filter((f) => VIDEO_EXT.test(f)).sort();

const arollPick = SPECIFIC_AROLL ? [SPECIFIC_AROLL] : arollFiles;

function probeDuration(absPath) {
  try {
    return Number(execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${absPath}"`,
      {encoding: 'utf8'},
    ).trim()) || 0;
  } catch {
    return 0;
  }
}

const aroll = arollPick.map((f) => ({file: f, duration: probeDuration(join(arollDir, f))}));
const broll = brollFiles.map((f) => ({file: f, duration: probeDuration(join(brollDir, f))}));

const fps = style?.outputTarget?.fps ?? 30;
const W = style?.outputTarget?.width ?? 1080;
const H = style?.outputTarget?.height ?? 1920;

const playbookCutLen = editorial?.synthesis?.pacingPlaybook?.shotLengthSec
  ?? style?.aggregate?.medianShotLengthSec
  ?? 2.3;
const cutInterval = Math.max(1.0, playbookCutLen);
const acceleratesAt = editorial?.synthesis?.pacingPlaybook?.acceleratesAtSec ?? null;
const cutOnBeat = editorial?.synthesis?.pacingPlaybook?.cutOnBeat ?? false;

const arollClips = [];
const brollClips = [];

if (aroll.length > 0) {
  let cursor = 0;
  let arollIdx = 0;
  let trim = 0;
  while (cursor < TARGET_DURATION) {
    const a = aroll[arollIdx % aroll.length];
    const accelFactor = acceleratesAt && cursor > acceleratesAt ? 0.7 : 1.0;
    const baseDur = cutInterval * accelFactor;
    const dur = Math.min(
      baseDur,
      TARGET_DURATION - cursor,
      Math.max(0.5, (a.duration || cutInterval) - trim),
    );
    arollClips.push({
      src: `aroll/${a.file}`,
      startSec: +cursor.toFixed(2),
      durationSec: +dur.toFixed(2),
      trimStartSec: +trim.toFixed(2),
      kind: 'aroll',
    });
    cursor += dur;
    trim += dur;
    if (trim >= (a.duration || cutInterval) - 0.2) {
      arollIdx++;
      trim = 0;
    }
  }
} else {
  arollClips.push({src: '', startSec: 0, durationSec: TARGET_DURATION, trimStartSec: 0, kind: 'aroll'});
}

if (broll.length > 0) {
  const ratioStr = editorial?.synthesis?.brollGuidance?.ratioToAroll || '1:3';
  const m = ratioStr.match(/(\d+)\s*:\s*(\d+)/);
  const brollSecPerAroll = m ? Number(m[1]) / Number(m[2]) : 0.33;
  const brollEvery = Math.max(2.5, cutInterval * 2 / Math.max(0.1, brollSecPerAroll * 3));

  let cursor = brollEvery * 0.6;
  let bi = 0;
  while (cursor < TARGET_DURATION - 1) {
    const b = broll[bi % broll.length];
    const dur = Math.min(1.6, b.duration || 1.6, TARGET_DURATION - cursor);
    brollClips.push({
      src: `broll/${b.file}`,
      startSec: +cursor.toFixed(2),
      durationSec: +dur.toFixed(2),
      trimStartSec: 0,
      kind: 'broll',
    });
    cursor += brollEvery;
    bi++;
  }
}

const captions = editorial?.synthesis?.hookFormula
  ? [
      {text: 'HOOK', startSec: 0, durationSec: 1.5},
      {text: 'point one', startSec: 2, durationSec: 3},
      {text: 'CTA', startSec: TARGET_DURATION - 3, durationSec: 3},
    ]
  : [
      {text: 'hook line', startSec: 0, durationSec: 2},
      {text: 'first beat', startSec: 2, durationSec: 3},
      {text: 'punchline', startSec: TARGET_DURATION - 3, durationSec: 3},
    ];

const plan = {
  fps,
  width: W,
  height: H,
  totalDurationSec: TARGET_DURATION,
  styleSummary: {
    source: editorial ? 'editorial-style.json' : 'style.json',
    avgShotLengthSec: style?.aggregate?.avgShotLengthSec,
    medianShotLengthSec: style?.aggregate?.medianShotLengthSec,
    palette: style?.aggregate?.topPalette?.slice(0, 4),
    keywords: editorial?.synthesis?.pexelsKeywords ?? style?.keywords,
    genre: editorial?.synthesis?.editorialProfile?.genre,
    mood: editorial?.synthesis?.editorialProfile?.mood,
    hookFormula: editorial?.synthesis?.hookFormula,
    cuttingRules: editorial?.synthesis?.cuttingRules,
    brollGuidance: editorial?.synthesis?.brollGuidance,
    captionGuidance: editorial?.synthesis?.captionGuidance,
    cutOnBeat,
  },
  aroll: arollClips,
  broll: brollClips,
  captions,
};

writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
console.log(`Plan written: ${planPath}`);
console.log(`  source       : ${plan.styleSummary.source}`);
console.log(`  aroll clips  : ${arollClips.length}  (cut every ~${cutInterval.toFixed(2)}s${acceleratesAt ? `, accel @ ${acceleratesAt}s` : ''})`);
console.log(`  broll clips  : ${brollClips.length}`);
console.log(`  duration     : ${TARGET_DURATION}s @ ${fps}fps`);
if (editorial?.synthesis?.hookFormula) {
  console.log(`  hook formula : ${editorial.synthesis.hookFormula}`);
}
console.log(`  edit captions in src/edit-plan.json, then: npx remotion studio`);
