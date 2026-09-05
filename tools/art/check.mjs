#!/usr/bin/env node
/**
 * Validates the built art directory against the contract in docs/ASSETS.md.
 *
 *   NODE_PATH=<sharp-env>/node_modules node tools/art/check.mjs
 *
 * Checks, per asset:
 *   - the id is one of the 80 ids parsed straight out of docs/ASSETS.md
 *   - manifest entry exists, file exists, file is non-empty WebP
 *   - pixel dimensions match the manifest's declared w/h
 *   - backgrounds carry an @720 derivative with a 720 short edge
 *   - manifest `alpha` matches the file's measured transparency
 * Exits non-zero if anything fails.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { RESOLVED } from './assets.mjs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp not found — set NODE_PATH to the sharp env (see README).');
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = join(REPO, 'apps', 'client', 'public', 'art');
const CONTRACT = join(REPO, 'docs', 'ASSETS.md');

const fail = [];
const warn = [];
const err = (id, msg) => fail.push(`${id}: ${msg}`);

// --- 1. the contract itself is the source of the id list ------------------
let contractIds = null;
if (existsSync(CONTRACT)) {
  const md = readFileSync(CONTRACT, 'utf8');
  contractIds = new Set(md.match(/\b(?:bg|npc|avatar|monster|boss|item|ui)\/[a-z0-9-]+/g) ?? []);
} else {
  warn.push('docs/ASSETS.md not found — skipped contract cross-check');
}

const localIds = new Set(RESOLVED.map((a) => a.id));
if (contractIds) {
  if (contractIds.size !== 80) warn.push(`docs/ASSETS.md yielded ${contractIds.size} ids, expected 80`);
  for (const id of contractIds) if (!localIds.has(id)) fail.push(`assets.mjs is missing contract id ${id}`);
  for (const id of localIds) if (!contractIds.has(id)) fail.push(`assets.mjs has id ${id} not in docs/ASSETS.md`);
}
if (localIds.size !== 80) fail.push(`assets.mjs defines ${localIds.size} ids, expected 80`);

// --- 2. manifest ----------------------------------------------------------
const manifestPath = join(OUT, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FAIL: no manifest.json — run process.mjs first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1) fail.push(`manifest.version is ${manifest.version}, expected 1`);
if (!/^\d{4}-\d{2}-\d{2}T/.test(manifest.generatedAt ?? '')) fail.push('manifest.generatedAt is not an ISO timestamp');
const keys = Object.keys(manifest.assets ?? {});
if (keys.length !== 80) fail.push(`manifest has ${keys.length} assets, expected 80`);
for (const k of keys) if (!localIds.has(k)) fail.push(`manifest has unknown id ${k}`);

async function coverage(file) {
  const meta = await sharp(file).metadata();
  if (!meta.hasAlpha) return 0;
  const { data, info } = await sharp(file).resize(128, 128, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 16) clear++;
  return clear / (info.width * info.height);
}

const byCat = {};
let totalBytes = 0;
let alphaOk = 0;
let alphaDegraded = 0;

for (const a of RESOLVED) {
  const m = manifest.assets[a.id];
  if (!m) {
    err(a.id, 'absent from manifest');
    continue;
  }
  const file = join(OUT, `${a.id}.webp`);
  if (m.src !== `/art/${a.id}.webp`) err(a.id, `manifest src is ${m.src}`);
  if (!existsSync(file)) {
    err(a.id, 'webp file missing');
    continue;
  }
  const bytes = statSync(file).size;
  if (bytes < 1024) err(a.id, `file suspiciously small (${bytes} bytes)`);
  totalBytes += bytes;

  const meta = await sharp(file).metadata();
  if (meta.format !== 'webp') err(a.id, `format is ${meta.format}, expected webp`);
  const [w, h] = a.out;
  if (meta.width !== w || meta.height !== h) err(a.id, `is ${meta.width}x${meta.height}, expected ${w}x${h}`);
  if (m.w !== w || m.h !== h) err(a.id, `manifest says ${m.w}x${m.h}, expected ${w}x${h}`);

  const cov = await coverage(file);
  const real = cov >= 0.02;
  if (m.alpha !== real) err(a.id, `manifest alpha=${m.alpha} but measured transparency ${(cov * 100).toFixed(1)}%`);
  if (a.alpha) {
    if (real) alphaOk++;
    else {
      alphaDegraded++;
      warn.push(`${a.id}: expected transparent, shipped opaque (alpha:false)`);
    }
  } else if (real) {
    err(a.id, 'has unexpected transparency');
  }

  if (a.small) {
    if (m.srcSmall !== `/art/${a.id}@720.webp`) err(a.id, `manifest srcSmall is ${m.srcSmall}`);
    const sf = join(OUT, `${a.id}@720.webp`);
    if (!existsSync(sf)) err(a.id, '@720 derivative missing');
    else {
      const sm = await sharp(sf).metadata();
      if (Math.min(sm.width, sm.height) !== 720) err(a.id, `@720 short edge is ${Math.min(sm.width, sm.height)}`);
      totalBytes += statSync(sf).size;
    }
  } else if (m.srcSmall) {
    err(a.id, 'has srcSmall but is not a background');
  }

  const c = a.id.split('/')[0];
  byCat[c] ??= { n: 0, bytes: 0 };
  byCat[c].n++;
  byCat[c].bytes += bytes;
}

// --- 3. report ------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('category', 12)}${pad('count', 8)}${pad('size', 12)}avg`);
for (const [c, v] of Object.entries(byCat).sort()) {
  console.log(`${pad(c, 12)}${pad(v.n, 8)}${pad((v.bytes / 1024).toFixed(0) + ' KB', 12)}${(v.bytes / v.n / 1024).toFixed(1)} KB`);
}
console.log(`${pad('TOTAL', 12)}${pad(Object.values(byCat).reduce((s, v) => s + v.n, 0), 8)}${(totalBytes / 1024 / 1024).toFixed(2)} MB (incl. @720)`);
console.log(`\ntransparent assets: ${alphaOk} real alpha, ${alphaDegraded} degraded to opaque`);

try {
  console.log(`du -sh: ${execFileSync('du', ['-sh', OUT]).toString().trim()}`);
} catch {}

if (warn.length) {
  console.log(`\n${warn.length} warning(s):`);
  for (const w of warn) console.log(`  ! ${w}`);
}
if (fail.length) {
  console.log(`\n${fail.length} FAILURE(s):`);
  for (const f of fail) console.log(`  x ${f}`);
  process.exit(1);
}
console.log('\nOK — all 80 assets present, sized and consistent with the manifest.');
