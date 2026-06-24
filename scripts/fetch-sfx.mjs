#!/usr/bin/env node
/**
 * Scrape MyInstants for editorial SFX/transitions matching our reel style:
 * vine-boom (impact), whoosh, click, swoosh, riser, drop, glitch, ding.
 *
 * Pulls from MyInstants top pages + search. Saves to ../SOUND/sfx/.
 *
 *   node scripts/fetch-sfx.mjs
 */

import {writeFileSync, mkdirSync, existsSync, createWriteStream} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sfxDir = resolve(root, '..', 'SOUND', 'sfx');
mkdirSync(sfxDir, {recursive: true});

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EDITORIAL_QUERIES = [
  'vine boom',
  'whoosh transition',
  'swoosh',
  'click ui',
  'riser',
  'bass drop',
  'cinematic hit',
  'impact stinger',
  'tick',
  'page turn',
  'subscribe bell',
  'noti',
];

const TARGET_PER_QUERY = 1;
const ALWAYS_FETCH = [
  '/media/sounds/vine-boom.mp3',
  '/media/sounds/whoosh.mp3',
  '/media/sounds/cinematic-boom.mp3',
];

async function fetchHTML(url) {
  const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'}});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function searchSounds(query) {
  const url = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`;
  let html;
  try {
    html = await fetchHTML(url);
  } catch (e) {
    console.error(`  ! search "${query}": ${e.message}`);
    return [];
  }
  const matches = [...html.matchAll(/play\('(\/media\/sounds\/[^']+\.mp3)'/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

async function downloadOne(soundPath) {
  const url = `https://www.myinstants.com${soundPath}`;
  const filename = soundPath.split('/').pop();
  const out = join(sfxDir, filename);
  if (existsSync(out)) {
    console.log(`  · ${filename} cached`);
    return out;
  }
  const r = await fetch(url, {headers: {'User-Agent': UA}});
  if (!r.ok || !r.body) {
    console.log(`  ! ${filename} HTTP ${r.status}`);
    return null;
  }
  await pipeline(r.body, createWriteStream(out));
  const sz = (await import('node:fs')).statSync(out).size;
  console.log(`  ↓ ${filename} (${(sz / 1024).toFixed(0)} KB)`);
  return out;
}

const downloaded = [];

console.log(`Fetching default editorial SFX …`);
for (const p of ALWAYS_FETCH) {
  const r = await downloadOne(p);
  if (r) downloaded.push(r);
}

console.log(`\nSearching MyInstants for editorial SFX …`);
for (const q of EDITORIAL_QUERIES) {
  console.log(`  ? ${q}`);
  const hits = await searchSounds(q);
  for (const h of hits.slice(0, TARGET_PER_QUERY)) {
    const r = await downloadOne(h);
    if (r) downloaded.push(r);
  }
}

const manifest = {
  fetchedAt: new Date().toString(),
  source: 'myinstants.com',
  count: downloaded.length,
  files: downloaded.map((p) => p.replace(resolve(root, '..') + '/', '')),
  recommendedRoles: {
    'vine-boom': 'hard impact on hook reveal / bold caption',
    'whoosh': 'transition between A-roll and B-roll',
    'cinematic-boom': 'opening punctuation',
    'click': 'caption word reveal accent',
    'subscribe-bell': 'CTA at end',
  },
};
writeFileSync(join(sfxDir, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n→ ${downloaded.length} SFX in ${sfxDir}`);
console.log(`  manifest: ${join(sfxDir, '_manifest.json')}`);
