# 全量迁移清单：games → games-unity3d

核查日期：2026-09-07。源仓库 HEAD：`54ac5db9ba0939aa7db0a737c24e024aa9e4b4ca`。本清单依据当前工作区代码，不把历史测试报告当作本次实测。已读两个仓库的 `AGENTS.md`；只读源仓库，未运行服务、改数据库或部署。本次为契约和缺口盘点，以下“验收”列是必须执行的成功判据，不是已完成声明。

**阅读时间点说明：** 本文表格的缺口记录于迁移开始时，当时Unity仅有战场原型；不能当作现在仍无人物/城镇/社交页面的结论。后续原生UI Toolkit实现、37步真实流程和官方视觉修订见 [README](../README.md)、[官方迁移对照](full-migration-official-reference.md)及各批实际证据。尚未实现的官方系统仍单独列明，不因现有界面可用而自动算完成。

目标是完整迁移现有游戏，再补齐经官方资料核实的原作系统。战场原型、编译通过、连接成功、单个场景截图均不构成全量迁移成功。后台管理属于产品整体、位于玩家客户端之外，须明确保留或迁移，不能漏掉。

## 1. 当前可用性与统一契约

- `packages/shared/src/protocol/routes.ts` 的 API 共 **72 个 REST 端点**，`apps/server/src/modules/*/routes.ts` 共 **72 个对应 handler**；注册表中的 `quests` 对应导出变量 `questEndpoints`。`app.ts` 汇总全部 handler。当前没有只声明未绑定的 REST 功能；这只证明代码完整绑定，不证明当前服务健康。
- REST 前缀 `/api`。成功为 `{ok:true,data:...}`；失败为 `{ok:false,error:{code,message,...}}`，要同时处理 HTTP 状态和业务错误。用户请求 `Authorization: Bearer <token>`；GET 用 query/path 参数，写请求 JSON。分页 `page,pageSize`，返回 `items,page,pageSize,total,hasMore`。
- **没有 `/api/content`，也没有 zone REST 端点**。网页从 `@xianxia/shared` 导入静态内容。Unity 应把同一版本内容导出为随包 JSON，保存源 HEAD 和资源映射；若以后新增服务端 content API，必须明确是新增契约，不假定原服务已有。
- 需要导出的玩家内容：items、skills、techniques、monsters、maps、dungeons、zones、npcs、dialogues、quests、shops、progression，另加 cultivation 境界/灵根常量、core/art 素材 ID。`bots` 是服务器及后台用的原型内容。服务端动态解锁/库存/条件必须采用 REST 返回，不能由导出 JSON 自行认定。
- 初始盘点时，Unity `Assets/Scripts/Bootstrap.cs` 仅接入登录、读取既有角色、固定青云山 zone 事件和战场 HUD；`GameConnection.cs` 已有 Bearer REST 和 Socket.IO polling 传输，其余页面与DELETE尚未迁移。这是历史基线，当前代码已推进；不要把传输类或页面存在等同于各系统已通过真实验收。

## 2. 玩家页面、动作、端点与验收

下表路径均相对 `/api`。源入口为 `apps/client/src/app/routes.tsx`，弹层和分栏亦计入迁移范围。

