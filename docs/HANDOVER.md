# 交接说明（HANDOVER）

> 给接手的人或 AI agent 看的。最后更新：2026-09-07，main @ M4a 收尾（fix-6 之后）。

## 1. 现在到哪了

- **M1–M3 + W5**：单机核心、机器人、组队/秘境/论道/围攻/好友、NPC 任务商店、道录司后台、Docker/Caddy 部署包、PWA。已在用户 VPS 试玩过一轮。
- **M4a 战斗大地图（已完成，待用户 VPS 试玩反馈）**：服务端持续模拟的 2D 战场（`packages/shared/src/zone/sim.ts` 纯函数核心 + `apps/server/src/engine/zone/**`），玩家与机器人同图自动刷怪，离线留场，Socket.IO 按图分房间推 4Hz 增量帧（已开 perMessageDeflate，线上约 2 KB/s），客户端 PixiJS 渲染（`apps/client/src/features/zone/**`，无 WebGL 时退 DOM 名册），后台「世界 › 战斗大地图」三组旋钮与概览「山河」读数，新画风（深底描金浓彩水墨，`tools/art/assets.mjs` 的 `STYLE_VIVID`）出了 4 张俯视底图 + 12 只妖兽 chibi。
- **M4b 法宝 · 古宝 · 抽卡** 与 **M4c 画风重出 · 灵兽 · 新地图**：未开工，设计见本文第 5 节。

## 2. 怎么跑、怎么验

```bash
pnpm install
pnpm verify            # typecheck + lint + test + build，必须全绿再提交
pnpm dev               # server :3000 + client :5173
pnpm e2e               # Playwright 冒烟（需要一个已起的服务器，E2E_BASE_URL / E2E_ADMIN_PASSWORD）
docker compose -f deploy/docker-compose.yml up -d --build   # 生产镜像；见 docs/DEPLOY.md
```

- 本地起服务器要**先** `pnpm --filter @xianxia/client build`（fastify-static 启动时枚举 dist）；服务端吃 `packages/shared` 的 dist，改了 shared 要 `pnpm --filter @xianxia/shared build`，或用 `npx tsx --conditions=development src/index.ts` 直接吃 src。
- 开发凭据在 `apps/server/.env`（gitignored）：`ADMIN_USERNAME=admin`、`ADMIN_PASSWORD`、`INVITE_CODE`；生产在 `deploy/.env`，**部署前必须换掉默认值**。
- 素材：`docs/ASSETS.md` 是 98 个素材 ID 的契约，`tools/art/README.md` 是出图流程（Codex Image2 → sharp → WebP → manifest），`node tools/art/check.mjs` 必须 98/98。

## 3. 文档地图

| 文件 | 内容 |
|---|---|
| `docs/ARCHITECTURE.md` | 分层、契约单一来源、懒结算、两个模拟循环（机器人息、ZoneWorld） |
| `docs/GDD.md` | 数值与玩法设计；§5.6 地图上的一次出手、§8.1 战斗大地图 |
| `docs/ADMIN.md` | 后台 27 项世界参数、生效时机、调参配方 |
| `docs/DEPLOY.md` | VPS 部署、更新、备份、FAQ |
| `docs/ASSETS.md` | 素材 ID 契约 |
| `git log` | 每个 commit 的信息写了动机与取舍，读 log 比读 diff 快 |

## 4. 待办与待拍板（按优先级）

1. **机器人作息时区**：`activeHours` 按 UTC 小时判定，散修/隐士在 22–06 UTC 睡觉（= 北京 06–14 时），中国玩家白天新手图机器人只剩个位数。建议加世界设置 `botClockOffsetHours`（默认 +8，后台可调），或直接放宽散修作息。
2. 机器人论道挑战新号过频（观察到 3.5 分钟 20 场）：给挑战加冷却或按境界差过滤。
3. 土灵根起手神通是自增益（`content/skills.ts`），单挑入口狼比其它灵根慢一档。
4. 青云狼 chibi 压在深色松冠上对比度低：渲染层给 sprite 加描边或底光（`features/zone/renderer/sprites.ts`）。
5. 留场归来弹层的已知局限：PWA 挂后台不刷新页面时同一会话不再弹（战果仍进探索页 HUD）。
6. `tools/art/process.mjs` 的 `PAPER` 仍是宣纸色，旧 82 张重出（M4c）时一起换深色。
7. 根目录散落的 `Codex 图像 …gif` 是出图工具遗留，未提交，确认后删除。

## 5. 工作约定（沿用即可）

