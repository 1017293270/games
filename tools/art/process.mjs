#!/usr/bin/env node
/**
 * raw/*.png  ->  apps/client/public/art/<category>/<name>.webp  + manifest.json
 *
 *   NODE_PATH=<sharp-env>/node_modules node tools/art/process.mjs
 *   ... node tools/art/process.mjs --manifest-only     # rebuild manifest from existing webp
 *   ... node tools/art/process.mjs bg/login item/pill-qi   # only these ids
 *
 * Rules (from docs/ASSETS.md):
 *   - WebP q80, cover-crop + resize to the category's declared size
 *   - backgrounds also get an @720 derivative (short edge 720)
 *   - item/* and ui/* are expected to be transparent; real alpha is measured,
 *     and anything that came back opaque is flattened onto paper tone and
 *     recorded as alpha:false so the client knows not to expect a cutout
 *
 * Retry inputs win automatically: raw/<name>-v3.png beats -v2.png beats <name>.png.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLVED } from './assets.mjs';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'sharp not found. Run with:\n' +
      '  NODE_PATH=/private/tmp/claude-501/-Users-zhuanzmima0000-Developer-work-games/' +
      '393d8163-7141-4f65-adae-356abbc70d2a/scratchpad/sharp-env/node_modules node tools/art/process.mjs',
  );
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const RAW = join(HERE, 'raw');
const OUT = join(REPO, 'apps', 'client', 'public', 'art');

const PAPER = { r: 0xf3, g: 0xeb, b: 0xdc, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const QUALITY = 80;

const args = process.argv.slice(2);
const manifestOnly = args.includes('--manifest-only');
const only = new Set(args.filter((a) => !a.startsWith('--')));

/** Newest retry wins: <name>-v9.png ... <name>-v2.png ... <name>.png */
function pickRaw(flat) {
  if (!existsSync(RAW)) return null;
  const versioned = readdirSync(RAW)
    .filter((f) => new RegExp(`^${flat}-v(\\d+)\\.png$`).test(f))
    .sort((a, b) => Number(b.match(/-v(\d+)\./)[1]) - Number(a.match(/-v(\d+)\./)[1]));
  for (const f of versioned) return join(RAW, f);
  const plain = join(RAW, `${flat}.png`);
  return existsSync(plain) ? plain : null;
}

/**
 * Fraction of pixels that are effectively transparent, measured on a 128px
 * thumbnail so this stays cheap. A generated PNG very often carries an alpha
 * channel that is entirely opaque — that is not a cutout.
 */
async function alphaCoverage(file) {
  const meta = await sharp(file).metadata();
  if (!meta.hasAlpha) return 0;
  const { data, info } = await sharp(file)
    .resize(128, 128, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let clear = 0;
  const px = info.width * info.height;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 16) clear++;
  return clear / px;
}

async function emit(src, dest, [w, h], keepAlpha) {
  mkdirSync(dirname(dest), { recursive: true });
  let p = sharp(src).resize(w, h, {
    fit: 'cover',
    position: 'centre',
    background: keepAlpha ? TRANSPARENT : PAPER,
  });
  if (!keepAlpha) p = p.flatten({ background: PAPER });
  await p.webp({ quality: QUALITY, alphaQuality: 90, effort: 5 }).toFile(dest);
  return statSync(dest).size;
}

const manifest = { version: 1, generatedAt: new Date().toISOString(), assets: {} };
const rows = [];
const missing = [];
const degraded = [];

for (const a of RESOLVED) {
  const [w, h] = a.out;
  const dest = join(OUT, `${a.id}.webp`);
  const entry = { src: `/art/${a.id}.webp`, w, h, alpha: false };

  if (!manifestOnly && (!only.size || only.has(a.id))) {
    const raw = pickRaw(a.flat);
    if (!raw) {
      missing.push(a.id);
      continue;
    }
    const cov = a.alpha ? await alphaCoverage(raw) : 0;
    const keepAlpha = a.alpha && cov >= 0.02;
    if (a.alpha && !keepAlpha) degraded.push({ id: a.id, coverage: cov });

    const size = await emit(raw, dest, [w, h], keepAlpha);
    let smallSize = 0;
    if (a.small) smallSize = await emit(raw, join(OUT, `${a.id}@720.webp`), a.small, false);

    entry.alpha = keepAlpha;
    rows.push({
      id: a.id,
      src: raw.replace(RAW + '/', ''),
      out: `${w}x${h}`,
      kb: (size / 1024).toFixed(1),
      smallKb: smallSize ? (smallSize / 1024).toFixed(1) : '-',
      alpha: keepAlpha ? 'yes' : a.alpha ? 'NO(degraded)' : '-',
    });
  } else if (!existsSync(dest)) {
    missing.push(a.id);
    continue;
  } else {
    const meta = await sharp(dest).metadata();
    entry.alpha = Boolean(meta.hasAlpha) && (await alphaCoverage(dest)) >= 0.02;
  }

  if (a.small) entry.srcSmall = `/art/${a.id}@720.webp`;
  // stable key order: src, srcSmall, w, h, alpha
  manifest.assets[a.id] = {
    src: entry.src,
    ...(entry.srcSmall ? { srcSmall: entry.srcSmall } : {}),
    w: entry.w,
    h: entry.h,
    alpha: entry.alpha,
  };
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

if (rows.length) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `\n${pad('id', 34)}${pad('out', 10)}${pad('kb', 9)}${pad('@720kb', 9)}alpha`,
  );
  for (const r of rows) {
    console.log(`${pad(r.id, 34)}${pad(r.out, 10)}${pad(r.kb, 9)}${pad(r.smallKb, 9)}${r.alpha}`);
  }
}
console.log(`\nprocessed ${rows.length} / ${RESOLVED.length}`);
if (degraded.length) {
  console.log(`degraded to opaque (expected alpha, got none): ${degraded.length}`);
  for (const d of degraded) console.log(`  ${d.id}  transparent-pixel share ${(d.coverage * 100).toFixed(1)}%`);
}
if (missing.length) {
  console.log(`MISSING raw png for ${missing.length}: ${missing.join(', ')}`);
}
console.log(`manifest -> ${join(OUT, 'manifest.json')} (${Object.keys(manifest.assets).length} entries)`);