| 功能 / 原网页入口 | 用户能完成的动作与关键契约 | 真实成功证据 | 迁移开始时的缺口（历史） |
|---|---|---|---|
| 账号 `/login`、创角 `/create` | POST `/auth/register` `{username,password,inviteCode?}`、POST `/auth/login` `{username,password}` → `token,expiresAt,user`；GET `/auth/me` → `user,serverTime`；POST `/auth/logout`。POST `/character` `{name,avatarArt,gender}` | 新账号注册、邀请码失效反馈、创角后重新登录回同一角色；注销后旧 token 被拒绝；封禁/过期会话回登录 | 现只有既有账号登录/取角色，需注册、创角、持久会话与退出完整流程；不能把角色不存在统一当网络故障 |
| 洞府 `/`：修炼、离线归来、突破 | GET `/character`；POST `/character/settle` → `view,gainedExp,elapsedSec,creditedSec,forfeitedSec,stageUps,stagesPassed`；POST `/character/breakthrough` `{pills:0..4}` → `success,chance,pillsUsed,from/toStageIndex,expLost,tribulation,view` | 离线后结算到账且不重复；圆满前不能突破，丹药扣除与结果一致；渡劫返回真实战报；刷新仍一致 | 整页、计时校正、离线弹层、突破与渡劫回放缺失 |
| 角色 `/character`：属性、功法、神通 | POST `/character/skills/learn` `{skillId}`；PUT `/character/skills` `{slots:[id/null ×4]}`；POST `/character/technique/learn` `{techniqueId}`；PUT `/character/technique` `{techniqueId}`；返回完整 CharacterView | 学习扣灵石；未知/未学/境界不足被拒绝；四槽顺序在实际战斗产生对应施法；切换功法后速率重取；重进仍保留 | 属性页、条件/成本、学习和槽位编辑全部缺失 |
| 行囊（角色页 InventoryPanel） | GET `/inventory` → `items,spiritStones,equipment,stats,powerScore`；POST `/inventory/use` `{uid,qty}` → `view,message,gainedExp`；POST `/inventory/equip` `{uid}`；POST `/inventory/unequip` `{slot}` | 道具数量和修为/增益一致；同槽自动替换，实际属性改变；不足道具不扣资源；刷新持久化 | 列表、筛选、详情、服药、装备/卸下缺失；物品实例 uid 不能用定义 itemId 替代 |
| 法宝 `/treasures` | GET `/progression`；POST `/progression/claim` `{kind:'starter',id:'starter'}`；POST `/progression/equip` `{uid,slot:0/1/2/null}`；POST `/progression/upgrade` `{kind:'treasure',id,action:'level'/'infuse'/'star'}` | 入门只领一次；0 本命、1/2 辅槽正确；材料扣除和等级/注灵/星级持久化；本命在回合战和大地图确实施放，护盾等效果真实生效 | 图鉴、持有、详情、装配、养成缺失；战场需消费 mainTreasure / treasureStates，而非只有装饰 |
| 古宝 `/relics` | 同 `/progression`；upgrade `{kind:'relic',id,action:'infuse'/'star'}`；收藏即加成、集齐套装生效，不是穿戴槽位 | 重复本体转碎片；升星/注灵与套装改变真实属性/修炼速率；不能凭空给古宝 level 按钮 | 图鉴、套装、碎片、成长缺失；主动古宝原游戏也未实现 |
| 寻宝 `/gacha` | POST `/progression/draw` `{pool:'treasure'/'relic',count:1/10,free?,requestId}` → `view,progression,results`；GET `/progression/history` → `items[{id,requestId,at,results}]` | 免费各池资格、成本、保底、重复转碎片与历史一致；相同 requestId 重试仅扣一次；刷新和地图结算后不回滚 | 双池、概率/保底说明、结果、历史、幂等重试 UI 缺失 |
| 日课 `/daily` | GET `/progression`；POST `/progression/claim` `{kind:'daily'/'achievement',id}`；日课含击杀、修炼时长、副本、主动论道、传音 | 实际完成对应业务计数后领奖；未达成/重复领奖被拒绝；UTC 跨日按服务端状态重置 | 日课、成就、材料栏、可领取反馈缺失 |
| 山河与挂机 `/explore` ZonePage/ZoneHud | 静态 ZONES + GET `/explore/maps` 解锁和 `gatherReadyAt`；Socket `zone:enter {zoneId}`、`zone:leave`、`zone:retreat`；多地图、自己/目标/Boss、名册、战果 | 两个真人同时看见彼此；挂机真实得修为/灵石/掉落；关页面继续挂机，撤离才退出；断线补全帧；重登收益与库存一致 | 只有固定青云山原型；多地图选择、解锁、完整恢复/状态联动、可访问名册与全量玩家壳需补齐 |
| 采药与奇遇（ZoneHud/EncounterDialog） | POST `/explore/gather` `{mapId}` → `reward,nextGatherAt,view`；POST `/explore/battle` `{mapId,monsterId?}` → `kind:'battle'` 的 `battle,won,reward,view` 或 `kind:'encounter'` 的 `encounter,encounterToken,view`；POST `/explore/event` `{encounterToken,optionId}` → `outcomeText,reward,view` | 冷却与奖励持久；战斗/奇遇两条分支可完成；无效/过期 token、不可选选项不能领资源 | 整套动作、倒计时、选择和回放缺失 |
| 青云镇 `/town`：NPC 对话 | GET `/npc` → `npcs`（`unlocked,hasQuest`）；POST `/npc/dialogue` `{npcId}`；POST `/npc/talk` `{npcId,nodeId,choiceId?}` → `node,choices[{id,text,available,blockedReason}],openShopId,reward,ended,view` | 条件阻挡清楚；选项产生真实任务/奖励/商店效果；`ended` 时结束对话，不重复执行已经告辞的分支 | 镇场景、NPC、分支弹层与商店跳转缺失 |
| 任务簿（TownPage/QuestPanel） | GET `/quests` → `active,available,claimed,chapters,currentChapter`；POST `/quests/accept` `{questId}`；POST `/quests/complete` `{questId}` → `reward,advancedToChapter,view` | 接任务→完成真实目标→交付→下一章；奖励只发一次；任务目标来源可见 | 任务/章节/领奖缺失，不能仅显示静态故事 |
| 商店（ShopSheet） | GET `/shop/:shopId` → `shop,entries,spiritStones,sellPrices`；POST `/shop/buy` `{shopId,itemId,qty}`；POST `/shop/sell` `{shopId,uid,qty}` → `shopView,stonesDelta,spiritStones,view` | 购买入包、卖出离包，灵石变动和限购库存一致；境界/库存不足时不成交 | 货架、回收、数量与限购反馈缺失；出售接口在 shop 而非 inventory |
| 秘境副本 `/realm` DungeonLobby | GET `/dungeon` → `dungeons`（解锁、次数、Boss）；POST `/dungeon/start` `{dungeonId,withParty}` → `cleared,battles,waves,reward,view,participantIds` | 单人或队长开本、每波敌人/血量匹配，队员收到同一次战报且共享结算；次数真实扣除 | 副本大厅、组队跳转、逐波回放缺失；此副本与 zone 挂机是两套契约 |
| 论道 `/realm` ArenaPanel + 被挑战通知 | GET `/arena/opponents` → `opponents,challengesToday,dailyLimit,rating`；POST `/arena/challenge` `{targetId}` → `won,battle,ratingBefore,ratingAfter,reward,opponent`；GET `/arena/records` 分页 | 主动挑战计数/积分/记录一致，被挑战用户收通知可看回放；刷新记录仍存在 | 对手、战绩、挑战、被挑战排队弹层缺失 |
| 围攻 `/realm` RaidBoard | GET `/raid/targets` → `targets` 含 `hpPercent,protectedUntil,bounty`；POST `/raid/attack` `{botId,withParty}` → `defeated,battle,remainingHpPercent,reward,participantIds,target` | 多次攻击共享血池，打空才击破；保护期不可重复攻击；队员奖励分配可核对 | 围攻列表、血池、保护期、战报缺失 |
| 传音 `/social` ChatPanel | GET `/chat/history` `{channel,limit,before?,partyId?}`；Socket `chat:send {channel:'world'/'party',text}`，接收 `chat:message` | 两真人互收消息，历史可回读；队伍频道不得串队；消息实际计入日课 | 频道、历史、发送/限制、滚动、Socket 状态缺失 |
| 组队 `/social` PartyPanel | GET `/party` → `party:null/object`；POST `/party/create`；POST `/party/join` `{code}`；POST `/party/leave`；POST `/party/kick` `{characterId}`；成员 `isLeader,online,hpPercent` | A 建队 B 邀请码加入，两端同步；踢人/离队/队长转移生效；队长真实开副本 | 队伍完整页面和 party:update 处理缺失 |
| 好友 `/social` FriendsPanel | GET `/friends`；POST `/friends/request`、`/friends/accept`、`/friends/remove` 均 `{characterId}`；状态 `pending_in,pending_out,accepted` | 双账号申请、接受、拒绝/删除、重新登录保留；在线状态更新 | 列表、申请提示、搜索入口、状态处理缺失 |
| 修士名录 / 公开档案 ProfileDrawer / 榜单 | GET `/cultivators` `{q?,onlyOnline?,page,pageSize}`；GET `/cultivators/:id` → PublicProfile；GET `/rankings` `{board:'realm'/'power'/'arena',page,pageSize}` | 搜到真人和机器人、正确在线标记；档案装备/功法/属性与对方状态一致；榜单对应维度排序 | 名录、档案、榜单、点击人物入口缺失 |
| 共用战斗回放与壳层 | BattleReplay、WaveReplay、DungeonRunReplay 消费 BattleResult；AppShell 处理会话恢复、离线归来、profile drawer、arena notice、Toast、顶栏资源/在线数 | 战报不是另算胜负；切页不重复领奖；队友事件不打断已有弹层；小屏可读可点 | 所有非 zone 回放、路由/导航、通用资源与错误状态缺失 |

