#!/usr/bin/env node
/**
 * Search Pexels for vertical (9:16) B-roll videos and download them
 * into public/broll/. Uses keywords from style-analysis/style.json
 * (or pass keywords via CLI args).
 *
 *   node scripts/fetch-broll.mjs makeup vanity skincare
 *   node scripts/fetch-broll.mjs           # reads style.json keywords
 */

import {readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env'), 'utf8');
const PEXELS_API_KEY = env.match(/PEXELS_API_KEY=(.+)/)?.[1]?.trim();

if (!PEXELS_API_KEY) {
  console.error('PEXELS_API_KEY missing from .env');
  process.exit(1);
}

const stylePath = join(root, 'style-analysis', 'style.json');
const brollDir = join(root, 'public', 'broll');
mkdirSync(brollDir, {recursive: true});

let keywords = process.argv.slice(2);
if (keywords.length === 0 && existsSync(stylePath)) {
  const style = JSON.parse(readFileSync(stylePath, 'utf8'));
  keywords = style.keywords ?? [];
}
if (keywords.length === 0) {
  console.error('No keywords. Pass them as args or add "keywords" to style.json');
  process.exit(1);
}

console.log(`Pexels search keywords: ${keywords.join(', ')}`);

const PER_KEYWORD = 2;
const downloaded = [];

for (const kw of keywords) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&orientation=portrait&size=medium&per_page=${PER_KEYWORD}`;
  const r = await fetch(url, {headers: {Authorization: PEXELS_API_KEY}});
  if (!r.ok) {
    console.error(`  ! ${kw}: HTTP ${r.status}`);
    continue;
  }
  const data = await r.json();
  if (!data.videos?.length) {
    console.log(`  - ${kw}: no results`);
    continue;
  }

  for (const [i, v] of data.videos.entries()) {
    const file = v.video_files
      .filter((f) => f.width && f.height && f.height >= f.width)
      .sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080))[0];
    if (!file) continue;

    const safeKw = kw.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const outPath = join(brollDir, `pexels-${safeKw}-${i + 1}.mp4`);
    if (existsSync(outPath)) {
      console.log(`  · ${kw}#${i + 1} cached`);
      downloaded.push(outPath);
      continue;
    }
    process.stdout.write(`  ↓ ${kw}#${i + 1} (${file.width}x${file.height}) ... `);
    const dl = await fetch(file.link);
    if (!dl.ok || !dl.body) {
      console.log(`HTTP ${dl.status}`);
      continue;
    }
    await pipeline(dl.body, createWriteStream(outPath));
    console.log('done');
    downloaded.push(outPath);
  }
}

console.log(`\nDownloaded ${downloaded.length} clip(s) → public/broll/`);
console.log(`Next: node scripts/import-broll.mjs   # to wire them into edit-plan.json`);
