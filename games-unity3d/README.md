# 青云问道 · Unity 客户端迁移

本工程使用 **Unity 6.6（6000.6.0f1）和原生 UI Toolkit** 承载青云问道玩家客户端，包含洞府、修炼突破、人物、功法神通、行囊、法宝古宝、寻宝日课、城镇任务商店、多人社交及四张挂机地图。界面不是嵌入原网页；平面水墨战场使用 SpriteRenderer 和圆形头像，保留自己、目标和 Boss 的清晰区分。

当前已有 **37 步真实客户端核心流程通过**，但尚未达到全量高还原和手机真机验收。下面分别说明已取得的证据、仍需完成的工作和本地管理入口。

## 本地启动

需要 Node.js 24+、Unity 6000.6.0f1 Apple Silicon 和已激活的 Editor 许可证。网页构建另需同版本 Web Build Support。`wzx/unity3d` 分支把本工程放在仓库的 `games-unity3d/`，游戏后端与 shared 位于仓库根目录；脚本同时兼容开发时并列的 `../games` 目录。其他位置可设置 `GAMES_SOURCE_DIR` 为游戏源项目的绝对路径。

从远程分支开始时，在克隆的仓库根目录执行：

```sh
git clone --branch wzx/unity3d git@github.com:1017293270/games.git games-unity
cd games-unity
pnpm install --frozen-lockfile
cd games-unity3d
```

```sh
npm run content          # 从原项目 shared 导出内容与真实图片，不改游戏数值
npm run verify:content   # 校验来源、表、引用、路线及图片完整性
npm run server           # 启动隔离本地游戏后端
```

另开终端执行 `npm run open`，或在 Unity Hub 添加本目录。打开 `Assets/Scenes/QingyunMountain.unity` 后 Play，在登录页注册账号并自行填写道号、头像与性别；已有账号可以直接登录。服务地址默认为 `http://127.0.0.1:3100`，可在登录页连接设置中更改。

服务仅监听本机回环地址，存档位于 `.local/server-data/game.db`，与原网页游戏及线上存档分离。脚本准备的本地演示角色使用加速验收参数（境界 20、Boss 周期一分钟），这不是正式平衡；玩家自行注册的角色按现有服务规则创建。口令和 token 不打印到启动日志。

