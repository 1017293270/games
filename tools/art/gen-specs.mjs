#!/usr/bin/env node
/**
 * Writes one gpt-image-2 prompt spec per asset into tools/art/specs/.
 *
 *   node tools/art/gen-specs.mjs            # write all 80
 *   node tools/art/gen-specs.mjs bg/login   # write only these ids
 *
 * The style/avoid blocks are assembled from shared constants so all 80 specs
 * carry byte-identical wording where it matters. Regenerating is idempotent;
 * hand-written retry specs (*-v2.txt) are never touched.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLVED, STYLE, PALETTE, AVOID_BASE } from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS = join(HERE, 'specs');

export function buildSpec(a) {
  const b = a.base;
  const lines = [
    `Use case: ${b.useCase}`,
    `Asset type: ${b.assetType}`,
    `Primary request: ${a.subject}`,
    `Style/medium: ${STYLE}`,
    `Composition/framing: ${a.compositionOverride ?? b.composition}`,
  ];
  if (a.mood) lines.push(`Lighting/mood: ${a.mood}`);
  lines.push(`Color palette: ${PALETTE}${a.paletteExtra ?? ''}`);
  lines.push(
    `Materials/textures: absorbent xuan rice paper grain, wet ink bleed into damp fibre, dry-brush scratch where the brush runs out of ink`,
  );
  lines.push(`Constraints: ${b.constraints}${a.extraConstraints ?? ''}`);
  lines.push(`Avoid: ${AVOID_BASE}, ${b.avoidExtra}`);
  lines.push(`Output size: ${a.request}`);

  let text = lines.join('\n') + '\n';
  if (a.alpha) {
    text +=
      '\nOPERATOR NOTE: when you call image_gen, explicitly ask for a transparent background and ' +
      'preserve the generated alpha channel; save the result as a PNG that still has its alpha channel intact.\n';
  }
  return text;
}

const only = new Set(process.argv.slice(2));
mkdirSync(SPECS, { recursive: true });
let n = 0;
for (const a of RESOLVED) {
  if (only.size && !only.has(a.id)) continue;
  writeFileSync(join(SPECS, `${a.flat}.txt`), buildSpec(a));
  n++;
}
console.log(`wrote ${n} specs -> ${SPECS}`);
