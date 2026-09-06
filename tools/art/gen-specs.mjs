#!/usr/bin/env node
/**
 * Writes one gpt-image-2 prompt spec per asset into tools/art/specs/.
 *
 *   node tools/art/gen-specs.mjs            # write all 98
 *   node tools/art/gen-specs.mjs bg/login   # write only these ids
 *
 * The style/palette/materials/avoid blocks come from shared constants, so every
 * spec in a category carries byte-identical wording where it matters. A category
 * may override all four (zone/ and sprite/ do, to use the vivid dark-ground
 * style); anything that overrides none falls back to the pale xuan-paper set,
 * which is why regenerating the original 82 is byte-for-byte a no-op.
 * Regenerating is idempotent; hand-written retry specs (*-v2.txt) are untouched.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLVED, STYLE, PALETTE, AVOID_BASE, MATERIALS } from './assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS = join(HERE, 'specs');

export function buildSpec(a) {
  const b = a.base;
  const lines = [
    `Use case: ${b.useCase}`,
    `Asset type: ${b.assetType}`,
    `Primary request: ${a.subject}`,
    `Style/medium: ${b.style ?? STYLE}`,
    `Composition/framing: ${a.compositionOverride ?? b.composition}`,
  ];
  if (a.mood) lines.push(`Lighting/mood: ${a.mood}`);
  lines.push(`Color palette: ${b.palette ?? PALETTE}${a.paletteExtra ?? ''}`);
  lines.push(`Materials/textures: ${b.materials ?? MATERIALS}`);
  lines.push(`Constraints: ${b.constraints}${a.extraConstraints ?? ''}`);
  lines.push(`Avoid: ${b.avoid ?? AVOID_BASE}, ${b.avoidExtra}`);
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
