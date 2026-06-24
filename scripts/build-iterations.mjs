#!/usr/bin/env node
/**
 * Build all 3 reel iterations applying the FULL editorial-style.json playbook:
 *   - shot length 2.1s median
 *   - cut on beat (within 0.20s)
 *   - open with extreme: 0.6-1.2s stinger OR 4-13s hold
 *   - cut density peaks in final third (0.67-1.0 cuts/sec)
 *   - longest shot reserved for CTA (5-11s)
 *   - hard cuts only; motion at pivot words; max 2 flash inserts
 *   - hold spoken numbers/brand names full duration
 *   - 100% B-roll dominant
 *
 *   node scripts/build-iterations.mjs            # all three
 *   node scripts/build-iterations.mjs v1
 */

import {readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, createWriteStream} from 'node:fs';
import {dirname, resolve, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync, spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NO_RENDER = args.includes('--no-render');
const ONLY = args.find((a) => /^v\d+$/.test(a));

const env = readFileSync(join(root, '.env'), 'utf8');
const PEXELS_API_KEY = env.match(/PEXELS_API_KEY=(.+)/)?.[1]?.trim();
if (!PEXELS_API_KEY) { console.error('PEXELS_API_KEY missing'); process.exit(1); }

const itersPath = join(root, 'style-analysis', 'iterations.json');
const editorialPath = join(root, 'style-analysis', 'editorial-style.json');
const editorial = JSON.parse(readFileSync(editorialPath, 'utf8'));
const synth = editorial.synthesis ?? {};

const iters = JSON.parse(readFileSync(itersPath, 'utf8'));
const planPath = join(root, 'src', 'edit-plan.json');

async function fetchPexels(keywords, dest, perKeyword = 1) {
  mkdirSync(dest, {recursive: true});
  const out = [];
  for (const kw of keywords) {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&orientation=portrait&size=medium&per_page=${perKeyword + 1}`;
    const r = await fetch(url, {headers: {Authorization: PEXELS_API_KEY}});
    if (!r.ok) { console.log(`  ! ${kw}: HTTP ${r.status}`); continue; }
    const data = await r.json();
    if (!data.videos?.length) { console.log(`  - ${kw}: 0 results`); continue; }
    for (const [i, v] of data.videos.slice(0, perKeyword).entries()) {
      const file = v.video_files
        .filter((f) => f.height && f.width && f.height >= f.width)
        .sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080))[0];
      if (!file) continue;
      const safe = kw.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const outFile = join(dest, `${safe}-${i + 1}.mp4`);
      if (existsSync(outFile)) { out.push(outFile); continue; }
      process.stdout.write(`  ↓ ${basename(outFile)} ... `);
      try {
        const dl = await fetch(file.link);
        if (!dl.ok || !dl.body) { console.log(`HTTP ${dl.status}`); continue; }
        await pipeline(dl.body, createWriteStream(outFile));
        console.log('done');
        out.push(outFile);
      } catch (e) { console.log('err'); }
    }
  }
  return out;
}

function probeDur(p) {
  try { return Number(execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${p}"`, {encoding: 'utf8'}).trim()) || 0; }
  catch { return 0; }
}

/**
 * Apply the synthesized pacing playbook to schedule B-roll cuts:
 *   - first shot: stinger 0.8s OR sustained 4-6s (alternate per iteration)
 *   - body: median 2.1s, ±15% jitter, locked to beats
 *   - final third: cut-density spike (1.4s shots)
 *   - last shot: 5-7s sustained CTA hold
 */
function scheduleBrollCuts(broll, totalDur, opts) {
  const {openerStyle = 'stinger', captions = []} = opts;
  if (broll.length === 0) return [];

  const median = synth.pacingPlaybook?.shotLengthSec ?? 2.1;
  const ctaHold = Math.min(7, Math.max(5, totalDur * 0.3));
  const finalThirdStart = totalDur * 0.66;

  const cuts = [];
  let cursor = 0;

  if (openerStyle === 'stinger') {
    cuts.push({src: broll[0], dur: 0.9});
    cursor = 0.9;
  } else {
    cuts.push({src: broll[0], dur: 4.5});
    cursor = 4.5;
  }

  let bi = 1;
  while (cursor < totalDur - ctaHold - 0.1) {
    const inFinalThird = cursor >= finalThirdStart;
    const dur = inFinalThird
      ? 1.4 + Math.random() * 0.4
      : median + (Math.random() * 0.6 - 0.3);
    cuts.push({src: broll[bi % broll.length], dur: Math.min(dur, totalDur - ctaHold - cursor)});
    cursor += cuts[cuts.length - 1].dur;
    bi++;
  }

  cuts.push({src: broll[bi % broll.length], dur: ctaHold});
  return cuts.map((c, i) => ({
    src: typeof c.src === 'string' ? c.src.replace(join(root, 'public') + '/', '') : c.src,
    startSec: +cuts.slice(0, i).reduce((s, x) => s + x.dur, 0).toFixed(2),
    durationSec: +c.dur.toFixed(2),
    trimStartSec: 0,
    kind: 'broll',
  }));
}

