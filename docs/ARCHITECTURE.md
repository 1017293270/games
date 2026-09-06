# 工程架构

> 给后续 agent 的开工文档。`packages/shared` 是**唯一契约源**——
> 服务端与客户端都不该重新定义任何在 shared 里已有的类型、公式或路径。
> 数值与系统设计见 `docs/GDD.md`；素材 ID 契约见 `docs/ASSETS.md`（只读）。

## 1. 仓库布局

```
games/
├── package.json            根，private，type:module，pnpm workspace
├── pnpm-workspace.yaml     packages: apps/* packages/* tools/* e2e
├── tsconfig.base.json      全仓共用的 compilerOptions
├── tsconfig.json           solution 文件（仅供编辑器），references → packages/shared
├── eslint.config.js        flat config，全仓唯一 lint 入口
├── .prettierrc.json        格式化配置（不进 verify）
├── docs/
│   ├── ASSETS.md           【只读】82 个位图 ID 契约
│   ├── GDD.md              数值与系统设计
│   └── ARCHITECTURE.md     本文件
├── packages/shared/        ✅ 已完成：契约源
├── apps/server/            ⬜ 待建：Fastify 5 + Socket.IO 4 + node:sqlite
├── apps/client/            ⬜ 待建：Vite 8 + React 19 + Zustand + react-router 8 + PWA
├── tools/art/              🔒 art agent 负责：Image2 素材管线
└── e2e/                    ⬜ 待建：Playwright
```

包名统一 `@xianxia/*`。根包名 `xianxia-idle`。

## 2. 工具链版本

| 工具 | 版本 | 备注 |
|---|---|---|
| Node | 24.18.1 | `node:sqlite` 的 `DatabaseSync` 已实测可用、无警告 |
| pnpm | 11.18.0 | 注意 pnpm 11 **不再读** `package.json` 的 `pnpm` 字段 |
| TypeScript | 5.9.3 | 不能升 7.x：`typescript-eslint@8` peer 上限是 `<6.1.0` |
| ESLint | 10.10.0 + typescript-eslint 8.69.0 | flat config |
| Vitest | 5.0.0 | |
| zod | 4.5.4 | |
| Prettier | 3.9.6 | |

pnpm 的设置都在 `pnpm-workspace.yaml`（`onlyBuiltDependencies`、`strictPeerDependencies`
等），**不是** `.npmrc`，也不是 `package.json` 的 `pnpm` 字段。

## 3. 根脚本

| 脚本 | 命令 | 说明 |
|---|---|---|
| `pnpm typecheck` | `pnpm -r --if-present run typecheck` | 递归；新增 app 只要自带 `typecheck` 就自动纳入 |
| `pnpm lint` | `eslint .` | **全仓唯一 lint 入口**。子包不要再定义 `lint` 脚本 |
| `pnpm test` | `pnpm -r --if-present run test` | 递归 |
| `pnpm build` | `pnpm -r --if-present run build` | 递归 |
| `pnpm verify` | `typecheck && lint && test && build` | CI/交付门禁 |
| `pnpm dev` | 见下 | 开发模式 |
| `pnpm format` / `format:check` | prettier | 不在 verify 里，避免与并行 agent 打架 |

`-r --if-present` 的意义：现在只有 `packages/shared`，等 `apps/server`、`apps/client`、
`e2e` 加进来，**不用改根脚本**，它们自带的同名脚本会自动被跑到。

lint 用根 `eslint .` 而非递归，是为了让 flat config 成为单一事实来源，
新目录自动纳入且规则一致。已配置的要点：
- 忽略 `**/dist`、`tools/art/raw`、`apps/client/public/art`、`.imagegen-logs` 等产物目录
- `apps/client/**` 与 `e2e/**` 自动获得 DOM globals，其余按 Node globals
- `no-empty` 允许空 `catch {}`（CLI 脚本里 best-effort 忽略错误是惯用法）

## 4. `packages/shared` 的引用方式（重要）

shared 必须同时被 **Node 24 服务端**（生产是 `node dist/index.js` 纯 JS）和
**Vite 浏览器端**引用，且 dev 下改动要自动生效。方案：

### 4.1 构建产物 + 条件导出