- `packages/shared` 是唯一契约源：协议（zod）、数据表、公式、战斗引擎与地图模拟都在这里；改协议先改 shared，两端由类型驱动。
- `CharacterState` 是 `characters.state_json` 里的记录之本，加字段不用迁移；所有写者都是整行读-改-写，**任何后台循环都不许持有可写快照**（ZoneWorld 只累计增量、flush 时重读新行）。
- 迁移文件 `apps/server/src/db/migrations/NNN_*.sql` 按文件名顺序执行，已到 006。
- 机器人参数必须后台热生效（`SettingsStore.onChange`）。
- 提交前 `pnpm verify` 全绿；一个逻辑单元一个 commit，信息写动机与取舍；不提交 `.env`、截图目录、散落文件。
- 若沿用「架构师 + 子 agent」方式：主会话只规划/派遣/验收，派遣令六段（背景与目标 / 已知事实 / 边界 / 纪律 / 验证 / 汇报格式），并行任务文件域必须互不相交，子 agent 不 commit、不 git add、不 stash。

## 6. M4 设计（从总体规划复制，M4b/M4c 按此派遣）

### M4 改版规划（2026-09-06，M3 试玩反馈后）

## Context

用户试玩 M3 后的原话：

> 一念逍遥的战斗是那种类似于球球大作战的，而且战斗是有地图的，而且战斗逻辑很奇怪，不应该是点一次就怎么样，应该是设计个战斗大地图，里面有无数野怪，然后 npc 和玩家都在里面刷怪，然后法宝和装备系统你可能都需要深度参考一念逍遥，现在完成度非常低
>
> 你看他的画风实际上是那种鲜艳的水墨风然后我需要法宝，古宝系统，都有分级，并且有抽卡系统

三件事：① 核心循环从「点一下打一场看回放」换成**服务端持续模拟的战斗大地图**（玩家与机器人同图自动刷怪）；② **法宝 / 古宝分品阶养成 + 抽卡**；③ 画风从宣纸淡墨换成官网那种**深底描金、色彩饱满**的水墨（附图：黑底金粒子、青金/朱砂/金三色高饱和、人物工笔+泼墨）。

### 已拍板决策（2026-09-06）

| 决策 | 结论 |
|---|---|
| 地图 PvP | 后台开关 `mapPvp`，默认只打怪；开了之后同图可互相攻击、机器人按好战度打人、被杀掉 5% 灵石并获 60s 保护 |
| 画风范围 | UI 配色全改 + 新素材按新画风出；旧 92 张按优先级分批重出（背景与主角立绘先，头像道具后） |
| 抽卡货币 | 仙玉：日常任务 / 成就 / 挂机与 BOSS 掉落产出，后台可发；三池（法宝 / 古宝 / 灵兽），十连、保底、概率公示，无真实付费 |
| 里程碑 | 三段试玩：**M4a 地图战斗 → M4b 法宝古宝抽卡 → M4c 画风与灵兽** |

### 原作参照（已查证的要点，作为设计对标而非照抄）

- 挂机是「真实挂机」：离线时服务器也模拟产出；秘境按境界分图，同屏能看到其他修士；灵兽蛋在秘境挂机随机掉。
- 本命法宝：不被攻击、不普攻，技能条满释放；升级耗七星石，每 10 层突破耗天罡木，进阶耗玉衡；附灵优先本职攻击；法宝形制（铃/塔/链/印/幡/盾等）决定攻击频率与目标（铃高频单体、塔中频群攻、链低频单体带增益、印低频重击）；词缀里「久战」只对幡/链有效。
- 古宝：品质 蓝/紫/橙(金)/红，给固定属性（破防/格挡/暴击等）；注灵 10 级耗星尘（蓝 30/100 → 紫 30/100 → 金 30/100/200 → 红 100/125/150），升星耗同色碎片，5 星觉醒；重复获得转碎片。
- 灵兽：灵兽蛋鉴定出兽（低概率）或精魄兑换（10 个）；出战最多 3 只，秘境挂机默认 1 只；资质 = 气血/攻击/防御三项之和。
- 神通：多槽位、有释放顺序；功法用功法点购买。

## 总体架构调整

```
现有：REST（CRUD）+ Socket.IO（事件推送）+ 回合制确定性战斗（论道/秘境副本/天劫保留）
新增：ZoneWorld —— 每张地图一个服务端持续模拟器（250ms/步），Socket.IO 按地图分房间推送增量快照，
      客户端 PixiJS 8 渲染 + 插值；离线角色留场挂机；机器人由 bot 引擎决定进出图，进图后同一套 AI。
      法宝/古宝/灵兽是三张新表（实例有等级/星级/词条），抽卡有独立流水表与保底计数。
```

- 回合制引擎不删：论道、秘境副本、天劫、围攻仍用它；地图战斗用从它抽出的**同一套伤害公式**（`combat/damage.ts` 纯函数），保证同一角色两种战斗数值一致。
- `CharacterState` 继续免迁移扩字段（当前地图、仙玉、抽卡保底、日常任务进度）；法宝/古宝/灵兽实例与抽卡流水走 `005_treasures.sql` 新表。
- 素材 ID 契约（`docs/ASSETS.md` → `core/art.ts` → `tools/art/assets.mjs`）三处同步扩容，82 的硬断言改为按分类计数。

