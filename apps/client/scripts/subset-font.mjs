#!/usr/bin/env node
/**
 * Builds the self-hosted calligraphic display face.
 *
 * Downloads Ma Shan Zheng (SIL Open Font License 1.1) from the upstream Google
 * Fonts repository and subsets it with harfbuzz to only the characters this
 * game actually sets in the display face — realm names, map and monster names,
 * the fixed interface copy, and the syllables the bot name generator draws
 * from. A full CJK face is ~4 MB; the subset is a couple of tens of KB.
 *
 * Run: pnpm --filter @xianxia/client run font
 * If the download fails the existing subset is left alone and the CSS stack
 * falls through to a system 楷体, which is a downgrade rather than a break.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import {
  BOT_GIVEN_NAMES,
  BOT_SUFFIXES,
  BOT_SURNAMES,
  DUNGEONS,
  ELEMENT_NAMES,
  EXPLORE_MAPS,
  MONSTERS,
  NPCS,
  REALM_NAMES,
  SKILLS,
  SPIRIT_ROOT_QUALITY_NAMES,
  STAGES,
  SUB_STAGE_NAMES,
  TECHNIQUES,
} from '@xianxia/shared';

const FONT_URL =
  'https://github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf';
const CLIENT_DIR = path.resolve(import.meta.dirname, '..');
const CACHE_PATH = path.join(CLIENT_DIR, 'node_modules', '.cache', 'MaShanZheng-Regular.ttf');
const OUT_PATH = path.join(CLIENT_DIR, 'public', 'fonts', 'mashanzheng-subset.woff2');
const MAX_GLYPHS = 400;

/** Fixed interface copy set in the display face, in `src/**`. */
const UI_COPY = [
  '青云问道',
  '一炉丹火半世逍遥',
  '修炼探索秘境论道社交角色',
  '道号密钥邀请码登录注册入山门录名入册',
  '结庐问道测灵根形貌男修女修',
  '闭关归来继续修行入账修为计入时长逾期作废连破',
  '运功破境起念破境引劫加身再等等收功再修一阵观其结果',
  '成算天劫破阻劫胜负和对阵回合跳过',
  '山河图讨伐采药循迹而行机缘',
  '己身资质神通行囊八相功法随身可修习正修改修留空此槽',
  '同道世界榜单道友境界战力天梯传音谕傀儡',
  '修士名帖论道切磋下一版开放后台建设中返回修炼场',
  '丹房服下装备卸下材料未着空槽第一二三四槽',
  '距下一境修为已满只待一念破境静心修炼取丹服用',
  '灵根速率在线共位在册再看一页翻页中推演中载入中',
  '药寻满天地之力',
  '零一二三四五六七八九十百千万亿',
];

const PUNCTUATION = '·×%＋+-—…、，。：；！？（）「」《》0123456789.,';

function collect() {
  const groups = [
    UI_COPY.join(''),
    PUNCTUATION,
    REALM_NAMES.join(''),
    SUB_STAGE_NAMES.join(''),
    STAGES.map((s) => s.name).join(''),
    Object.values(ELEMENT_NAMES).join(''),
    Object.values(SPIRIT_ROOT_QUALITY_NAMES).join(''),
    EXPLORE_MAPS.map((m) => m.name).join(''),
    DUNGEONS.map((d) => d.name).join(''),
    MONSTERS.map((m) => m.name).join(''),
    SKILLS.map((s) => s.name).join(''),
    TECHNIQUES.map((t) => t.name).join(''),
    NPCS.map((n) => n.name).join(''),
    // Bot 道号 are rendered in the display face in the public dossier.
    BOT_SURNAMES.join(''),
    BOT_GIVEN_NAMES.join(''),
    BOT_SUFFIXES.join(''),
  ];

  const chars = [];
  const seen = new Set();
  const dropped = [];
  for (const group of groups) {
    for (const char of group) {
      if (char === ' ' || char === '\n' || seen.has(char)) continue;
      seen.add(char);
      if (chars.length < MAX_GLYPHS) chars.push(char);
      else dropped.push(char);
    }
  }
  return { text: chars.join(''), count: chars.length, dropped };
}

async function loadFont() {
  if (existsSync(CACHE_PATH)) return readFile(CACHE_PATH);
  process.stdout.write(`下载字体 ${FONT_URL}\n`);
  const response = await fetch(FONT_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, buffer);
  return buffer;
}

async function main() {
  const { text, count, dropped } = collect();
  process.stdout.write(`字符集 ${count} 个（上限 ${MAX_GLYPHS}）\n`);
  if (dropped.length > 0) {
    process.stdout.write(`超出上限被舍弃 ${dropped.length} 个：${dropped.join('')}\n`);
  }

  const font = await loadFont();
  const subset = await subsetFont(font, text, { targetFormat: 'woff2' });
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, subset);

  const kb = (subset.length / 1024).toFixed(1);
  process.stdout.write(`已写出 ${path.relative(CLIENT_DIR, OUT_PATH)} — ${kb} KB\n`);
}

main().catch((error) => {
  process.stderr.write(`字体子集化失败：${error?.message ?? error}\n`);
  process.stderr.write('正文与标题将回退到系统楷体/衬线，排版不受影响。\n');
  process.exitCode = 1;
});