`packages/shared/package.json`：

```json
{
  "name": "@xianxia/shared",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./src/index.ts",
      "default": "./dist/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

- **Node** 不认识 `development` 条件 → 永远走 `dist/index.js`（纯 ESM JS）。
- **Vite dev** 若开启 `development` 条件 → 直接吃 `src/index.ts`，改动零延迟热更。
- **Vite build** → 走 `dist/index.js`。

TS 配置用 `module/moduleResolution: NodeNext`，所以 **shared 内部所有相对 import 都必须带
`.js` 后缀**（即使源文件是 `.ts`）。这是让 `node dist/index.js` 能直接跑的前提。
Vite 与 Vitest 都能正确把 `./foo.js` 解析到 `foo.ts`。

`verbatimModuleSyntax: true` 已开启：只作类型用的 import 必须写 `import type`。

### 4.2 tsconfig 三件套

- `packages/shared/tsconfig.json` — 构建用。`composite: true`、`rootDir: src`、
  `outDir: dist`、排除 `test/`。`pnpm build` 跑 `tsc -b tsconfig.json`。
- `packages/shared/tsconfig.typecheck.json` — 检查用。`composite:false` + `noEmit:true`，
  `include` 覆盖 `src/`、`test/`、`vitest.config.ts`。`pnpm typecheck` 跑这个，
  所以**测试文件也被类型检查**。
- 根 `tsconfig.json` — 只是 solution 文件（`files: []` + `references`），给编辑器用，
  脚本不直接跑它。

### 4.3 后续 apps 该怎么配

**`apps/server/package.json`**：

```json
{
  "name": "@xianxia/server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -b tsconfig.json",
    "typecheck": "tsc -p tsconfig.typecheck.json",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@xianxia/shared": "workspace:*",
    "fastify": "5.12.3",
    "@fastify/static": "10.1.3",
    "@fastify/cors": "11.3.0",
    "socket.io": "4.8.3",
    "zod": "4.5.4"
  }
}
```

`workspace:*` 是必须的——pnpm 10+ 起 `link-workspace-packages` 默认关闭，
不写这个协议就会去 registry 找。

服务端 dev 期间 Node 会解析到 `dist`，所以根 `dev` 脚本要同时跑 shared 的 watch 构建：

```jsonc
// 根 package.json，等 apps 建好后改成：
"dev": "pnpm --filter @xianxia/shared run dev & pnpm --filter @xianxia/server run dev & pnpm --filter @xianxia/client run dev"
// 更稳妥的做法是引入 concurrently 或 turbo；上面的 & 写法在 zsh/bash 下够用
```

`@xianxia/shared` 已经提供 `pnpm dev` = `tsc -b --watch --preserveWatchOutput`。

**`apps/client/vite.config.ts`**：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react(), /* VitePWA(...) */],
  resolve: {
    // dev 下直接吃 shared 的 TS 源码，改动即时生效；build 走 dist
    conditions: command === 'serve' ? ['development', 'browser', 'module', 'import'] : undefined,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
}));
```

若 `development` 条件遇到问题，去掉 `resolve.conditions` 即可——
那时客户端走 `dist`，配合根 `dev` 里的 `tsc -b --watch` 依然能热更，只是多一跳编译延迟。