---

## M4a 战斗大地图（第一段试玩）

### 玩法定义

- 地图（zone）按境界解锁，先复用现有 4 张（`zone.id === ExploreMap.id`，名字与解锁阶从 map 取，`ExploreMapSchema` 不动）：青云山（练气）、洛水城（筑基）、幽冥谷（金丹）、昆仑墟（元婴）。每图约 60×90 格（1 格 = 12px），俯视水墨底图，入口在下方。
- 图里四种实体：**玩家**、**机器人**（都是圆形头像球 + 境界色环 + 道号 + 血条）、**妖兽**（按刷新点持续重生，chibi 剪影精灵）、**BOSS**（定时刷新，一图一只，前 5 名伤害者各掷一次掉落）。
- 修士 AI 全自动：寻找最近妖兽 → 移动 → 到射程后按出手时钟出手，每次出手 = 回合制里的「一回合」（+15 灵力、4 槽轮转、冷却按出手次数递减），**零调参复用现有技能平衡**；死亡 10s 后入口复活满血并获 60s 免修士攻击。玩家只做三件事：选图、撤离、看战果。
- 收益：击杀妖兽得修为、灵石与掉落（沿用 `rewards.ts` 的奖励与掉落表），**乘 `zoneRewardScale`（默认 0.3）**，离线属主再乘 `zoneOfflineYield`（默认 0.5），BOSS 不打折。理由：自动战斗每 10–15s 一杀，不打折会是挂机修炼的 6–9 倍，击穿 GDD「活跃≈3×」的设计。修炼懒结算照旧、与位置无关。
- 离线：角色留场继续刷，`lastSeenAt + offlineCapHours` 到期自动离场；**离线玩家不可被任何修士攻击**，妖兽杀死离线玩家无损失。回来在「闭关归来」里看到击杀与掉落。
- 机器人与玩家同图：bot tick 的 `explore` 分支进图、`cultivate` 且驻留 ≥10 分钟离图、非活跃时段必离；同样刷怪、同样得修为。`mapPvp` 打开后按 `aggression` 攻击境界 ±4 阶、在线、非保护期的玩家；玩家只反击（主动 PvP 姿态留 M4b）。
- 采药与循迹保留原 REST 入口（HUD 上两个按钮）；奇遇改为击杀触发留 M4b。

### 契约（`packages/shared`，T0 一次定稿，后续并行 agent 不再改签名）