## 3. 核心状态必须按服务器契约处理

**CharacterView** 是 `{character,stats,stageName,expRequired,ratePerSec,secondsToNextStage,atPerfection,inventory}`，不是把 `character` 对象直接当整个返回值。CharacterState 包含 `id,userId,name,gender,avatarArt,spiritRoot,stageIndex,exp,spiritStones,skillSlots,learnedSkillIds,techniqueId,learnedTechniqueIds,equipment,progression?,buffs,hpPercent,protectedUntil,chapter,quests,flags,lastSettledAt,lastSeenAt,dailyCounters,arenaRating,arenaWins,arenaLosses,prestige,powerScore` 等。时间戳为毫秒，用 `/auth/me.serverTime` 校正显示时钟；本地倒计时不发放资源。

**Inventory**：`equipment` 的 `treasure,robe,accessory,pet` 指向背包实例 `uid`，并非 `itemId`；旧 `treasure/pet` 装备槽与新 progression 法宝不是同一系统。成功写操作用返回 view 替换完整相关状态；`character:update` 为 partial patch，只合并发送的字段，不能把遗漏字段清零。

**Progression**：`materials{jade,stardust,starStones,breakthroughWood}`、`treasures[{uid,definitionId,level,spiritLevel,stars,fragments,slot}]`、`relics[{definitionId,spiritLevel,stars,fragments}]`、`gacha{treasure/relic:{pity,total}}`、`daily{date,kills,cultivationSeconds,dungeon,arena,chat,claimed,freePools}`、`achievements,claimedAchievements,starterClaimed`。旧角色 progression 可缺省，服务端按需补默认值。draw 的 requestId 在同一逻辑重试中必须保持不变。结果名称/图片由内容 definitionId 映射，材料/保底/价格是本项目规则。

