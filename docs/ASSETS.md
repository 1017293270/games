# 素材契约（Image2 位图 ID 清单与 manifest 格式）

本文件是 **内容数据（packages/shared）**、**客户端加载器（apps/client）** 与 **素材管线（tools/art）** 三方共用的契约。三方只认这里的 ID；新增素材先改本文件。

## manifest 格式

路径：`apps/client/public/art/manifest.json`，由 `tools/art` 生成，客户端启动时拉取一次。

```json
{
  "version": 1,
  "generatedAt": "2026-09-04T00:00:00Z",
  "assets": {
    "bg/cultivation-day": { "src": "/art/bg/cultivation-day.webp", "srcSmall": "/art/bg/cultivation-day@720.webp", "w": 1080, "h": 1920, "alpha": false },
    "item/pill-qi":       { "src": "/art/item/pill-qi.webp", "w": 256, "h": 256, "alpha": true }
  }
}
```

- `src` 必填；`srcSmall` 仅背景类有（短边 720）；`alpha=true` 表示透明底（道具图标、UI 装饰）。
- 客户端通过 `useArt(id)` 取图；ID 不存在或 manifest 未就绪时返回 `null`，由组件显示 SVG/CSS 占位（不许报错、不许空白）。
- 文件均为 WebP q80；背景竖版 9:16（短边 1080），立绘/头像正方形 512，妖兽 4:5 竖版 640×800，道具图标 256×256 透明底，修士全身像 800×1000 透明底，UI 装饰按需。

## 统一画风（每个 spec 必须包含）

水墨（中国水墨/宣纸）画风。色板：宣纸 `#F3EBDC`、墨 `#1E1B18`、淡墨 `#5C5650`、朱砂 `#B23A2E`、青黛 `#3B5F6B`、金 `#C9A063`。
Avoid（逐条写进 spec）：neon/cyberpunk colors, glossy 3D render look, photorealism, anime cel-shading, any readable text or letters, logos, watermarks, UI frames, borders, signatures, split panels.

## ID 清单（共 82）

### 场景背景 `bg/`（10，竖版 9:16，上 1/3 留淡、下 1/4 留暗给 UI）

| ID | 内容 |
|---|---|
| bg/cultivation-day | 主修炼场·昼：云海山巅一方青石平台，远山淡墨，留中央给盘坐修士 |
| bg/cultivation-night | 主修炼场·夜：同一平台，星月，深青黛调 |
| bg/town-qingyun | 青云镇：青瓦白墙街巷、石桥、灯笼（朱砂点色） |
| bg/map-qingyun-mountain | 青云山：松崖瀑布云雾 |
| bg/map-luoshui-city | 洛水城：临河城郭、画舫、柳 |
| bg/map-youming-valley | 幽冥谷：枯木、幽绿磷火、雾（偏冷） |
| bg/map-kunlun-ruins | 昆仑墟：雪山、断柱残碑、金色天光 |
| bg/dungeon-secret-realm | 秘境副本：洞天石窟，灵光裂隙 |
| bg/tribulation | 天劫：墨云翻滚、雷光（金/朱砂）劈向山巅 |
| bg/login | 登录页：一叶扁舟/孤峰远影，大面积留白给标题 |

### NPC 立绘 `npc/`（8，正方形 512，胸像，纯淡墨/宣纸底）

| ID | 角色 |
|---|---|
| npc/zhangmen | 云鹤真人（青云宗掌门）：白须道长，持拂尘，慈和 |
| npc/zhanglao | 玄阳长老：中年，浓眉，青道袍，严厉 |
| npc/yaowang | 百草仙翁（药王）：驼背老翁，药篓，葫芦 |
| npc/shangren | 钱多多（商人）：圆脸富态，锦袍，算盘 |
| npc/laozhe | 无名老者（神秘老者）：斗笠遮面，破蓑衣 |
| npc/tiejiang | 铁玄（铁匠）：壮硕，赤膊围裙，铁锤 |
| npc/xianzi | 青鸾仙子（论道主持）：素衣女修，青鸾羽饰 |
| npc/zhenshou | 守山弟子：年轻弟子，持剑，青云宗制服 |

### 修士全身像 `char/`（2，竖版 4:5 800×1000，透明底）

主修炼场中央盘坐的角色形象，按角色性别选用；透明底叠在背景上，头像仍用 `avatar/*`。