- `domain/zone.ts`：`ZoneSchema { id, floorArt, width, height, entrance, spawns:[{ monsterId, count(≤40), respawnSec, area:{x,y,w,h} }], boss:{ monsterId, area }, capacity }`；bot 只进到 `capacity-20`，玩家到 `capacity`。
- `protocol/zone.ts`：roster 条目（`i` 槽位、`id`、`kind`、`name`、`art`、`stageIndex`、`maxHp`，**只在入房关键帧与 add/remove 时发一次**）；实体紧凑元组 `[i, x*10, y*10, hp, flags, targetI, skillSlot]`；`ZONE_FLAGS`（HIT/CRIT/DODGED/CASTING/DEAD/PROTECTED/OFFLINE/MOVING）；`ZoneFrame { zoneId, seq, at, full, add[], remove[], ents[], events[], boss }`；事件只有 `kill / death / boss_spawn / boss_slain / pvp_kill`（**不发逐次伤害**，客户端用两帧血量差合成飘字）。
- `events.ts`：C2S `zone:enter {zoneId|null}`（null = 重连恢复）、`zone:leave`（只退房间）、`zone:retreat`（离场）；S2C `zone:joined / zone:frame / zone:left / zone:loot / zone:death / zone:error`；`ROOMS.zone(id)`；`protocol.test.ts:382-412` 的 C2S/S2C 计数改 5/16。
- `zone/sim.ts`（**纯函数模拟核心，服务端与客户端 mock 共用**）：`createZoneSim / addCultivator / removeEntity / setOnline / stepZone(sim, now, rules) / buildFrame(sim, full)`；状态是普通对象，rng 来自 `createRng(combineSeeds('zone', zoneId, bootSeed))`，实体按数组顺序迭代，禁用 `Date.now/Math.random/randomUUID`（实体 id 用槽位计数）；奖励掷骰留在服务端包装层，sim 只吐 `kill` 事件（含 BOSS 伤害份额）。不做空间网格（≤120 实体 O(n²) 可忽略）。
- `combat/damage.ts`：从 `combat/engine.ts:79-89,148-171` 抽出 `effectiveStat / rollDamage`，**rng 调用顺序 `chance(hit) → chance(crit) → range(variance)` 不变**，`combat.test.ts` 零改动通过。
- `content/zones.ts`：4 张 zone + 常量（`ZONE_ACTION_MS 1200`、`ZONE_SEEK_RADIUS 14`、`ZONE_ATTACK_RANGE 1.6`、`ZONE_CASTER_RANGE 4`、`ZONE_MOVE_UNITS_PER_SEC 4`、`ZONE_LEASH 10`、`ZONE_AOE_RADIUS 2.5`、`ZONE_AOE_MAX 4`、`ZONE_PVP_PROTECT_MS 60000`、`ZONE_PVP_STAGE_WINDOW 4`、`ZONE_BOSS_LOOT_SHARE_TOP 5`）、`MONSTER_SPRITE` 12 条、`zoneFor(stageIndex)`（最高解锁图，20% 掷到下一档）；`content/registry.ts` 加交叉校验。
- `domain/world.ts` 新增 10 项（默认值只在 `DEFAULT_WORLD_SETTINGS`）：`zoneTickMs 250`、`zoneSnapshotHz 4`、`monsterDensity 1`、`respawnMultiplier 1`、`bossIntervalMinutes 30`、`mapPvp false`、`mapPvpStoneLoss 0.05`、`mapDeathRespawnSec 10`、`zoneRewardScale 0.3`、`zoneOfflineYield 0.5`。
- `protocol/admin.ts`：`AdminStatsSchema` 加可选 `zones[{ zoneId, players, bots, monsters, bossAlive, lastStepMs, watchers }]`。
- `CharacterState` **不加**地图字段：图内血量、死亡计时、保护期只在内存（`hpPercent`/`protectedUntil` 已各有论道与围攻两套语义，不叠第三套）；玩家图籍走新表 `zone_members`。
- `apps/server/src/engine/zone/api.ts`：`ZoneService` 接口（`enter / resume / leaveRoom / retreat / enterBot / retreatBot / isMember / step / start / stop / stats`）+ `NoopZoneService`，T0 写死签名供服务端两个 agent 并行编译。

### 服务端（`apps/server/src/engine/zone/**`）

- `ZoneWorld`（一图一实例，包装 shared 的 `stepZone`）：每 `zoneTickMs` 一步（自重排 `setTimeout` 链，同 bot 引擎），可多步追赶（≤8 步）；`stepZone` 吐出的 `kills` 折算成增量（`scaleReward × zoneRewardScale × (离线玩家 ? zoneOfflineYield : 1)`，`rollLoot(chance × zoneRewardScale)`，BOSS 不打折、按伤害份额前 5 各掷一次）；每 `1000/zoneSnapshotHz` 广播增量帧（`volatile`，慢网自然丢帧），每 5s 一次关键帧（非 volatile）；**房间没有观众时跳过序列化**（bot 照打，零广播成本）。
- **写库策略（关键）**：ZoneWorld **永远不持有可写的 `CharacterState` 快照**，只累计纯增量 `{exp, stones, items[], kills[]}`；每 5s flush 时 `characters.byId` **重读新行** → `settle()` 到当下 → `grantExp / applyReward / recordMonsterKill` 叠加 → `withFreshPower` → 单事务 `saveMany`，再给在线属主推 `character:update` + `zone:loot`。这样玩家 5s 内的换装、学技能、服丹、领任务都不会被覆盖。flush 时顺带刷新实体的 `stats/skills/maxHp`（境界变化按比例缩放当前血量）、在线状态与离线上限（到期 → 移除实体、删 `zone_members`、推 `zone:left offline_cap`）。bot 不写背包行，只加修为与灵石。
- PvP 击杀当刻直接「重读 → 扣 `mapPvpStoneLoss` → 写」，杀手的所得进增量；受害者在线则推 `zone:death`。
- 图内血量/死亡计时/保护期只在内存；入场血量 = `stats.hp × (玩家 ? hpPercent : 1)`，离场不写回。
- 迁移 `005_zone.sql`：`zone_members(character_id PK, zone_id, entered_at)`，只在玩家进/退时写；**重启时按表重建实体**（入口出生、离线态），bot 不入表（下一息自己回来）。
- 房间：`ROOMS.zone(id)`；`Realtime.toZone(zoneId, event, payload, { volatile })`、`zoneWatchers(zoneId)`；多 tab 用 `io.in(ROOMS.character(id)).socketsJoin(zoneRoom)`（同 `party/service.ts:69-81` 手法）；断线 Socket.IO 自动退房、实体留场；重连发 `zone:enter {zoneId:null}` 恢复。socket 入站事件拆成独立的 `registerZoneSocketHandlers(socket, ctx)`，`socket.ts` 只加一行调用（避免与其它 agent 抢文件）。
- Bot 集成（`engine/bots/engine.ts:255-289` 加分支）：`action === 'explore'`（或 `mapPvp && action === 'arena'`）且不在图 → `ctx.zones.enterBot(state, zoneFor(stageIndex), now)`；在图且 `cultivate` 且驻留 ≥10 分钟 → 50% 离图；非活跃时段必离；bot 只到 `capacity-20`。admin 删 bot → flush 重读为 null 自动移除；突破后境界变化由 flush 重读感知。
- 热加载：ZoneWorld 订阅 `settings.onChange`：tick/广播频率重排定时器；`mapPvp` 关 → 清空所有修士对修士的目标；`bossIntervalMinutes` 变 → 重算 `nextBossAt`；密度/刷新倍率只影响下一次复活。
- `docs/ARCHITECTURE.md` §8 补一句：ZoneWorld 是第二个被授权的模拟循环，只推进战斗与位置，修为仍是懒结算。