**Realtime**：Socket.IO 默认命名空间，握手 `auth:{token}`；不是直接向裸 WebSocket 发送 JSON。当前 C2S 共 5 个事件：`chat:send,presence:ping,zone:enter,zone:leave,zone:retreat`。S2C 共 16 个：`chat:message,presence:update,character:update,party:update,dungeon:start,dungeon:result,arena:challenged,raid:update,system:notice,friend:request,zone:joined,zone:frame,zone:left,zone:loot,zone:death,zone:error`。

- `zone:enter {zoneId:null}` 恢复当前驻留地图；`zone:leave` 仅取消观看，继续挂机；`zone:retreat` 真正撤离并结算。切页不能误用 retreat，真正撤离不能只停止渲染。
- `zone:joined` 含 `zoneId,self,enteredAt,frame`；frame 为 `zoneId,seq,at,full,add,remove,ents,events,boss,treasureStates?`。实体 tuple `[i,x*10,y*10,hp,flags,targetI,skillSlot]`，不是世界坐标浮点值；`targetI=-1` 表示无目标。
- 槽号 `i` 可复用，remove 必须清除旧身份/缓存；full 替换快照；seq 缺口请求恢复，不能把缺帧当全部实体死亡。`HIT/CRIT/DODGED/CASTING` 是单次脉冲，其余位是状态。支持 roster `mainTreasure` 和护盾 `treasureStates`。
- `dungeon:result` 的逐波数组字段叫 `replay`，REST start 返回叫 `battles`；二者均有 waves，须按 combatant id 匹配 finalHp，不能按怪物定义 ID 合并重复敌人。
- 收到 `party:update`、`friend:request`、`arena:challenged`、`raid:update`、`system:notice` 需要可见业务反馈；仅在 log 中打印不算迁移。

