#!/usr/bin/env node
/**
 * Evaluate onset-gap segmentation recall/precision vs. chapter ground truth.
 *
 * Runs `transcribe --segments` on an audio file, extracts detected boundaries,
 * compares against a chapters file, and reports precision/recall/F1.
 *
 * Usage: node scripts/eval-segmentation.mjs <audio> <chapters.txt> [tolerance_seconds]
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , audioPath, chaptersPath, toleranceArg] = process.argv;
if (!audioPath || !chaptersPath) {
  console.error('Usage: eval-segmentation.mjs <audio> <chapters.txt> [tolerance_sec=3]');
  process.exit(1);
}

const TRANSCRIBE = path.join(__dirname, '..', 'target', 'release', 'transcribe.exe');
const TOLERANCE = parseFloat(toleranceArg || '3');

console.log(`📏 Evaluating onset-gap segmentation`);
console.log(`   Audio: ${audioPath}`);
console.log(`   Ground truth: ${chaptersPath}`);
console.log(`   Match tolerance: ±${TOLERANCE}s\n`);

// Parse ground truth chapter starts
const truth = fs
  .readFileSync(chaptersPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#'))
  .map((l) => {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s+(.+)$/);
    return m ? { time: parseFloat(m[1]), label: m[2].trim() } : null;
  })
  .filter(Boolean);

console.log(`Ground truth: ${truth.length} chapters\n`);

// Run detector
const result = spawnSync(TRANSCRIBE, [audioPath, '/tmp/eval-dummy.gp4', '--segments'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (result.status !== 0) {
  console.error('transcribe failed:', result.stderr);
  process.exit(1);
}

// Extract detected start times from stdout
const detected = [];
const re = /^--- Segment \d+\/\d+: ([\d.]+)s -/gm;
let m;
while ((m = re.exec(result.stdout)) !== null) {
  detected.push(parseFloat(m[1]));
}

console.log(`Detected: ${detected.length} segments\n`);

// Match: for each detected boundary, find closest truth within tolerance
const truthMatched = new Set();
const detectedMatched = new Set();

for (let i = 0; i < detected.length; i++) {
  let bestJ = -1;
  let bestDiff = Infinity;
  for (let j = 0; j < truth.length; j++) {
    if (truthMatched.has(j)) continue;
    const diff = Math.abs(detected[i] - truth[j].time);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestJ = j;
    }
  }
  if (bestJ >= 0 && bestDiff <= TOLERANCE) {
    truthMatched.add(bestJ);
    detectedMatched.add(i);
  }
}

const truePositives = truthMatched.size;
const falsePositives = detected.length - truePositives;
const falseNegatives = truth.length - truePositives;

const precision = truePositives / Math.max(1, detected.length);
const recall = truePositives / Math.max(1, truth.length);
const f1 = 2 * (precision * recall) / Math.max(1e-9, precision + recall);

console.log(`True positives:  ${truePositives}`);
console.log(`False positives: ${falsePositives}`);
console.log(`False negatives: ${falseNegatives}\n`);

console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
console.log(`Recall:    ${(recall * 100).toFixed(1)}%`);
console.log(`F1:        ${(f1 * 100).toFixed(1)}%\n`);

// Show matched + missed
console.log('Matches:');
for (let i = 0; i < detected.length; i++) {
  if (detectedMatched.has(i)) {
    const matchJ = [...truthMatched].find((j) => Math.abs(detected[i] - truth[j].time) <= TOLERANCE);
    const t = truth[matchJ];
    console.log(`  ✓ detected ${detected[i].toFixed(1)}s ≈ chapter ${t.time.toFixed(1)}s "${t.label}"`);
  } else {
    console.log(`  ✗ detected ${detected[i].toFixed(1)}s — no matching chapter`);
  }
}
console.log('\nMissed chapters:');
let missedCount = 0;
for (let j = 0; j < truth.length; j++) {
  if (!truthMatched.has(j)) {
    if (missedCount < 10) {
      console.log(`  ✗ ${truth[j].time.toFixed(1)}s "${truth[j].label}"`);
    }
    missedCount++;
  }
}
if (missedCount > 10) console.log(`  ... (${missedCount - 10} more)`);