### 客户端（`apps/client/src/features/zone/**`）

- 依赖：`pixi.js 8.20.1`（主会话派遣前 `pnpm add`；`vite.config.ts` `manualChunks` 加 `pixi.js|@pixi|earcut|eventemitter3|parse-svg-path|ismobilejs|tiny-lru` 独立 `pixi` chunk；`ZonePage` 用 `React.lazy(() => import('./ZoneCanvas'))` 动态加载，只在地图页下载）。
- `store/zone.ts`（zustand 低频状态：status/zoneId/self/roster/loot 累计/死亡与保护时间/BOSS 时间）+ 同文件导出的**可变帧缓冲** `zoneFrames`（`Map<i, {prev, next, prevAt, nextAt}>`），Pixi 在 rAF 里直接读它，不经 React。
- `ZoneCanvas.tsx`：`Application.init({ preference:'webgl', antialias:false, resolution: 低端机 1 否则 min(dpr,2) })`；纯 TS 渲染器 `renderer/{interp,camera,sprites,fx,textures}.ts`（插值 `poseAt(t-300ms)`、镜头跟随、精灵池：底图 Sprite、妖兽 chibi 或境界色圆占位、修士 = 圆形遮罩头像 + 境界色环 + 名字 Text + 两张 1×1 白纹理缩放的血条；命中闪白、暴击放大、死亡用 `ui/ink-splash` 淡出、保护环脉动）；只 `Assets.load` roster 里出现的头像。
- 低端降级：`deviceMemory<=2 || hardwareConcurrency<=4` → 隐藏非己方/非 BOSS 名字、`resolution=1`、`maxFPS=30`；页面隐藏停 ticker；`prefers-reduced-motion` 关飘字与闪光。
- **无 WebGL / reduced-motion / jsdom 兜底**：DOM `ZoneList.tsx`（谁在打谁 + 血条），同时是测试目标与 `?art=off` 的替身。
- `ZonePage.tsx` 替换 `ExplorePage` 内容（`/explore` 路由不变）：未入图 = 地图列表（复用 `api.exploreMaps()` 的解锁信息 + 青云镇入口）；入图 = 画布 + HUD（击杀/修为/灵石累计、BOSS 倒计时、保护倒计时、撤离、采药、循迹）。
- `shell/AppShell.tsx` 的 `visibilitychange`：隐藏 → `zone:leave`，可见且 `zoneId` 非空 → `zone:enter {zoneId}`。
- mock：`api/mock/zone.ts` **直接在浏览器跑 shared 的 `createZoneSim/stepZone/buildFrame`**，从 mock 世界抽 12 个 bot 进图喂帧（不再写第二个假模拟器）。
- 闭关归来弹层增「挂机战果」区（读 `zone:loot` 的 since 汇总）。

### 素材（M4a，全部按新画风，不阻塞开发：缺图时底图 = 深色 + 淡金网格，妖兽 = 境界色圆 + 首字）

| 类别 | 数量 | 规格 |
|---|---|---|
| 俯视地图底图 `zone/*` | 4 | 请求 1024×1536 → WebP 768×1152（2:3，与竖屏画框同比），深色底 |
| 妖兽 chibi `sprite/*` | 12 | 请求 1024×1024 透明 → 256×256，含 4 BOSS |

共 16 张；特效全部用 Pixi Graphics + 现有 `ui/ink-splash`，不出图。新画风 `STYLE` 常量此时定稿（M4c 重出旧图沿用）。`docs/ASSETS.md` → `core/art.ts`（`ART_ZONES`/`ART_SPRITES`）→ `art.test.ts` 计数 82 → 98 → `tools/art/assets.mjs` 加两个 category，四处同步。

### 砍掉留到后面（有理由的）