**apps 的 tsconfig** 建议：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    // 客户端还要： "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx"
  },
  "references": [{ "path": "../../packages/shared" }],
  "include": ["src/**/*.ts"]
}
```

加了 `references` 后，记得把该 app 也加进根 `tsconfig.json` 的 `references`。

## 5. `packages/shared` 导出清单

一个入口 `@xianxia/shared`，共 **465 个具名导出**。按模块：

### `core/`
- `art.ts` — `ART_IDS`(98) 及分组常量 `ART_BACKGROUNDS` `ART_NPCS` `ART_AVATARS`
  `ART_MONSTERS` `ART_BOSSES` `ART_ITEMS` `ART_UI` `ART_ZONES` `ART_SPRITES`；类型 `ArtId` 等；
  `isArtId()`；`ArtManifest` / `ArtManifestEntry`（`tools/art` 产出的 manifest 形状）
- `rng.ts` — `createRng(seed): Rng`（mulberry32，确定性）、`hashSeed`、`combineSeeds`
- `util.ts` — `clamp` `round` `sum` `indexById` `formatDuration` `dayKey` `hourOfDay`
  `inHourWindow`

### `domain/` — 全部实体的 zod schema + `z.infer` 类型
`stats`（`Stats` `SpiritRoot` `Element` 及品质倍率表）· `item`（`Item` 判别联合：
`PillItem`/`MaterialItem`/`EquipmentItem`，`EquipSlot` `ItemGrade` `InventoryItem`）·
`skill`（`Skill` `SkillType` `SKILL_SLOT_COUNT`）· `technique` · `monster`（`Monster` `LootEntry`）·
`zone`（`Zone` `ZoneSpawn` `ZoneArea` `ZonePoint` `ZONE_TILE_PX`——战斗大地图几何） ·
`script`（`Condition` `Effect` `Reward`——对话/任务/奇遇共用）· `quest`（`Quest`
`QuestObjective` `QuestProgress` `StoryChapter`）· `npc`（`Npc` `DialogueTree`
`DialogueNode` `DialogueChoice`）· `map`（`ExploreMap` `Encounter` `Dungeon`）· `shop` ·
`bot`（`BotParams` `BotArchetype` `BotAction`）· `world`（`WorldSettings`
`DEFAULT_WORLD_SETTINGS` `WorldSettingsPatchSchema` `applyWorldSettingsPatch`
`hydrateWorldSettings`）· `character`（**`CharacterState`** `PublicProfile`
`CharacterView` `CultivationBuff` `DailyCounters` `EquipmentSlots`）

### `cultivation/`
- `realms.ts` — `STAGES`(36) `REALM_NAMES` `SUB_STAGE_NAMES` `STAGE_COUNT`
  `MAX_STAGE_INDEX` `getStage` `stageName` `expRequired` `baseRatePerSec`
  `stageDurationSec` `isPerfection` `requiresTribulation` `realmDurationSec` …
- `spiritRoot.ts` — `rollSpiritRoot(rng)` `spiritRootMultiplier` `spiritRootName`
- `attributes.ts` — `baseStatsForStage` **`computeStats`** **`powerScore`**
- `settle.ts` — **`settleCultivation`** `cultivationRatePerSec` `secondsToNextStage`
  `activePillBonus` `pruneBuffs`
- `breakthrough.ts` — **`breakthroughChance`** **`attemptBreakthrough`**
  `checkBreakthroughReadiness` `BREAKTHROUGH_BASE_CHANCE` `BREAKTHROUGH_STAGE_INDEXES`

### `combat/`
- `types.ts` — `Combatant` `BattleInput` `BattleResult` `BattleEvent`（判别联合）及其
  zod schema；常量 `DEFAULT_MAX_ROUNDS`(30) `COMBAT_MANA_MAX`(100)
  `COMBAT_MANA_REGEN`(15) `CRIT_MULTIPLIER`(1.5)
- `damage.ts` — **`rollDamage(attacker, defender, power, rng)`** `effectiveStat()`；
  回合制引擎与战斗大地图共用同一套伤害公式与**同一 rng 抽取顺序**
  （`chance(命中) → chance(暴击) → range(浮动)`，未命中只抽一次）
- `engine.ts` — **`simulateBattle(input, options?)`**

### `zone/` — 战斗大地图模拟核心（纯函数，服务端与客户端 mock 共用）
- `sim.ts` — `createZoneSim(zone, rules, seed, now)` `addCultivator` `removeEntity`
  `setOnline` `setRules` `refreshCultivator` **`stepZone(sim, now)`**
  **`buildFrame(sim, full)`**；类型 `ZoneSim` `ZoneEntity` `ZoneRules` `ZoneStepOutput`
- 不读 `Date.now`/`Math.random`：时间靠参数传入，随机数来自 seed，实体按槽位顺序迭代，
  **同 seed 同轨迹**。奖励不在这里算——一步只吐出「谁死了、伤害怎么分」，
  换算成修为/灵石/掉落是 service 的事（只有它能读写角色行）。

### `content/` — 全部游戏数据（已用 schema 校验过）
`ITEMS`(30) `SKILLS`(15) `TECHNIQUES`(6) `MONSTERS`(12，含 4 BOSS)
`EXPLORE_MAPS`(4) `ZONES`(4) `ENCOUNTERS`(8) `DUNGEONS`(4) `NPCS`(8) `DIALOGUES`(8)
`QUESTS`(12) `STORY_CHAPTERS`(3) `SHOPS`(3) `BOT_ARCHETYPES`(6)
——每个都配 `*_BY_ID` 的 `ReadonlyMap` 查表。
另有 `tribulationAvatar()`、`starterSkillIds()`、`generateBotName()` `generateBotNames()`
`decideBotAction()` `botCultivationMultiplier()`、`buyPriceAt()` `sellPriceAt()`、
以及 **`validateContent()`**（返回全部悬空引用，测试断言为空）。
战斗大地图另有 `MONSTER_SPRITE`（妖兽 id → `sprite/*`）、`zoneFor(stageIndex, rng?)`
与一组 `ZONE_*` 调参常量（出手间隔、索敌半径、射程、移速、脱战距离、AoE 上限、
PvP 保护期与境界窗口、机器人驻留时长）。

### `protocol/`
- `common.ts` — `API_PREFIX`(`/api`) `API_ERROR_CODES`(73) `API_ERROR_STATUS`
  `apiResponse()` `paginated()` `ok()` `fail()` `buildPath()` `Endpoint` `endpoint()`
  `RequestOf` `ResponseOf`
- 各域 schema：`auth` `character` `inventory` `explore` `social` `npc` `admin`
- `zone.ts` — 战斗大地图帧：`ZoneFrame` `ZoneRosterEntry` `ZoneEntityTuple` `ZONE_FLAGS`
  `ZoneEvent` `ZoneJoined` `ZoneLeft` `ZoneLoot` `ZoneDeath` `ZoneError` `ZonePose`
- `events.ts` — `ClientToServerEvents` / `ServerToClientEvents` / `InterServerEvents`
  / `SocketData`、`CLIENT_EVENT_SCHEMAS`、`ROOMS`、`HandshakeAuthSchema`
- `routes.ts` — **`API`** 总表 + `allEndpoints()`

## 6. REST 契约

统一响应包：

```ts
{ ok: true, data: T } | { ok: false, error: { code, message, details? } }
```

`Endpoint.response` 声明的是**未包装的** `data` 载荷；用 `apiResponse(schema)` 套壳。
服务端用 `ok()` / `fail()` 构造，`API_ERROR_STATUS[code]` 给出 HTTP 状态码。

共 **66 个端点**。服务端应遍历 `allEndpoints()` 注册路由，客户端从同一张表生成
fetch 封装——路径或载荷改了会在两边同时变成编译错误，而不是运行时 404。

| Method | Path | Auth | 常量 |
|---|---|---|---|
| POST | `/api/auth/register` | none | `API.auth.register` |
| POST | `/api/auth/login` | none | `API.auth.login` |
| POST | `/api/auth/logout` | user | `API.auth.logout` |
| GET | `/api/auth/me` | user | `API.auth.me` |
| POST | `/api/character` | user | `API.character.create` |
| GET | `/api/character` | user | `API.character.get` |
| POST | `/api/character/settle` | user | `API.character.settle` |
| POST | `/api/character/breakthrough` | user | `API.character.breakthrough` |
| PUT | `/api/character/skills` | user | `API.character.equipSkills` |
| POST | `/api/character/skills/learn` | user | `API.character.learnSkill` |
| PUT | `/api/character/technique` | user | `API.character.setTechnique` |
| POST | `/api/character/technique/learn` | user | `API.character.learnTechnique` |
| GET | `/api/cultivators` | user | `API.character.cultivators` |
| GET | `/api/cultivators/:id` | user | `API.character.publicProfile` |
| GET | `/api/rankings` | user | `API.character.rankings` |
| GET | `/api/inventory` | user | `API.inventory.list` |
| POST | `/api/inventory/use` | user | `API.inventory.use` |
| POST | `/api/inventory/equip` | user | `API.inventory.equip` |
| POST | `/api/inventory/unequip` | user | `API.inventory.unequip` |
| GET | `/api/explore/maps` | user | `API.explore.maps` |
| POST | `/api/explore/battle` | user | `API.explore.battle` |
| POST | `/api/explore/gather` | user | `API.explore.gather` |
| POST | `/api/explore/event` | user | `API.explore.chooseEvent` |
| GET | `/api/dungeon` | user | `API.explore.dungeons` |
| POST | `/api/dungeon/start` | user | `API.explore.startDungeon` |
| GET | `/api/party` | user | `API.party.get` |
| POST | `/api/party/create` | user | `API.party.create` |
| POST | `/api/party/join` | user | `API.party.join` |
| POST | `/api/party/leave` | user | `API.party.leave` |
| POST | `/api/party/kick` | user | `API.party.kick` |
| GET | `/api/chat/history` | user | `API.social.chatHistory` |
| GET | `/api/friends` | user | `API.social.friends` |
| POST | `/api/friends/request` | user | `API.social.friendRequest` |
| POST | `/api/friends/accept` | user | `API.social.friendAccept` |
| POST | `/api/friends/remove` | user | `API.social.friendRemove` |
| GET | `/api/arena/opponents` | user | `API.arena.opponents` |
| POST | `/api/arena/challenge` | user | `API.arena.challenge` |
| GET | `/api/arena/records` | user | `API.arena.records` |
| GET | `/api/raid/targets` | user | `API.raid.targets` |
| POST | `/api/raid/attack` | user | `API.raid.attack` |
| GET | `/api/npc` | user | `API.npc.list` |
| POST | `/api/npc/dialogue` | user | `API.npc.dialogue` |
| POST | `/api/npc/talk` | user | `API.npc.talk` |
| GET | `/api/quests` | user | `API.quests.list` |
| POST | `/api/quests/accept` | user | `API.quests.accept` |
| POST | `/api/quests/complete` | user | `API.quests.complete` |
| GET | `/api/shop/:shopId` | user | `API.shop.list` |
| POST | `/api/shop/buy` | user | `API.shop.buy` |
| POST | `/api/shop/sell` | user | `API.shop.sell` |
| POST | `/api/admin/login` | none | `API.admin.login` |
| GET/PUT | `/api/admin/settings` | admin | `API.admin.getSettings` / `putSettings` |
| GET | `/api/admin/bots` | admin | `API.admin.listBots` |
| POST | `/api/admin/bots/generate` | admin | `API.admin.generateBots` |
| PUT/DELETE | `/api/admin/bots` | admin | `API.admin.updateBot` / `deleteBot` |
| GET/PUT | `/api/admin/bot-archetypes` | admin | `API.admin.listBotArchetypes` / `updateBotArchetype` |
| GET | `/api/admin/players` | admin | `API.admin.listPlayers` |
| POST | `/api/admin/players/grant` | admin | `API.admin.grant` |
| POST | `/api/admin/players/reset-password` | admin | `API.admin.resetPassword` |
| POST | `/api/admin/players/ban` | admin | `API.admin.ban` |
| GET/POST/DELETE | `/api/admin/invites` | admin | `API.admin.listInvites` / `createInvites` / `deleteInvite` |
| GET | `/api/admin/stats` | admin | `API.admin.stats` |

只有 `auth/register`、`auth/login`、`admin/login` 是 `auth: 'none'`（测试断言）。

## 7. Socket.IO 契约

握手 `{ auth: { token } }`，token 就是 `POST /api/auth/login` 返回的那个。

```ts
// 服务端
import type { ClientToServerEvents, ServerToClientEvents,
              InterServerEvents, SocketData } from '@xianxia/shared';
const io = new Server<ClientToServerEvents, ServerToClientEvents,
                      InterServerEvents, SocketData>(httpServer);

// 客户端（注意泛型顺序相反：Socket<Listen, Emit>）
import { io } from 'socket.io-client';
const socket: Socket<ServerToClientEvents, ClientToServerEvents> =
  io(url, { auth: { token } });
```

| 方向 | 事件 | 载荷 |
|---|---|---|
| c→s | `chat:send` | `{ channel: 'world' \| 'party', text }` |
| c→s | `presence:ping` | — |
| s→c | `chat:message` | `ChatMessage` |
| s→c | `presence:update` | `{ characterId, name, online, onlineCount }` |
| s→c | `character:update` | `CharacterUpdate`（增量，必带 `id`） |
| s→c | `party:update` | `{ party \| null, reason, actorName }` |
| s→c | `dungeon:start` | `DungeonStartEvent` |
| s→c | `dungeon:result` | `{ replay: BattleResult[], reward, ... }` |
| s→c | `arena:challenged` | `ArenaChallengedEvent`（被人挑战了） |
| s→c | `raid:update` | `{ botId, hpPercent, lastDamage, defeated, ... }` |
| s→c | `system:notice` | `{ kind, text, characterId, at }`（机器人突破播报等） |
| s→c | `friend:request` | `FriendRequestEvent` |
| c→s | `zone:enter` | `{ zoneId: string \| null }`（null = 重连恢复原图） |
| c→s | `zone:leave` | —（只停推帧，角色留在图里继续打） |
| c→s | `zone:retreat` | —（真正离场并结算） |
| s→c | `zone:joined` | `{ zoneId, self, enteredAt, frame }`，frame 必为全量 |
| s→c | `zone:frame` | `ZoneFrame` 增量帧，`zoneSnapshotHz` 次/秒，**volatile** |
| s→c | `zone:left` | `{ reason: 'retreat' \| 'offline_cap' \| 'none' \| 'removed' }` |
| s→c | `zone:loot` | `{ exp, spiritStones, items, kills, bossKills, since }` |
| s→c | `zone:death` | `{ killerName, stonesLost, respawnAt }` |
| s→c | `zone:error` | `{ code: MAP_LOCKED \| NOT_FOUND \| RATE_LIMITED \| ZONE_FULL, message }` |

**服务端必须用 `CLIENT_EVENT_SCHEMAS[name].parse()` 校验每个入站事件**——
socket 载荷和 HTTP body 一样不可信。房间名用 `ROOMS.world()` / `ROOMS.party(id)` /
`ROOMS.character(id)` / `ROOMS.zone(id)` 派生，两边保证一致。

### 7.1 战斗大地图帧格式

一张图每秒要向至多 `Zone.capacity` 个观众推 `zoneSnapshotHz` 次，所以实体走**定长
元组**而不是对象：`[i, x*10, y*10, hp, flags, targetI, skillSlot]`。名字、头像、境界
只在 `add` 里发一次，客户端按槽位缓存；`i` 是槽位不是身份，出现在 `remove` 里就必须
连同缓存一起丢掉（槽位会被后来者复用）。坐标是**格的十分之一**（`ZONE_TILE_PX` = 12px
@zoom1），全字段整数。`flags` 里 `HIT/CRIT/DODGED/CASTING` 是**一次性脉冲**——发出即清，
客户端拿它触发一次动效，不要当持续状态；`DEAD/PROTECTED/OFFLINE/MOVING` 才是常驻。

## 8. 服务端实现约定

- **懒结算**：任何读到角色的请求，先 `settleCultivation(char, Date.now(), world)` 再回包。
  不要写定时器去推进修为。
- **战斗只在服务端跑**：客户端拿到 `BattleResult` 只做回放。seed 由服务端生成
  （建议 `combineSeeds(battleId, characterId, Date.now())`）。
- **对话与奇遇的条件/效果由服务端求值**，客户端只渲染 `available` / `blockedReason`。
- **机器人 tick**：每 `world.botTickSeconds` 秒批量处理。由于修炼是懒结算的，
  tick 只需要做「决策 + 突破 + 战斗」，不需要逐个加修为。
- **`node:sqlite`**：`import { DatabaseSync } from 'node:sqlite'`，Node 24 上无实验警告。
  `.gitignore` 已忽略 `*.db*`。
- **世界设置**：启动时 `hydrateWorldSettings(storedRow)`，PUT 时
  `applyWorldSettingsPatch(current, patch)`——别用 `{...current, ...body}` 硬合并。
- **ZoneWorld 是第二个被授权的模拟循环**（第一个是机器人 tick）。它每
  `zoneTickMs` 推进一次，**只推进战斗与位置**；修为仍然是懒结算的，不要在循环里
  给任何人加修为。
- **ZoneWorld 不持有可写的 `CharacterState` 快照**。图里的 `ZoneEntity` 只是一份
  战斗用的投影（属性、神通、血量比例）；击杀奖励先累计成增量，`flush` 时**重新读一次
  角色行**再落库。否则一次后台发放或一次突破就会被循环里的旧快照盖回去。
- **离线战果有回执**：`flush` 时在线的玩家照旧收 `zone:loot`；不在线的那份汇总进
  `zone_members.loot_json`（`ZoneLoot`，`since` 取最早窗口），随 `enter`/`resume`
  在 `zone:joined` 之后补推一条 `zone:loot`，送达即清列。协议不变，重启由
  `restoreMembers` 读回；被 `offline_cap` 扫走或撤离时随行删除——奖励本身早已入行。
- 时间一律靠参数传入：`stepZone(sim, now)` / `flush(now)` 都吃 `ctx.now()`，
  测试能把整张图按自己的节奏推着走。

## 9. 客户端实现约定

- 素材通过 `useArt(id)` 读 `apps/client/public/art/manifest.json`（形状见
  `ArtManifest` 类型）。ID 不存在或 manifest 未就绪时返回 `null`，
  组件必须显示 SVG/CSS 占位——**不许报错、不许空白**（`docs/ASSETS.md` 的硬要求）。
- 只引用 `ART_IDS` 里的 ID；`isArtId()` 可在开发期兜底断言。
- 战斗回放逐条消费 `BattleResult.log` 的判别联合，按 `type` 分支渲染。
- 修为进度条本地按 `ratePerSec` 插值，服务端 `character:update` 到达时校正；
  时间基准用 `GET /api/auth/me` 返回的 `serverTime` 修正客户端时钟漂移。

## 10. 测试

`packages/shared` 共 **231 个测试 / 9 个文件**，全部通过：

| 文件 | 覆盖 |
|---|---|
| `realms.test.ts` (19) | 36 阶结构、四段时长带、化神起 1.5–2× 倍率、属性单调性 |
| `settle.test.ts` (20) | 速率公式、离线上限与作废、小境界自动升、圆满不跨大境界、buff 中途过期分段、不可变性 |
| `breakthrough.test.ts` (20) | 概率表 80%→35%、丹药 +15pp、95% 上限、失败扣 20%、渡劫门禁、4000 次抽样收敛 |
| `combat.test.ts` (38) | 同 seed 逐字节一致、不同 seed 发散、maxRounds 终止、出手序、轮转与灵力、血池覆盖、平衡性抽样 |
| `zone-sim.test.ts` (29) | 500 步同 seed 逐字节一致、追帧等价、妖兽反击与脱战回家、死亡复活与保护期、PvP 开关与境界窗口、离线玩家不可攻击、BOSS 定时刷新与槽位回收、增量帧与脉冲清位、百人同图单步耗时 |
| `content.test.ts` (42) | `validateContent()` 无悬空引用、各表数量、对话树全节点可达、任务链无环、商店买价 > 卖价、机器人原型参数 |
| `art.test.ts` (9) | 正则从 `docs/ASSETS.md` 抽取 98 个 ID 与 `ART_IDS` 严格相等（防漂移） |
| `protocol.test.ts` (41) | 66 个端点无重复路由、schema 齐备、错误码合法、样例载荷 parse、真实 `BattleResult` JSON 往返、socket 事件表与接口同步 |
| `admin-protocol.test.ts` (13) | 后台端点与统计载荷 |

新增 app 时请自带 `test` 脚本，根 `pnpm test` 会自动跑到。

## 11. 边界与并行约定

- `docs/ASSETS.md` 是**只读契约**。要加素材必须先改它，再改 `ART_IDS`，
  两边不一致会被 `art.test.ts` 拦下。
- `tools/art/**` 与 `apps/client/public/art/**` 归 art agent，其他 agent 不要动。
- `packages/shared` 归契约维护者。server/client agent 若发现 shared 缺字段，
  **提出来改 shared**，不要在自己那边另立一套类型。
- 提交前跑 `pnpm verify`。