| ID | 内容 |
|---|---|
| char/meditate-m | 男修士：盘坐冥想全身像，正面略侧，双手结印置膝，闭目，宽袖道袍随风，发带飘动，脚下无地面 |
| char/meditate-f | 女修士：盘坐冥想全身像，正面略侧，双手结印，闭目，长发与素衣飘动，脚下无地面 |

### 玩家/机器人头像 `avatar/`（16，正方形 512，胸像）

| ID | 气质 |
|---|---|
| avatar/m01 | 青年剑修，束发，清冷 |
| avatar/m02 | 少年道童，明朗 |
| avatar/m03 | 中年儒修，纶巾 |
| avatar/m04 | 魔修，黑袍，半面疤 |
| avatar/m05 | 僧修，光头，佛珠 |
| avatar/m06 | 老者散修，白发飘逸 |
| avatar/m07 | 少年游侠，斗笠 |
| avatar/m08 | 皇族气质，金冠 |
| avatar/f01 | 女剑修，高马尾，英气 |
| avatar/f02 | 医修少女，药囊，温婉 |
| avatar/f03 | 魔道妖姬，红衣 |
| avatar/f04 | 道姑，素冠，淡然 |
| avatar/f05 | 少女，双髻，灵动 |
| avatar/f06 | 女将军，甲胄 |
| avatar/f07 | 琴修，抱琴 |
| avatar/f08 | 冷艳女修，面纱 |

### 妖兽与 BOSS `monster/` `boss/`（12，竖版 4:5 640×800，宣纸底）

| ID | 内容 | 出没 |
|---|---|---|
| monster/qingyun-wolf | 青云狼：青灰皮毛，眼有灵光 | 青云山 |
| monster/spirit-ape | 灵猿：抱桃木杖 | 青云山 |
| monster/luoshui-flood-dragon | 洛水蛟：河中探首 | 洛水城 |
| monster/river-bandit | 水匪修士：蒙面持刀 | 洛水城 |
| monster/ghost-lantern | 幽冥灯鬼：提灯飘游 | 幽冥谷 |
| monster/bone-general | 白骨将：残甲骨将 | 幽冥谷 |
| monster/ice-qilin | 冰麒麟：冰晶鳞甲 | 昆仑墟 |
| monster/golden-crow | 金乌：三足金乌，烈焰 | 昆仑墟 |
| boss/qingyun-tiger-king | 青云虎王：巨白虎 | 秘境·青云 |
| boss/luoshui-dragon-lord | 洛水龙君：人形龙首 | 秘境·洛水 |
| boss/youming-ghost-emperor | 幽冥鬼帝：冕旒鬼王 | 秘境·幽冥 |
| boss/kunlun-heaven-beast | 昆仑天兽：九首异兽 | 秘境·昆仑 |

### 道具图标 `item/`（30，256×256 透明底，单物体居中）

丹药（8）：item/pill-qi 聚气丹 · item/pill-foundation 筑基丹 · item/pill-breakthrough 破境丹 · item/pill-heal 回春丹 · item/pill-spirit 凝神丹 · item/pill-power 龙力丹 · item/pill-golden-core 金元丹 · item/pill-enlightenment 悟道丹

材料（8）：item/mat-spirit-herb 灵草 · item/mat-iron-essence 玄铁精 · item/mat-beast-core 妖丹 · item/mat-spirit-stone 灵石 · item/mat-jade 灵玉 · item/mat-soul-crystal 魂晶 · item/mat-cloud-silk 云纹丝 · item/mat-thunder-wood 雷击木

法宝（4）：item/treasure-sword 青锋剑 · item/treasure-bell 镇魂铃 · item/treasure-fan 乾坤扇 · item/treasure-seal 山河印

法衣（4）：item/robe-linen 布衣 · item/robe-daoist 道袍 · item/robe-cloud 流云法衣 · item/robe-golden 金霞仙衣

饰品（3）：item/acc-jade-pendant 玉佩 · item/acc-prayer-beads 菩提珠 · item/acc-talisman 护身符

灵宠（3）：item/pet-crane 仙鹤 · item/pet-fox 灵狐 · item/pet-turtle 玄龟

### UI 装饰 `ui/`（4，透明底）

| ID | 内容 | 尺寸 |
|---|---|---|
| ui/cloud-pattern | 祥云纹横条（可平铺） | 1024×256 |
| ui/seal-red | 朱砂印章（方形篆印质感，无可读字） | 256×256 |
| ui/scroll-bg | 卷轴宣纸底（竖版，上下卷轴轴头） | 768×1024 |
| ui/ink-splash | 水墨晕染点（叠加用） | 512×512 |