空间网格（≤120 实体不需要）；逐次伤害/施法事件流（帧内血量差合成）；玩家主动 PvP 姿态与手动选目标（M4b 加 `zone:stance`）；6 张特效素材；图内血量/保护/BOSS 进度跨重启持久化（只持久化玩家图籍）；视野裁剪/msgpack/捏合缩放/小地图；组队标记/好友高亮/图内聊天/bot 图内闲谈；`decideBotAction` 的 `dungeon` 分支；BOSS 拾取竞拍；独立的离线上限旋钮（沿用 `offlineCapHours` + `zoneOfflineYield`）。

### 派遣波次（T0 串行定契约 → T1–T6 并行 → T7 收尾）

| 任务 | agent | 只许改 | 依赖 | 量级 |
|---|---|---|---|---|
| **T0 契约** | `zone-contract` | `packages/shared/src/{domain/zone,protocol/zone,combat/damage,zone/sim,zone/index,content/zones}.ts`（新）、`domain/{world,index}.ts`、`protocol/{events,index,admin}.ts`、`content/{index,registry}.ts`、`combat/{engine,index}.ts`、`src/index.ts`、`core/art.ts`、shared 测试（新 `zone-sim.test.ts`，改 `protocol/art/content.test.ts`）、`docs/ASSETS.md`、`docs/ARCHITECTURE.md`、`apps/server/src/engine/zone/api.ts`（接口 + Noop） | 无 | ~900 行 |
| **T1 服务端引擎** | `zone-server` | `apps/server/src/engine/zone/{world,rules,rewards,flush,members}.ts`（新）、`engine/zone/api.ts`（实现）、`db/migrations/005_zone.sql`、`db/repo/zoneMembers.ts`、`context.ts`、`app.ts`（`startZones`、onClose）、`test/helpers.ts`（`startZones ?? false`）、`test/zone-world.test.ts`、`modules/admin/service.ts`（stats 填充） | T0 | ~1100 行 |
| **T2 socket + 广播 + bot 接线** | `zone-socket` | `apps/server/src/engine/zone/socket.ts`（新）、`socket.ts`（一行调用）、`realtime.ts`（`toZone`/`zoneWatchers`）、`engine/bots/engine.ts`（B7 分支）、`test/socket-zone.test.ts`、`test/bots.test.ts` | T0（靠 `api.ts` 接口编译，T1 合入后跑真测） | ~450 行 |
| **T3 客户端 store/页面/DOM 视图/mock** | `zone-client` | `apps/client/src/store/{zone,socket,inventory}.ts`、`shell/AppShell.tsx`（两行）、`features/zone/{ZonePage,ZoneList,ZoneHud}.tsx` + `zone.css`、`features/explore/ExplorePage.tsx`、`app/routes.tsx`、`api/mock/{zone,index}.ts`、客户端测试 | T0 | ~800 行 |
| **T4 客户端 Pixi 渲染器** | `zone-renderer` | `features/zone/ZoneCanvas.tsx`、`features/zone/renderer/**`（含 `interp/camera` 单测）、`apps/client/package.json`、`vite.config.ts`、`pnpm-lock.yaml`（主会话先 `pnpm add pixi.js@8.20.1`） | T0；与 T3 只共享契约里的 `zoneFrames` 与 roster 形状 | ~900 行 |
| **T5 后台 + 文档** | `zone-admin` | `apps/client/src/admin/{World,Overview}.tsx`、`admin.test.tsx`、`docs/ADMIN.md`、`docs/GDD.md`（§8.1 战斗大地图） | T0 | ~300 行 |
| **T6 素材** | `zone-art` | `tools/art/assets.mjs`、`tools/art/specs/*`、`apps/client/public/art/{zone,sprite}/*`、`manifest.json` | T0 改完 ASSETS.md | 16 张 |
| **T7 E2E** | `zone-e2e` | `e2e/tests/01-solo.spec.ts`（探索一步改为进图 → HUD → 等击杀 ≥1）、`e2e/tests/03-zone.spec.ts`（双账号互见 + 后台开 PvP） | T1–T4 合入 | ~150 行 |

T1 与 T2 的交界是 `engine/zone/api.ts` 的 `ZoneService` 接口，T0 写死签名，两边不再改它。

### 验收（主会话亲自执行）

