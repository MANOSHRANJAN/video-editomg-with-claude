// Express server that drives the video-edit pipeline.
// Endpoints:
//   POST /api/ingest                 — upload a clip, kick off whisper + brain
//   GET  /api/status/:id             — SSE stream of pipeline events
//   POST /api/edl/:id                — save manual EDL edits, regenerate scene
//   POST /api/render/:id             — run Hyperframes render
//   GET  /api/style-refs             — style memory summary
//   GET  /media/source/:id           — serve the uploaded source for preview
//   GET  /media/out/:id              — serve the rendered MP4
import express from 'express';
import multer from 'multer';
import {spawn} from 'node:child_process';
import {createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync} from 'node:fs';
import {dirname, resolve, basename, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..'); // .../video-edit
dotenv.config({path: resolve(ROOT, '.env')});

const APP_TMP = resolve(ROOT, '.tmp/app');
const UPLOAD_DIR = resolve(ROOT, 'public/aroll');
const OUT_DIR = resolve(ROOT, 'out');
mkdirSync(APP_TMP, {recursive: true});
mkdirSync(UPLOAD_DIR, {recursive: true});
mkdirSync(OUT_DIR, {recursive: true});

const app = express();
app.use(express.json({limit: '8mb'}));

// In-memory job registry. Survives until the server restarts; that's fine
// for a local dev tool.
const jobs = new Map(); // id -> {stem, sourcePath, edlPath, outPath, subs:Set<res>, events:[], done:bool}

function newJob(stem, sourcePath) {
  const id = randomBytes(6).toString('hex');
  const edlPath = resolve(ROOT, `.tmp/${stem}-edl.json`);
  const outPath = resolve(OUT_DIR, `${stem}-${id}.mp4`);
  return jobs.set(id, {id, stem, sourcePath, edlPath, outPath, subs: new Set(), events: [], done: false}).get(id);
}

function emit(job, event) {
  job.events.push(event);
  for (const res of job.subs) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Run a script, streaming stdout/stderr lines as `log` events. cwd defaults
// to the project root; pass `cwd` for Hyperframes (which must run inside
// hyperframes-scenes/).
function runScript(job, label, command, args, cwd = ROOT) {
  return new Promise((resolveP, rejectP) => {
    emit(job, {kind: 'step', phase: label, msg: `${label} → starting`});
    const child = spawn(command, args, {cwd, env: process.env});
    const tap = (b) => {
      for (const line of b.toString().split('\n').filter(Boolean)) {
        emit(job, {kind: 'log', msg: line});
      }
    };
    child.stdout.on('data', tap);
    child.stderr.on('data', tap);
    child.on('exit', (code) => {
      if (code === 0) {
        emit(job, {kind: 'step', phase: label, msg: `${label} ✓`});
        resolveP();
      } else {
        emit(job, {kind: 'error', msg: `${label} failed (exit ${code})`});
        rejectP(new Error(`${label} exit ${code}`));
      }
    });
  });
}

async function runPipeline(job) {
  try {
    emit(job, {kind: 'start', msg: `pipeline starting for ${job.stem}`});
    await runScript(job, 'transcribe', 'node', ['scripts/transcribe.mjs', job.sourcePath]);
    const wordsPath = resolve(ROOT, `.tmp/${job.stem}-words.json`);
    await runScript(job, 'brain', 'node', ['scripts/brain.mjs', wordsPath, '--source', job.sourcePath, '--force']);
    if (existsSync(job.edlPath)) {
      const edl = JSON.parse(readFileSync(job.edlPath, 'utf8'));
      emit(job, {kind: 'edl', edl});
    }
    await runScript(job, 'scene', 'node', ['scripts/build-hyperframes.mjs', job.edlPath]);
    emit(job, {kind: 'log', msg: 'EDL + scene ready. hit render to export MP4.'});
  } catch {
    // emitted already; pipeline halts here
  }
}

const upload = multer({dest: APP_TMP, limits: {fileSize: 500 * 1024 * 1024}});
app.post('/api/ingest', upload.single('clip'), async (req, res) => {
  if (!req.file) return res.status(400).json({error: 'no file'});
  const ext = extname(req.file.originalname || '').toLowerCase() || '.mp4';
  const safe = (req.file.originalname || 'clip').replace(/\.[^.]+$/, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const stem = `${safe || 'clip'}-${randomBytes(2).toString('hex')}`;
  const finalPath = resolve(UPLOAD_DIR, `${stem}${ext}`);
  renameSync(req.file.path, finalPath);
  const job = newJob(stem, finalPath);
  runPipeline(job); // background
  res.json({id: job.id, stem: job.stem, sourcePath: finalPath});
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.set({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });
  res.flushHeaders?.();
  for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  job.subs.add(res);
  req.on('close', () => job.subs.delete(res));
});

app.post('/api/edl/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({error: 'no such job'});
  const next = req.body?.edl;
  if (!next) return res.status(400).json({error: 'missing edl'});
  writeFileSync(job.edlPath, JSON.stringify(next, null, 2));
  try {
    await runScript(job, 'scene', 'node', ['scripts/build-hyperframes.mjs', job.edlPath]);
    res.json({ok: true});
  } catch (e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/render/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({error: 'no such job'});
  res.json({ok: true});
  try {
    await runScript(
      job,
      'render',
      'npx',
      ['--yes', 'hyperframes@0.7.3', 'render', '--output', job.outPath, '-q', 'draft'],
      resolve(ROOT, 'hyperframes-scenes'),
    );
    emit(job, {kind: 'done', output: job.outPath, msg: `rendered ${basename(job.outPath)}`});
    job.done = true;
  } catch {
    // emitted
  }
});

app.get('/api/style-refs', (req, res) => {
  const path = resolve(ROOT, 'style-analysis/editorial-style.json');
  if (!existsSync(path)) return res.json({referenceCount: 0});
  const j = JSON.parse(readFileSync(path, 'utf8'));
  res.json({
    editorialProfile: j.synthesis?.editorialProfile,
    referenceCount: j.perVideo?.length ?? 0,
  });
});

// Range-aware media streaming for <video> previews.
function streamFile(req, res, path) {
  if (!existsSync(path)) return res.status(404).end();
  const stat = statSync(path);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
      'content-type': 'video/mp4',
    });
    createReadStream(path, {start, end}).pipe(res);
  } else {
    res.writeHead(200, {'content-length': stat.size, 'content-type': 'video/mp4'});
    createReadStream(path).pipe(res);
  }
}
app.get('/media/source/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  streamFile(req, res, job.sourcePath);
});
app.get('/media/out/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !existsSync(job.outPath)) return res.status(404).end();
  streamFile(req, res, job.outPath);
});

const PORT = process.env.APP_PORT || 8787;
app.listen(PORT, () => console.log(`video-edit api on http://localhost:${PORT}`));