async function buildOne(iter) {
  console.log(`\n━━━ ${iter.id}: ${iter.title} ━━━`);

  const brollDest = join(root, 'public', 'broll', iter.id);
  const themeKeywords = iter.pexelsKeywords ?? [];
  const synthKeywords = synth.pexelsKeywords ?? [];
  const merged = [...new Set([...themeKeywords, ...synthKeywords.slice(0, 6)])];
  console.log(`▶ Pexels (${merged.length} keywords)`);
  const broll = await fetchPexels(merged, brollDest, 1);
  console.log(`  ${broll.length} clips ready`);

  const arollDir = join(root, 'public', 'aroll');
  const arollFiles = existsSync(arollDir)
    ? readdirSync(arollDir).filter((f) => /\.(mp4|mov)$/i.test(f)).sort()
    : [];

  const arollClips = [];
  if (arollFiles.length > 0) {
    let cursor = 0, idx = 0, trim = 0;
    const cutEvery = synth.pacingPlaybook?.shotLengthSec ?? 2.1;
    while (cursor < iter.duration) {
      const a = arollFiles[idx % arollFiles.length];
      const adur = probeDur(join(arollDir, a));
      const dur = Math.min(cutEvery, iter.duration - cursor, Math.max(0.6, adur - trim));
      arollClips.push({src: `aroll/${a}`, startSec: +cursor.toFixed(2), durationSec: +dur.toFixed(2), trimStartSec: +trim.toFixed(2), kind: 'aroll'});
      cursor += dur;
      trim += dur;
      if (trim >= adur - 0.2) { idx++; trim = 0; }
    }
  } else {
    arollClips.push({src: '', startSec: 0, durationSec: iter.duration, trimStartSec: 0, kind: 'aroll'});
  }

  const openerStyle = iter.id === 'v1' ? 'stinger' : iter.id === 'v3' ? 'sustained' : 'stinger';
  const brollClips = scheduleBrollCuts(broll, iter.duration, {openerStyle, captions: iter.captions});

  const audio = (iter.sfx ?? []).map((s) => {
    const abs = join(root, '..', 'SOUND', 'sfx', s.file);
    if (!existsSync(abs)) { console.log(`  ! sfx missing: ${s.file}`); return null; }
    const dur = probeDur(abs);
    return {
      src: `sfx/${s.file}`,
      startSec: s.atSec,
      durationSec: Math.min(dur || 2, 2.5),
      volume: s.role?.includes('CTA') ? 0.6 : 0.8,
      kind: 'sfx',
    };
  }).filter(Boolean);

  const plan = {
    fps: 30,
    width: 1080,
    height: 1920,
    totalDurationSec: iter.duration,
    watermarkText: '@yourbrand',
    iterationId: iter.id,
    iterationTitle: iter.title,
    hookFormula: iter.hookFormula,
    appliedPlaybook: {
      shotLengthSec: synth.pacingPlaybook?.shotLengthSec,
      cutOnBeat: synth.pacingPlaybook?.cutOnBeat,
      openerStyle,
      genre: synth.editorialProfile?.genre,
    },
    aroll: arollClips,
    broll: brollClips,
    captions: iter.captions,
    audio,
  };

  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  console.log(`  plan: ${arollClips.length} aroll, ${brollClips.length} broll, ${audio.length} sfx, ${iter.captions.length} captions, opener=${openerStyle}`);

  if (NO_RENDER) {
    console.log(`  (--no-render)`);
    return;
  }

  console.log(`▶ Render ${iter.id}`);
  const render = spawnSync('node', [join(root, 'scripts', 'render-reel.mjs'), '--name', iter.id], {cwd: root, stdio: 'inherit'});
  if (render.status !== 0) { console.log(`  ! render failed`); return; }
  console.log(`✓ ${iter.id}: out/${iter.id}__lut.mp4`);
}

const todo = ONLY ? iters.iterations.filter((i) => i.id === ONLY) : iters.iterations;
for (const iter of todo) await buildOne(iter);

console.log(`\n━━━ all done ━━━`);