## 4. 后台管理：玩家客户端之外，但产品全量范围必须保留

原入口 `/admin`，界面为 `Overview,World,Bots,Archetypes,Players,Invites`。全部 17 个后台端点已有真实 handler。最小完整路径是继续保留原网页后台并在交付说明给出入口；若要求同样迁入 Unity，再单列运营客户端，不在玩家界面暴露管理凭证。本清单不授权执行任何后台写操作。

| 页面 | 端点（相对 /api）与动作 | 关键字段 / 成功证据 |
|---|---|---|
| 登录/总览 | POST `/admin/login`；GET `/admin/stats` | 管理员会话可用 `x-admin-token` 或 Bearer；合法 isAdmin 玩家会话也可被服务端接受。统计含真实玩家/机器人/实时 zone 状态，非静态卡片 |
| 世界 World | GET、PUT `/admin/settings` | 部分更新 WorldSettings；界面逐项保留注册/邀请码、修炼、战斗、奖励、机器人、多人、zone 等现有设置。修改后的 GET 与实际引擎行为一致，未提交项不受影响 |
| 机器人 Bots | GET `/admin/bots`；POST `/admin/bots/generate`；PUT、DELETE `/admin/bots` | 列表 q/archetypeId/sort/order/page；生成 count,minStageIndex,maxStageIndex,archetypeId?/archetypeWeights?/seed?；更新/删除 characterId。数量、参数、排行榜和实际行为一致 |
| 原型 Archetypes | GET、PUT `/admin/bot-archetypes` | 原型参数按 shared/admin schema；更新影响后续生成和对应全局重算，不能只更新前端表格 |
| 玩家 Players | GET `/admin/players`；POST `/admin/players/grant`、`/reset-password`、`/ban` | 搜索/onlyBanned；grant 使用 characterId、exp/spiritStones/stageIndex/items 及已有养成材料字段；密码重置和封禁以账号 schema 为准。发放持久、封禁会话拒绝、解封恢复；必须专用测试账号验证 |
| 邀请 Invites | GET、POST、DELETE `/admin/invites` | 生成数量、使用次数和备注等按 schema；邀请码创建/作废后真实注册行为一致；-1 表示不限次数 |

## 5. 原游戏已实现与原作仍缺的边界

“72 个端点全部实现”只表示青云问道当前合同完成，不表示已完整实现《一念逍遥》。当前可迁移的是真人账号、离线修炼/突破、功法神通、行囊装备服药、挂机地图/PvP/Boss、采药奇遇、NPC/任务/商店、单人组队副本、论道围攻、聊天好友榜单、法宝/被动古宝/寻宝/日常和运营后台。

源 `docs/M4B.md` 明确未实现：体法双修、炼丹炼器、主动古宝、本命器灵、独立灵兽、随机词条、品阶晋升。旧 pet 装备槽不等于完整灵兽系统；NPC 宗门称呼不等于宗门建设/组织玩法；洞府入口不等于药园种植、炼丹炉、器室全流程。没有协议/handler 的官方系统需新功能阶段，不能在 Unity 放一个不可用按钮后计为完成。支付未实现，寻宝使用游戏内资源，无真实付费。

对官方存在但本清单没有已读玩法材料的其他系统（例如当前版本新增体系、更多跨服/宗门玩法），状态统一为“需官方资料核实后制定功能契约”，不得凭名称宣布已复刻。完整官方覆盖清单需继续扩展，不能拿现有青云问道内容反向限定最终目标。

## 6. 官方对照依据及每组资料缺口

优先复用源 `docs/M4B.md` 和目标 `docs/official-art-direction.md` 的已核实资料。本次没有冒充重新看过全部官网或实际视频；这些是既有文档记录的已读来源，均属历史材料，不代表 2026 当前版本全貌。具体实现前应重新打开该系统相关官方原文/截图，并补资料发布日期。

