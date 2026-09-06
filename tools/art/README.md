# tools/art — Image2 水墨素材管线

把 `docs/ASSETS.md` 里的 98 个素材 ID 变成 `apps/client/public/art/**` 下的 WebP 成品 +
`manifest.json`。出图后端是本机 Codex CLI 的内置 `image_gen`（gpt-image-2 / "Image2"），
封装在 `~/.claude/skills/codex-imagegen/` 这个 skill 里。

```
assets.mjs      98 个素材的唯一数据源（主体描述 + 每类的请求尺寸/成品尺寸/是否透明/画风）
gen-specs.mjs   assets.mjs -> specs/*.txt        （提示词，可重复生成）
run.sh          specs/*.txt -> raw/*.png         （调 codex，只补缺失的）
process.mjs     raw/*.png   -> ../../apps/client/public/art/**.webp + manifest.json
check.mjs       校验成品与 docs/ASSETS.md 契约是否一致
```

`docs/ASSETS.md` 是契约，本目录跟随它，不反过来。`check.mjs` 会直接从那个 md 里
正则抽 ID 做交叉校验，所以契约改了这里会立刻报错。

## 依赖

`sharp` **不装在仓库里**。装到仓库外的一个环境，用 `NODE_PATH` 指过去：

```bash
SHARP_ENV=/private/tmp/claude-501/-Users-zhuanzmima0000-Developer-work-games/393d8163-7141-4f65-adae-356abbc70d2a/scratchpad/sharp-env
npm i --prefix "$SHARP_ENV" sharp@0.35.4
export NODE_PATH="$SHARP_ENV/node_modules"
```

`package.json` 里已经把 sharp 声明成 devDependency，以后并入 pnpm workspace 后
`pnpm --filter @games/art art:process` 就能直接跑，不再需要 `NODE_PATH`。

## 全量流程

```bash
node tools/art/gen-specs.mjs          # 写出 98 个 spec
tools/art/run.sh 8                    # 出图（只补 raw/ 里缺的那些）
NODE_PATH="$SHARP_ENV/node_modules" node tools/art/process.mjs
NODE_PATH="$SHARP_ENV/node_modules" node tools/art/check.mjs
```

`run.sh` 天生可断点续跑：它只把「specs/ 里有、raw/ 里没有」的排进队列。
Codex 用量打满、批次中断、个别失败，直接再跑一次同样的命令即可，不会重复计费。

## 如何重出单张

1. 复制 spec，**只改一个变量**，其余 invariant 逐字保留（画风段尤其不能动）：

```bash
cd /Users/zhuanzmima0000/Developer/work/games
cp tools/art/specs/item--pill-qi.txt tools/art/specs/item--pill-qi-v2.txt
# 编辑 item--pill-qi-v2.txt：只改那一处
```

2. 单张出图（`1` = 不并行；spec 名不带 `.txt`）：

```bash
tools/art/run.sh 1 item--pill-qi-v2
```

3. 重新处理并校验（`process.mjs` 自动优先用最高的 `-vN`，原图不会被覆盖）：

```bash
NODE_PATH="$SHARP_ENV/node_modules" node tools/art/process.mjs item/pill-qi
NODE_PATH="$SHARP_ENV/node_modules" node tools/art/check.mjs
```

也可以绕过 `run.sh` 直接调 skill 出单张：

```bash
~/.claude/skills/codex-imagegen/scripts/gen.sh \
  /Users/zhuanzmima0000/Developer/work/games/tools/art/raw/item--pill-qi-v2.png \
  /Users/zhuanzmima0000/Developer/work/games/tools/art/specs/item--pill-qi-v2.txt \
  /Users/zhuanzmima0000/Developer/work/games/tools/art
```

## 尺寸约定

gpt-image-2 要求两边都是 16 的倍数，且 `Output size` 只是倾向——实得像素通常不等于请求值，
但宽高比守得住。所以一律「请求一个大一号的合法尺寸 → `process.mjs` 用 cover 裁切到规范尺寸」。