1. 全量门禁绿；`combat.test.ts` 零改动通过；`vite build` 产物含独立 `pixi-*.js` chunk 且主包体积不变。
2. 自动化必须覆盖：shared `zone-sim.test.ts`（同 seed 500 步逐字节相同、妖兽反击与回家、死亡复活与 60s 保护、`mapPvp` 开关、BOSS 计时、`buildFrame` 增量只含脏实体、AoE 上限 4）；server `zone-world.test.ts`（flush 写入新行、**flush 前 REST 换装 flush 后仍在**、bot 不产生背包行、离线上限移除与 `zone_members` 删行、重启重建成员、PvP 扣 5%、200 bot 入图一步 < 30ms）；`socket-zone.test.ts`（joined/两图不串帧/leave 后实体仍在/retreat/锁图 MAP_LOCKED/限流/重连恢复）；`bots.test.ts` 加 explore bot 进图；client `store/zone.test.ts`、`renderer/interp.test.ts`、`ZonePage` jsdom 用 mock 喂帧后 `ZoneList` 出现妖兽与自己。
3. 两账号 + 真实服务器 + 后台：同图互见、bot 与妖兽在场、60s 内击杀 ≥3、顶栏灵石/修为每 5s 跳动、行囊出现灵草；`zoneTickMs`/`zoneSnapshotHz` 改后不重启即生效且概览「山河」读数变化；开 `mapPvp` 后 bot 攻击 A、A 死亡掉 5% 灵石、10s 复活、60s 保护环；关闭后 30s 内无互殴；A 隐藏标签页 B 仍见 A 在打，A 回来自动恢复并显示离开期间收益；A 关浏览器 5 分钟 B 仍见 A，把 `offlineCapHours` 临时设 0.05 后 A 被移除；A 在图中换装与学神通不丢；重启服务器后 A 回到入口；`bossIntervalMinutes` 设 1 看播报与前 5 掉落；DevTools 6× 降速 + 禁用 WebGL 分别验证 30fps 降级与 DOM 兜底。
4. 生产镜像 compose 冒烟 + e2e 更新通过。

---

## M4b 法宝 · 古宝 · 抽卡（第二段试玩）

### 品阶与稀有度（统一）

`凡 mortal / 灵 spirit / 仙 immortal / 圣 saint / 神 divine` 五阶，`ITEM_GRADE_MULTIPLIER` 补 `divine: 6.5`；抽卡只出 灵/仙/圣/神 四档，配色 蓝/紫/金/红，凡阶只来自商店与低级掉落。

### 法宝（本命法宝）

- 六种形制，决定地图上的自动行为（法宝是绕修士旋转的小图标，独立出手，不被攻击）：铃（每 1.0s 单体 0.6×）、塔（每 2.5s 群体 0.9× 最多 3 目标）、链（每 3.5s 单体 1.4× 并自增攻 10% 持续 4s）、印（每 4s 单体 2.2×）、幡（每 6s 范围持续伤害 0.35×/s × 4s）、盾（每 8s 护盾 = 25% 气血）。
- 实例养成：等级 1–100（星辉石 + 灵石），每 10 级突破（天罡木），进阶提升品阶上限一档（玉衡 + 同名碎片），注灵 10 级（星尘蓝/紫/金/红，费用表对标原作），每 2 级注灵获随机词条一条（攻击%、暴击、破防、久战、吸血、减伤、灵力回复），升星 0–5（碎片），5 星觉醒解锁形制专属效果。
- 槽位：本命 1（地图出手）+ 副法宝 2（只吃属性）；`treasure` 装备槽退役，现有 4 件法宝道具迁移为凡/灵阶法宝实例。
- 内容：18 件（6 形制 × 3 稀有度 + 凡阶 2），名称自拟不抄原作。

### 古宝

- 被动遗物，6 槽（角色页六边形环），每件固定属性线（破防/格挡/暴击/抗暴/气血%/攻击%/防御%/速度）按稀有度定档；注灵 10 级（星尘表同原作数值缩放）、升星 0–5（同色碎片 10/20/40/80）、5 星觉醒（套装效果：同系三件激活）。
- 内容：24 件（4 稀有度 × 6），名称自拟。

### 抽卡「寻宝阁」

- 货币仙玉：日常任务（击杀 50 妖兽 / 挂机 60 分钟 / 秘境 1 次 / 论道 1 次 / 传音 1 次，各给仙玉与星尘）、成就（首次达境界、首杀 BOSS）、BOSS 掉落、后台发放（`admin.grant` 增 `jade`）。
- 单抽 160 / 十连 1500；概率 神 1.5% / 圣 8.5% / 仙 30% / 灵 60%；十连保底 ≥ 圣一件；神阶硬保底 70 抽（每池独立计数，存 `CharacterState.gacha`）；重复转碎片。
- 揭示动画：深底金光卷轴翻牌，稀有度光色；概率公示与百连记录（`gacha_log` 表）。
- 机器人同权：按 id 播种派生法宝与古宝（沿用 `engine/bots/gear.ts` 的思路），进图战力随之拉开。

### 数据与文件

