// Read-only import of games data. No server, database or duplicated game formulas.
// Usage: node tools/export-content.mjs [--check]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { project, sourceDirectory } from './dev-server.mjs';

const generator = 'tools/export-content.mjs';
const tables = {
  items: 'ITEMS', skills: 'SKILLS', techniques: 'TECHNIQUES', monsters: 'MONSTERS',
  maps: 'EXPLORE_MAPS', zones: 'ZONES', dungeons: 'DUNGEONS', npcs: 'NPCS',
  dialogues: 'DIALOGUES', quests: 'QUESTS', shops: 'SHOPS', storyChapters: 'STORY_CHAPTERS',
  treasures: 'TREASURES', relics: 'RELICS', botArchetypes: 'BOT_ARCHETYPES', encounters: 'ENCOUNTERS',
  dailyQuests: 'DAILY_QUESTS', progressionAchievements: 'PROGRESSION_ACHIEVEMENTS', relicSets: 'RELIC_SETS',
};
const constants = {
  gachaRules: 'GACHA_RULES', starFragmentCosts: 'STAR_FRAGMENT_COSTS',
  dailyReward: 'DAILY_REWARD', achievementReward: 'ACHIEVEMENT_REWARD', starterReward: 'STARTER_REWARD',
  monsterSprites: 'MONSTER_SPRITE', avatars: 'ART_AVATARS',
  itemGradeNames: 'ITEM_GRADE_NAMES', progressionGradeNames: 'PROGRESSION_GRADE_NAMES',
  treasureFormNames: 'TREASURE_FORM_NAMES', equipSlotNames: 'EQUIP_SLOT_NAMES',
};
const json = value => JSON.parse(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

async function worker(source) {
  const shared = await import(pathToFileURL(join(source, 'packages/shared/src/index.ts')));
  assert.deepEqual(shared.validateContent(), [], 'Source validateContent failed');
  const catalog = {
    generatedBy: generator, schemaVersion: 1,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
    sourceVersion: readJson(join(source, 'packages/shared/package.json')).version,
  };
  for (const [key, name] of Object.entries(tables)) {
    assert(Array.isArray(shared[name]), `Missing source table ${name}`);
    catalog[key] = json(shared[name]);
  }
  for (const [key, name] of Object.entries(constants)) {
    assert(shared[name] !== undefined, `Missing source constant ${name}`);
    catalog[key] = json(shared[name]);
  }
  catalog.stages = Array.from({ length: shared.STAGE_COUNT }, (_, index) => ({
    index, name: shared.stageName(index), expRequired: shared.expRequired(index),
    baseRate: shared.baseRatePerSec(index), breakthroughChance: shared.breakthroughChance(index),
    breakthroughChances: Array.from({ length: shared.MAX_BREAKTHROUGH_PILLS + 1 }, (_, pills) => shared.breakthroughChance(index, pills)),
    requiresTribulation: shared.requiresTribulation(index),
  }));
  catalog.breakthroughRules = { maxPills: shared.MAX_BREAKTHROUGH_PILLS, pillId: shared.BREAKTHROUGH_PILL_ID,
    maxChance: shared.MAX_BREAKTHROUGH_CHANCE, pillBonus: shared.PILL_BONUS_PER_UNIT,
    failureExpLoss: shared.BREAKTHROUGH_FAILURE_EXP_LOSS };
  catalog.routes = Object.fromEntries(shared.allEndpoints().map(({ group, name, endpoint }) =>
    [`${group}.${name}`, { method: endpoint.method, path: endpoint.path, auth: endpoint.auth, summary: endpoint.summary }]));
  catalog.clientEvents = [...shared.CLIENT_TO_SERVER_EVENTS];
  catalog.serverEvents = [...shared.SERVER_TO_CLIENT_EVENTS];
  const publicDir = join(source, 'apps/client/public');
  const manifest = readJson(join(publicDir, 'art/manifest.json'));
  catalog.art = {};
  catalog.progressionArt = {};
  catalog.sceneArt = {};
  const sourceFiles = new Map();
  function addArt(key, src) {
    assert(src.startsWith('/art/'), `Unexpected art URL: ${src}`);
    const input = resolve(publicDir, '.' + src);
    assert(relative(publicDir, input).startsWith('art/'), `Art path escapes public: ${src}`);
    assert(existsSync(input), `Missing art ${key}: ${src}`);
    // Flat names preserve the readable Unity Resources lookup; collision is fatal.
    const name = src.slice('/art/'.length).replace(/\.[^.]+$/, '').replaceAll('/', '-');
    assert(/^[A-Za-z0-9_-]+$/.test(name), `Unsafe art output: ${name}`);
    const resource = `Art/Shared/${name}`;
    const previous = sourceFiles.get(resource);
    assert(!previous || previous.src === src, `Art filename collision: ${src}`);
    sourceFiles.set(resource, { src, input, sourceSha256: hash(readFileSync(input)) });
    return resource;
  }
  for (const [id, entry] of Object.entries(manifest.assets)) catalog.art[id] = addArt(id, entry.src);
  const missingArt = shared.ART_IDS.filter(id => !catalog.art[id]);
  assert.deepEqual(missingArt, [], `Manifest missing declared art IDs: ${missingArt.join(', ')}`);
  const { progressionArtSource } = await import(pathToFileURL(join(source, 'apps/client/src/features/progression/art.ts')));
  for (const definition of [...shared.TREASURES, ...shared.RELICS]) {
    const src = progressionArtSource(definition);
    catalog.progressionArt[definition.id] = src ? addArt(definition.id, src) : catalog.art[definition.art];
  }
  // These backgrounds are the two explicit source UI references outside the manifest.
  for (const name of ['cultivation-vivid-v1', 'gacha-hall-v1'])
    catalog.sceneArt[name] = addArt(name, `/art/progression/${name}.webp`);
  catalog.artSources = Object.fromEntries([...sourceFiles].map(([resource, entry]) =>
    [resource, { src: entry.src, sourceSha256: entry.sourceSha256 }]));
  const resources = join(project, 'Assets/Resources');
  const output = join(resources, 'Content/catalog.json');
  const previous = existsSync(output) ? readJson(output) : null;
  if (previous) assert.equal(previous.generatedBy, generator, 'Refusing to overwrite a catalog not owned by this exporter');
  const check = () => {
    const actual = readJson(output);
    const { assetSha256, sourceCommit, ...data } = actual;
    const { sourceCommit: checkedCommit, ...expected } = catalog;
    assert.match(sourceCommit, /^[0-9a-f]{40}$/);
    execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, checkedCommit], { cwd: source, stdio: 'pipe' });
    // Packaging/docs commits do not change game content; still compare every table, route and asset.
    assert.deepEqual(data, expected, 'Export is stale or differs from validated source tables/routes/art');
    assert.equal(Object.keys(actual.routes).length, shared.allEndpoints().length);
    for (const [key, exportName] of Object.entries(tables))
      assert.equal(actual[key].length, shared[exportName].length, `${key} count differs`);
    assert.equal(actual.stages.length, shared.STAGE_COUNT);
    assert.deepEqual(Object.keys(assetSha256).sort(), [...sourceFiles.keys()].sort());
    for (const resource of sourceFiles.keys()) {
      const bytes = readFileSync(join(resources, resource + '.png'));
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG ${resource}`);
      assert.equal(hash(bytes), assetSha256[resource], `Asset changed: ${resource}`);
    }
    console.log(JSON.stringify({ status: 'checked', sourceCommit, verifiedAgainst: checkedCommit,
      tables: Object.fromEntries(Object.keys(tables).map(k => [k, catalog[k].length])),
      stages: actual.stages.length, routes: Object.keys(actual.routes).length,
      artMappings: Object.keys(actual.art).length, pngFiles: sourceFiles.size,
      sourceValidationIssues: 0, missingArt: [] }, null, 2));
  };
  if (process.argv.includes('--check')) { check(); return; }
  // Only overwrite unchanged images recorded by a previous successful export.
  for (const resource of sourceFiles.keys()) {
    const target = join(resources, resource + '.png');
    if (existsSync(target)) assert.equal(hash(readFileSync(target)), previous?.assetSha256?.[resource],
      `Refusing to overwrite unowned or edited asset: ${target}`);
  }
  const artDir = join(resources, 'Art/Shared');
  mkdirSync(artDir, { recursive: true });
  mkdirSync(join(resources, 'Content'), { recursive: true });
  const staging = mkdtempSync(join(artDir, '.export-'));
  const assetSha256 = {};
  try {
    const converted = [];
    for (const [resource, entry] of sourceFiles) {
      const target = join(resources, resource + '.png');
      if (existsSync(target) && previous?.artSources?.[resource]?.sourceSha256 === entry.sourceSha256) {
        assetSha256[resource] = previous.assetSha256[resource];
        continue;
      }
      const staged = join(staging, resource.split('/').at(-1) + '.png');
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', entry.input, '--out', staged], { stdio: 'pipe' });
      assetSha256[resource] = hash(readFileSync(staged));
      converted.push([staged, target]);
    }
    for (const [staged, target] of converted) renameSync(staged, target);
    const stagedCatalog = join(staging, 'catalog.json');
    writeFileSync(stagedCatalog, JSON.stringify({ ...catalog, assetSha256 }, null, 2) + '\n');
    renameSync(stagedCatalog, output);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  check();
}

async function main() {
  const source = sourceDirectory();
  if (!process.argv.includes('--worker')) {
    const require = createRequire(join(source, 'apps/server/package.json'));
    const child = spawnSync(process.execPath, ['--conditions=development', '--import', require.resolve('tsx/esm'),
      fileURLToPath(import.meta.url), '--worker', ...process.argv.slice(2)], { stdio: 'inherit' });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
    return;
  }
  await worker(source);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
