#!/usr/bin/env node
/**
 * Transcribe an audio file using Spotify's Basic Pitch neural network.
 * Outputs JSON to stdout: { notes: [{ start, duration, pitchMidi, amplitude }, ...] }
 *
 * Usage: node scripts/basic-pitch-transcribe.mjs <audio-file>
 *
 * Note: we avoid @tensorflow/tfjs-node (native bindings break on newer Node)
 * and instead serve the model over a localhost HTTP server, because Node's
 * fetch() doesn't support file:// URLs.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Usage: basic-pitch-transcribe.mjs <audio-file>');
  process.exit(1);
}
if (!fs.existsSync(audioPath)) {
  console.error(`File not found: ${audioPath}`);
  process.exit(1);
}

const load = (await import('audio-loader')).default;
const tf = await import('@tensorflow/tfjs');

// WASM backend is optional: faster when it works, but kernel coverage is incomplete for
// basic-pitch's ops in tfjs v3. If it fails to init or crashes during inference, we
// fall back to pure-JS CPU backend.
let tryWasm = true;
let setWasmPaths = null;
try {
  ({ setWasmPaths } = await import('@tensorflow/tfjs-backend-wasm'));
  await import('@tensorflow/tfjs-backend-wasm');
} catch {
  tryWasm = false;
  console.error('[info] @tensorflow/tfjs-backend-wasm not installed — using CPU');
}

const { BasicPitch, outputToNotesPoly, noteFramesToTime, addPitchBendsToNoteEvents } = await import(
  '@spotify/basic-pitch'
);

// Paths to the two sets of files we need to serve
const modelDir = path.join(
  path.dirname(require.resolve('@spotify/basic-pitch/package.json')),
  'model'
);
const wasmDir = tryWasm
  ? path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist')
  : null;

// --- Serve model + wasm over localhost so tfjs' fetch() can load them ---
const server = http.createServer((req, res) => {
  const filename = path.basename(req.url || '');
  // Look in both model dir and wasm dir
  let filepath = path.join(modelDir, filename);
  if (!fs.existsSync(filepath) && wasmDir) {
    filepath = path.join(wasmDir, filename);
  }
  if (!fs.existsSync(filepath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const data = fs.readFileSync(filepath);
  const ct = filename.endsWith('.json')
    ? 'application/json'
    : filename.endsWith('.wasm')
      ? 'application/wasm'
      : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  res.end(data);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const serverBase = `http://127.0.0.1:${port}/`;
const modelUrl = `${serverBase}model.json`;
console.error(`[info] Local server on port ${port}`);

// Try WASM backend (3-5× faster when working). Known bug: tfjs v3 WASM backend
// doesn't cover all ops basic-pitch uses (crashes in BackendWasm.move), so we test
// it with a small op first and fall back to CPU if it crashes.
let backendOk = false;
if (tryWasm && setWasmPaths) {
  try {
    setWasmPaths(wasmDir + path.sep);
    await tf.setBackend('wasm');
    await tf.ready();
    // Smoke test: run a trivial op to catch the kernel-coverage bug before inference
    const a = tf.tensor1d([1, 2, 3]);
    const b = a.add(1);
    await b.array();
    a.dispose();
    b.dispose();
    backendOk = true;
    console.error(`[info] Using tfjs WASM backend (fast)`);
  } catch (e) {
    console.error(`[warn] WASM backend smoke test failed: ${e.message}`);
  }
}
if (!backendOk) {
  await tf.setBackend('cpu');
  await tf.ready();
  console.error(`[info] Using tfjs CPU backend (pure JS — slow)`);
}

try {
  console.error(`[info] Loading audio: ${audioPath}`);
  const audio = await load(audioPath);
  console.error(
    `[info] Loaded: ${audio.length} samples @ ${audio.sampleRate} Hz, duration ${audio.duration.toFixed(2)}s`
  );

  const samples =
    audio._data instanceof Float32Array ? audio._data : new Float32Array(audio._data);

  console.error(`[info] Loading model: ${modelUrl}`);
  const basicPitch = new BasicPitch(modelUrl);

  const frames = [];
  const onsets = [];
  const contours = [];

  console.error('[info] Running inference...');
  const started = Date.now();
  await basicPitch.evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (progress) => {
      process.stderr.write(`\r[info] Progress: ${(progress * 100).toFixed(0)}%`);
    }
  );
  process.stderr.write('\n');
  const elapsed = (Date.now() - started) / 1000;
  console.error(`[info] Inference done in ${elapsed.toFixed(1)}s`);

  const onsetThreshold = 0.5;
  const frameThreshold = 0.3;
  const minNoteLen = 11;

  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, onsetThreshold, frameThreshold, minNoteLen)
    )
  );
  console.error(`[info] Extracted ${notes.length} note events`);

  const output = {
    sourceFile: audioPath,
    notes: notes.map((n) => ({
      start: n.startTimeSeconds,
      duration: n.durationSeconds,
      pitchMidi: n.pitchMidi,
      amplitude: n.amplitude,
    })),
  };
  process.stdout.write(JSON.stringify(output, null, 2));
} finally {
  server.close();
}