- `005_treasures.sql`：`treasures(uid, character_id, treasure_id, level, breakthrough, grade, spirit_level, affixes_json, stars, slot)`、`relics(uid, character_id, relic_id, spirit_level, stars, slot)`、`gacha_log(id, character_id, pool, rarity, item_id, at)`；`CharacterState` 增 `jade`、`gacha{pool:{pity,total}}`、`daily.quests`。
- shared：`domain/{treasure,relic,gacha,quest-daily}.ts`、`content/{treasures,relics,gacha}.ts`、`protocol/{treasure,gacha}.ts`；地图引擎读法宝形制出手。
- 波次：T0 `treasure-contract` → T1 并行 `treasure-server`（表、服务、抽卡与保底、日常、后台发仙玉、bot 同权）/ `treasure-client`（寻宝阁、法宝页、古宝页、角色页改版）/ `treasure-art`（法宝 18 + 古宝 24 + 寻宝阁底图 2 + 卡框 4 = 48 张）。
- 验收：抽 100 次统计分布落在公示概率 ±3%、70 抽必出神；法宝升级/注灵/升星数值可验；地图上法宝独立出手；bot 战力分布拉开。

---

## M4c 画风 · 灵兽 · 新地图（第三段试玩）

### 画风重做

- 色板换成：玄墨底 `#0E1116` / 浮墨 `#171B22` / 描金 `#D9B15F` / 沉金 `#9C7A38` / 朱砂 `#C8402F` / 青金 `#4FA7B8` / 石青 `#57B98F` / 宣纸字色 `#EAE2D3`；纸纹换成金尘粒子 + 墨雾渐变；`color-scheme: dark`；`config.ts` 镜像色、`index.html` theme-color、`process.mjs` 的 `PAPER` flatten 色、`QiParticles` 粒子色同步。
- 组件：金色发丝边、卷轴式面板头、印章按钮改深底金字；底部页签金线；后台「道录司」维持浅色。
- Image2 `STYLE` 改为「vivid ink-wash on deep black-navy ground, luminous gold accents, saturated cyan / vermilion / gold, ink splash and gold dust, dramatic rim light, 国风幻想」；旧图按优先级重出：背景 10 → 修士立绘 2 → NPC 8 → 头像 16 → 妖兽/BOSS 12 → 道具 30 → UI 4（Codex 每日额度约 100 张，分两三天跑，`run.sh` 断点续跑先清 `raw/`）。

### 灵兽

- 灵兽跟随主人在图里出战（攻击 = 主人 30% × 品阶系数），出战 1 只（元婴起 2、化神起 3 参与秘境/论道）；获取：地图掉灵兽蛋（鉴定 20% 出兽，否则给精魄）、精魄 10 个兑换、抽卡灵兽池；养成：等级（灵兽丹）、资质（孵化随机 气血/攻击/防御）、技能 1–2。
- 现有 `pet` 装备槽退役，3 件灵宠道具迁移为灵兽蛋。
- 表 `pets` 走 `006_pets.sql`；素材：灵兽 chibi 12 + 蛋 4。

### 新地图

- 增 2 张高境界图（化神 / 炼虚）与 6 只新妖兽 + 2 BOSS（补 M4a 的境界覆盖），底图与 chibi 新出。

---

## 素材总预算（新画风）

| 段 | 张数 | 说明 |
|---|---|---|
| M4a | 16 | 地图 4、chibi 12（特效用代码画） |
| M4b | 48 | 法宝 18、古宝 24、寻宝阁 2、卡框 4 |
| M4c 新增 | 24 | 灵兽 12、蛋 4、新地图 2、新妖兽 chibi 8（含 BOSS） |
| M4c 重出 | 82 | 现有全部 |
| 合计 | 170 | 受 Codex 每日额度限制，分批跑，不阻塞开发 |

## 风险与取舍

- **SQLite 写放大**：`save` 是整 JSON 行更新；地图收益必须 5s 批量、只写脏行。验收时用 200 机器人在场压测每步耗时与 WAL 大小。
- **双写竞争**：bot tick、REST 路径与 ZoneWorld 都会改 `CharacterState`。规则：ZoneWorld 只累积纯增量，flush 时重读新行再叠加；三者都是同步回调，各自的读-改-写不会交错。测试里必须有「flush 前换装、flush 后装备仍在」这一条。
- **带宽**：增量 + 关键帧 + 页面隐藏退订，目标 < 3KB/s；不达标则加视野裁剪。
- **PixiJS 体积**：约 350KB gzip 独立 chunk，只在地图页加载；PWA 预缓存包含。
- **回合制与地图两套战斗**：数值同源（`combat/damage.ts`），但节奏不同；论道/秘境仍回合制，M4b 后评估是否把秘境改成地图副本实例。
- **旧装备槽退役**：`treasure`/`pet` 槽改由法宝/灵兽系统接管，需要迁移脚本把现有道具转成实例，机器人装备派生同步改。
- **Codex 额度**：176 张分批，主会话审片抽查；先出 M4a 的 22 张定风格，用户看过后再批量重出旧图。