| 系统 | 已有官方来源 | 可采用的证据 / 限制 |
|---|---|---|
| 洞府/修炼及待补生产 | [洞府介绍](https://xian.leiting.com/news/3.html)，2020-12-03；截图 2020-12 | 官方说明修炼、种植、炼丹、炼器、御兽；实机图可参考功能落在场景中的入口布局。不能只迁移修炼进度条就称完整洞府；动画周期未公开/待核实 |
| 战场/多人信息 | [社交 PK](https://xian.leiting.com/news/17.html)，2021-01-15；[战斗布局更新](https://xian.leiting.com/news/412.html)，2023-12-08 | 17 的战斗图是带宣传装饰的合成展示；圆形头像、阵圈是图像观察。412 明说头像/气血/真元/状态显示；当前服务端无真元字段，不能虚构显示 |
| 多人表现性能 | [性能优化公告](https://xian.leiting.com/news/604.html)，2024-11-22 | 官方说明简化其他角色特效；可采用主角/目标优先、旁人克制的策略；不是官方 3D 要求 |
| 古宝 | [套装介绍](https://xian.leiting.com/news/175.html)、[主动古宝公告](https://xian.leiting.com/news/228.html)，日期需重新核实 | 三件套及主动/被动、升星/注灵不同成长轴。现有只完成被动古宝，主动不能列已实现 |
| 寻宝 | [限定保底公告](https://xian.leiting.com/news/389.html)、[免费探宝公告](https://xian.leiting.com/news/632.html)，日期需重新核实 | 活动保底不等于常驻统一概率；免费与境界有关。青云问道两池每日一次、160/1500、70 抽和基础概率均是已授权自定规则 |
| 神通功法/双修、法宝深层养成、炼丹炼器/灵兽 | 洞府和 M4B 只提供部分系统存在的依据 | 具体界面、操作、条件和数值仍需对应官方资料；不能用官网营销首屏替代 |
| 青云镇任务商店、副本、论道围攻、好友队伍榜单 | 社交 PK 资料仅部分相关 | 当前项目接口可完整迁移，但“高度还原”所需各自官方实机与机制资料尚不充分；逐系统补证据，不把项目自定情节/倍率称原作规则 |
| 账号与运营后台 | 青云问道自有产品设施 | 不需要假称原作运营后台；保留现有权限和账号合同 |

## 7. 可执行迁移与验收顺序

1. 内容导出与会话/角色完整闭环：注册→创角→登录恢复→服务器时钟→共享 CharacterView/Inventory/Progression 状态；未登录、无角色、空列表、业务失败均可恢复。保存导出源 HEAD，验证每个引用 ID 有定义/资源。
2. 玩家壳和洞府/角色/养成：逐项完成本表动作；养成资源变化回读服务端，并确认进入战场后数据不被旧快照覆盖。
3. 战场扩为所有解锁地图并补采药奇遇；再实现副本/论道/围攻的服务器战报回放，不在 Unity 另写权威结算。
4. 镇、任务、商店和社交全链；两真人端同时验组队/聊天/好友/副本事件。多端状态一致与重登持久是必要条件。
5. 明确保留后台入口，逐项核查 17 个端点的可访问功能；后台写验收只用隔离测试数据。
6. 按官方系统分别做视觉和交互复核：在 Unity 实际运行/目标分辨率截图与视频对照。保留当前平面水墨、圆球包头像方向；游戏中展示真实数据，避免把网游宣传页样式当实机复刻。

现成验收参考（存在但本次未执行）：`games/e2e/tests/01-solo.spec.ts` 注册创角、修炼、角色、挂机、青云镇；`02-party.spec.ts` 双角色、建队、副本、论道、离队；`03-zone.spec.ts` 双人同图、收益、PvP、撤离；`04-progression.spec.ts` 入门、双池、十连幂等、古宝、日课及地图后持久化。服务端 `test/` 各系统测试可核对错误分支与业务规则。需要把这些业务成功条件迁成 Unity 的实际交互验证，而非只复跑原网页测试。

最终交付证据至少包含：每功能组的实际操作录屏/截图、对应服务端返回关键字段、资源前后变化、刷新/重登结果、双端实时结果，以及未完成/待核实项目。任何一组仍缺真实动作或只剩静态展示，都继续标为未完成。