已有构建可打开 `Builds/macOS/Qingyun.app`。网页版本须先构建，然后运行 `npm run preview`，访问 [本机网页客户端](http://127.0.0.1:3180/)。两种客户端都需要本地后端运行。不要双击网页 `index.html`。

登录默认进入洞府，不强制入山。选择地图后由服务器控制移动、选敌、技能、伤害和掉落；切换页面只取消战场观看，角色继续挂机；“撤离”才真正退出并结算。客户端断开后，服务器按既有挂机和离线规则处理。

## 独立网页管理入口

保留原项目 `apps/client` 的 **道录司网页后台**，不把管理工具或管理员凭证放进 Unity 玩家界面。开发服务器只读提供已定位游戏源项目下的 `apps/client/dist` 静态构建，后台与本地游戏 API 使用同一来源。

若该构建不存在，可在原项目按已有构建方式生成；以下命令不启动额外服务，也不修改原游戏存档：

```sh
# 在游戏源项目根目录运行（分支布局中为当前Unity目录的上一级）
pnpm --filter @xianxia/shared build
VITE_MOCK=0 pnpm --filter @xianxia/client build
```

随后用 zsh 隐藏输入自选后台口令，再启动本地服务：

```sh
read -rs 'QINGYUN_ADMIN_PASSWORD?设置本地后台口令（6–72字符）：'
export QINGYUN_ADMIN_PASSWORD
npm run server
unset QINGYUN_ADMIN_PASSWORD
```

后台地址：[http://127.0.0.1:3100/admin](http://127.0.0.1:3100/admin)，用户名 **`unity_local_admin`**，口令就是刚才输入的内容。口令通过运行时环境传入，不写入 README、文件或日志。未设置口令时，隔离服务内部仍使用随机管理员口令供测试准备数据，但用户无法用它登录；启动日志会提示配置后重启。不存在原网页构建时，也会明确提示后台尚不可用。

如果已有进程占用 3100，脚本会退出，不抢占或终止它。需要修改自己的启动配置时，在原启动终端正常停止再重新运行。`npm run preview` 的 3180 是 Unity 网页播放器入口，管理页面在上述 **3100/admin**。

保留的 **17 条管理 API** 均已有真实服务端 handler：

| 管理分区 | 能力与接口（均以 `/api/admin` 开头） |
| --- | --- |
| 登录、概览 | POST `/login`；GET `/stats` |
| 世界 | GET、PUT `/settings` |
| 机器人 | GET、PUT、DELETE `/bots`；POST `/bots/generate` |
| 原型 | GET、PUT `/bot-archetypes` |
| 玩家 | GET `/players`；POST `/players/grant`、`/players/reset-password`、`/players/ban` |
| 邀请码 | GET、POST、DELETE `/invites` |

本轮以全新临时数据库及随机端口验证：管理 HTML、引用的 JavaScript 均返回 200；未鉴权统计返回 401；真实管理员登录、统计和世界设置读取通过。测试只在临时库运行既有夹具初始化，随后关闭服务并删除临时库，没有访问现有 3100/3191 数据，也未操作用户存档。此证据证明入口和鉴权可用，**不等于本轮已逐项点击验收全部管理写功能**。

## 当前客户端证据

2026-09-07本地日期的最新 [37 步报告](.local/verification/full-ui-004/client-smoke.json)记录 `coreJourneyPassed: true`、`fullMigrationAccepted: false`（09-08 01:19:17 UTC结束）。报告及前后截图位于 `.local/verification/full-ui-004/`，是本地验收产物，不应覆盖或误称已提交到版本库。此批包含紧凑人物/神通、四列行囊和坊市商品行→数量确认的新交互；更早批次证据仍保留。

该流程使用实际 UI Toolkit `NavigationSubmitEvent` 激活真实按钮，TextField 修改触发实际绑定；导航由测试辅助切页。实际 HTTP、Socket.IO 和隔离 SQLite 支撑业务结果，覆盖：

- 登录、突破、学习与装配功法/神通、装备、真实属性丹药。
- 法宝入门礼、装配与升级、免费古宝寻宝、古宝注灵、传音日课领奖。
- NPC 对话、商店买卖、接取任务、完成对话目标与提交领奖。
- 单人及组队副本战报、队友奖励、论道与记录、回血和围攻血池。
- 好友申请接受、建队、真实伙伴入队、世界与队伍双向传音。
- 三类榜单、修士名录和档案、第二张地图采药/探索/进入/撤离、退出重登持久化、新账号注册与创角。

伙伴由真实 REST/Socket.IO 客户端参与，**不是第二个 Unity 客户端**。此轮不是鼠标命中、拖动手势或手机性能验收；截图仍需视觉复核。未覆盖的网络中断重试、资源不足、全部装备槽与数量边界、付费资源十连及幂等重试、养成全部星级上限、全部日课/章节/商店限购、副本失败分支、论道防守通知、围攻保护期与并发、榜单跨页、长时间离线挂机、多 Unity 客户端及 PvP/Boss 等，见报告 `notCovered`。资源寻宝并无真实支付。

另外的 [6 步连接专项](.local/verification/connection-ui-001/client-smoke.json)已通过：登录后快速选择第二地图，旧“无驻留”回复被真实延迟且在选图后才到达；回洞府保留驻留；真实切断 Socket 后恢复同一地图及进入时间；主动撤离后再次断线重连仍不入图。证据同时记录服务端实际驻留与新的 Socket ID。这补齐了实时连接的特定竞态，尚不代表 HTTP 消费请求丢回包重试、长时离线和所有网络故障都已覆盖。

[5 步交易专项](.local/verification/commerce-ui-001/client-smoke.json)在780×1690竖屏通过：数量0/100不可提交；50灵石时数量2不可购买；经真实本地管理API赠送100后，保持同一输入框焦点和数量2，余额显示150且购买自动可用；返回货架不消费；实际买2颗扣120至30、卖1颗返15至45。这修复了货架缓存余额落后于人物入账的问题，只在已有控件上读最新人物状态，不增加轮询请求。该批不重跑整套37步，也不代表所有限购/并发/断网消费都已覆盖。

常规挂机收益提示现仅在秘境主界面、未打开弹层时出现，避免交易/装配时内容被反复挤动；实际收益与钱包照常更新。重要系统通知和战败反馈仍保留。

完整 Web 构建也已在本地浏览器实际验证登录、洞府/人物/秘境导航、真实气血与收益、设置弹层，见[网页验收记录](.local/verification/web-full-client.json)。菜单字形差异已通过“设置”文字修正。此批使用682×790、DPR2桌面视口；自动化粘贴没有进入Unity输入框，稳定焦点后的真实逐键输入成功。中文IME和原生剪贴板仍需验证，不能据此宣布手机输入验收通过。

[Unity 检查报告](.local/verification/unity.json)记录了场景、字体、shader、坐标转换、重复脉冲、丢帧恢复、槽位复用、血量、无效帧原子性和 reset 检查通过。它不能代替上述实际业务与视觉验收。

## 官方对照与尚未实现的原作系统

对照依据见 [官方迁移参考](docs/full-migration-official-reference.md)、[水墨表现依据](docs/official-art-direction.md)与 [迁移盘点](docs/migration-inventory.md)。这些文档包含实施前基线和历史截图，不能把其中旧“原型缺口”段落或早期官方资料当作当前完成状态、当前手游版本。当前完成范围以代码和本节验收记录为准。

《一念逍遥》的体法双修、炼丹炼器、药园种植、完整灵兽、主动古宝、本命器灵、随机词条、品阶晋升、完整宗门组织玩法等，不能因已有名称、图标或旧 pet 装备槽就算实现。后续仍须逐系统核实官方玩法/实机资料、补真实数据契约与流程；目前没有把这些系统补成完整可玩内容。

属性丹药修复前实际核对了 [2020-12-03 洞府介绍](https://xian.leiting.com/news/3.html)中的属性丹药，以及 [2024-01-31 发布的神通更新](https://xian.leiting.com/news/447.html)。实现启用的是青云问道既有两种药品定义和 1800 秒药效，按原项目 GDD 的加算百分比公式生效；没有把这些数值、概率或时长声称为官方规则，也没有据此新增御剑秘术。当前 damage/heal 神通的 modifier 均为空，解锁技能槽药品尚无实际内容，不扩建未使用占位。

画面使用项目资产，不将官方宣传图冒充原创；静态截图不能证明动画周期。iOS/Android 安装、真机触控、竖屏各设备视觉、无障碍、长时间运行与 FPS/温度/内存均尚未全面验收。桌面画面流畅不能证明手机性能，也不能证明已高度还原手游。

## 构建、验证与维护

```sh
npm run verify:content  # 同源表、引用、72条REST路线、98个素材ID与109张PNG
npm run verify:backend  # 隔离临时库的真实HTTP/Socket.IO回归
npm run verify:unity    # Unity编译及帧缓存检查
npm run build:mac       # Builds/macOS/Qingyun.app
npm run build:web       # Builds/Web
```

找不到 Editor 时设置 `UNITY_EDITOR` 为可执行文件绝对路径。当前开发构建允许本机 HTTP；正式发布仍需明确网络地址和 HTTPS 配置。本地服务只绑定回环地址，因此不能直接拿手机连接；真机需要另外配置可达的隔离测试环境。

`tools/client-fixture.mjs` 与 `Assets/Scripts/ClientSmoke.cs` 支撑真实客户端验收，只使用新建证据目录和临时库；旧报告保留。命令行的 `-qingyunDemo` 用于本机演示会话，`-qingyunPage` 选择捕获页面，`-qingyunCapture` 与 `-qingyunExitAfterCapture` 输出画面和状态报告；完整业务 smoke 使用自己的新 fixture，不能与演示自动登录混用。

停止本地服务器时在启动终端按 Ctrl+C，等待关闭和战果落库；再次启动复用 `.local/server-data/`。本工程没有自动更新或部署线上服务。

- `GameUi*.cs`：原生玩家页面、弹层及交互；`Bootstrap.cs`：会话、路由缓存、完整状态和事件整合。
- `GameConnection.cs`：REST 与 Engine.IO 4 / Socket.IO polling；token 只保存在内存。
- `GameCatalog.cs`、`Resources/Content/catalog.json`、`tools/export-content.mjs`：同源内容与资源映射；没有虚构 `/api/content`。
- `ZoneState.cs`、`WorldView.cs`：四地图帧缓存、恢复、平面场景和相机；权威战斗与奖励始终在服务器。
- `tools/dev-server.mjs`：隔离游戏服务与独立网页后台；`startIsolated` 的测试默认不启用网页静态托管。

中文正文字体 [Noto Sans SC](https://github.com/notofonts/noto-cjk) 和标题字体 [Ma Shan Zheng](https://github.com/google/fonts/tree/main/ofl/mashanzheng) 的许可证随附在 `Assets/Resources/Fonts/`。后续游戏内容修改继续遵循两项目 `AGENTS.md` 的官方资料先查证规则。