| 类别 | 请求 | 成品 | 额外 | 透明 |
|---|---|---|---|---|
| `bg/` | 1088×1920 | 1080×1920 | `@720` 720×1280 | 否 |
| `npc/` `avatar/` | 1024×1024 | 512×512 | — | 否 |
| `char/` | 1024×1280 | 800×1000 | — | 是 |
| `monster/` `boss/` | 1024×1280 | 640×800 | — | 否 |
| `item/` | 1024×1024 | 256×256 | — | 是 |
| `ui/cloud-pattern` | 1536×512 | 1024×256 | — | 是 |
| `ui/seal-red` | 1024×1024 | 256×256 | — | 是 |
| `ui/scroll-bg` | 1008×1344 | 768×1024 | — | 是 |
| `ui/ink-splash` | 1024×1024 | 512×512 | — | 是 |
| `zone/` | 1024×1536 | 768×1152 | — | 否 |
| `sprite/` | 1024×1024 | 256×256 | — | 是 |

`ui/cloud-pattern` 请求 3:1 而成品是 4:1（1024×256 超出 gpt-image-2 的 3:1 长短比上限，
不能直接请求），spec 里因此要求祥云带垂直居中、上下留空，让 cover 裁切只吃掉空白。

## 透明底

`item/*` 与 `ui/*` 要求真透明。`process.mjs` 不信任 PNG 的 alpha 通道存在与否——它把图缩到
128px 数「alpha < 16」的像素占比，低于 2% 判定为「其实是不透明的」，此时把图压到宣纸底
`#F3EBDC` 并在 manifest 里记 `alpha:false`，让客户端知道这张不是抠图。

出成不透明时的补救顺序：先用更强的透明措辞出 `-v2`；仍不行就接受宣纸底并保留 `alpha:false`。

## 画风一致性

同一类别的 spec，`Style/medium` 段逐字相同——这是整套图看起来像同一个人画的主要原因。
`Avoid` 段固定以 `docs/ASSETS.md` 的清单开头，再按类别追加。
**改画风常量等于让引用它的全部素材失去一致性**，要改就得把那些全部重出。

现在有**两套**画风常量，`assets.mjs` 顶部并排放着：

| 常量组 | 用于 | 面貌 |
|---|---|---|
| `STYLE` / `PALETTE` / `MATERIALS` / `AVOID_BASE` | 原有 8 类共 82 张 | 宣纸淡墨，纸色 `#F3EBDC` 打底，留白多 |
| `STYLE_VIVID` / `PALETTE_VIVID` / `MATERIALS_VIVID` / `AVOID_VIVID` | `zone/` `sprite/` 共 16 张（M4a） | 深黑蓝 `#0E1116` 打底，描金与金尘，青金/朱砂/金三色高饱和 |

选择发生在**类别**上，不在单张素材上：`CATEGORIES[cat]` 里写了 `style`/`palette`/
`avoid`/`materials` 就用那一组，四项都不写就落回 `STYLE` 那一组。`buildSpec` 里是
`b.style ?? STYLE` 这样的四行，没有别的开关。要把某一类换成新画风，改那一类的 category
定义、重跑 `gen-specs.mjs`、再把该类全部重出即可，别的类一个字都不会动
（改完拿 `diff -rq` 对着旧 specs 验一遍，未涉及的类必须零差异）。

## 已知坑

- `gen.sh` 里的 `< /dev/null` 不能删，否则 codex 会卡在读 stdin 上永不返回。
- macOS 没有 `timeout`；卡住的任务看 `raw/.imagegen-logs/<name>.log`，必要时 `pkill -f "codex exec"`。
- Codex 账号用量打满时，日志末尾是 `You've hit your usage limit ... try again at <时间>`，
  且 `raw/` 里不会落文件。等窗口重置后重跑 `run.sh` 即可续上。
- `docs/ASSETS.md` 正文里写了 `bg/map-*` 这个 glob，`check.mjs` 抽 ID 的正则必须带
  `(?![-*a-z0-9])` 尾部否定，否则会把它当成第 99 个不存在的 ID。
- **并行出图会串图**：所有 codex 会话共用 `$CODEX_HOME/generated_images/`，`cp` 那步可能抓到隔壁会话的图，
  于是文件名对、画的内容却是别的素材。本次 82 张里中招 5 次。这种错误尺寸和 alpha 全都正常，只能靠
  **`check.mjs` 的 md5 去重扫描**发现（串图必然与源文件逐字节相同）。并行度越高越容易中招：8 并行中招多，
  1 并行没再中过。重出关键素材时用 `run.sh 1`。
- `raw/`、`.imagegen-logs/` 不进仓库（见 `.gitignore`）；成品 WebP 进仓库。
