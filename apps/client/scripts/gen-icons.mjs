#!/usr/bin/env node
/**
 * Rasterises the app icon.
 *
 * The mark is a 朱砂 seal — the same object the interface stamps on a finished
 * breakthrough — drawn as SVG here and screenshotted through Playwright's
 * Chromium so the PNGs the PWA manifest needs come out of the same source.
 *
 * Run: pnpm --filter @xianxia/client run icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const CLIENT_DIR = path.resolve(import.meta.dirname, '..');
const ICON_DIR = path.join(CLIENT_DIR, 'public', 'icons');

const CINNABAR = '#B23A2E';
const PAPER = '#F3EBDC';

/** `inset` is the fraction of the canvas kept clear for a maskable safe zone. */
function seal({ size, bleed }) {
  const pad = bleed ? 0 : size * 0.06;
  const plate = size - pad * 2;
  const border = size * 0.035;
  const glyph = size * (bleed ? 0.44 : 0.56);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bleed ? CINNABAR : PAPER}"/>
  <rect x="${pad}" y="${pad}" width="${plate}" height="${plate}" rx="${size * 0.02}" fill="${CINNABAR}"/>
  <rect x="${pad + border}" y="${pad + border}" width="${plate - border * 2}" height="${plate - border * 2}"
        rx="${size * 0.012}" fill="none" stroke="${PAPER}" stroke-opacity="0.5" stroke-width="${size * 0.012}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="STKaiti, Kaiti SC, KaiTi, Songti SC, serif"
        font-size="${glyph}" fill="${PAPER}">道</text>
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, bleed: false },
  { file: 'icon-512.png', size: 512, bleed: false },
  { file: 'icon-maskable-512.png', size: 512, bleed: true },
];

async function main() {
  await mkdir(ICON_DIR, { recursive: true });
  await writeFile(path.join(ICON_DIR, 'seal.svg'), `${seal({ size: 256, bleed: false })}\n`);

  const browser = await chromium.launch();
  try {
    for (const target of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      const svg = seal(target);
      await page.setContent(
        `<style>html,body{margin:0;padding:0;background:${PAPER}}svg{display:block}</style>${svg}`,
      );
      await page.screenshot({ path: path.join(ICON_DIR, target.file) });
      await page.close();
      process.stdout.write(`已写出 icons/${target.file} (${target.size}×${target.size})\n`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`图标生成失败：${error?.message ?? error}\n`);
  process.exitCode = 1;
});
