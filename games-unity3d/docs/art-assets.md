# 原创美术资产

生成方式：Codex 内置 ImageGen。官方资料只用于研究画风与界面原则，以下没有使用官方图像作为游戏资产。

## 青云山背景

项目文件：`Assets/Resources/Art/zone-qingyun.png`，1024×1536。

原图：`/Users/zhuanzmima0000/.codex/generated_images/01a07b15-a0b0-7bb1-9056-21c10d8d0d71/exec-3cc8de66-ab63-4ab7-8e45-6b8427537b8a.png`。

提示词：

> Use case: stylized-concept. Asset type: production background painting for an original Chinese cultivation idle game Qingyun, planar 2D artwork, portrait 2:3 composition. Create a refined, airy traditional Chinese ink and light watercolor painting of a Qingyun Mountain sanctuary battle map, in the elegant visual language of classical Chinese cultivation mobile games. Top-down / gentle high oblique view, almost flat, a broad softly textured pale celadon and warm ivory ground filling the central 65 percent of the entire canvas from bottom to top, sparse gently winding paving, small mountain gate at the bottom edge, a subtle ancient circular ritual seal in a clearing near the top. Faint ink pine trees, slender bamboo, graceful jagged mountain rocks and small cloud banks frame the outer left and right edges; a narrow jade stream along one edge. Keep most of the center quiet and walkable for small character sprites: no large obstacles anywhere in the central space. Color is restrained sage, ink blue gray, creamy rice paper, faint cinnabar accents and only a few faded antique gold details. Expressive brush lines with varying weight, delicate dry-brush texture, luminous white mist and generous negative space, elegant illustrative hand-painted art direction, clean and translucent rather than thick dark oil paint. Visible crafted stone and vegetation details but not visually busy. All elements are painted 2D, no rendered 3D look, no photorealism, no blocky polygonal models, no checkerboard tiles. NO characters, NO UI panels, NO text, NO letters, NO logos, NO watermark. This is original art, do not reproduce a specific game's scene or proprietary characters.

## 早期修士立绘研究（已停用）

1024×1536，RGBA；检查确认约51%的像素完全透明。用户随后指定头像球呈现，该立绘已从游戏打包资源移除，原始生成图保留在下方路径，未作为当前战场素材。

原图：`/Users/zhuanzmima0000/.codex/generated_images/01a07b15-a0b0-7bb1-9056-21c10d8d0d71/exec-1e3fdd5b-98d3-4cde-8885-adf150413ec2.png`。

提示词：

> Use case: stylized-concept. Asset type: an original production game character sprite for a refined Chinese cultivation 2D idle game, isolated on a genuinely transparent alpha background. A single full-body young adult male Chinese Daoist sword cultivator, standing relaxed in three-quarter view facing slightly right, entire body from topknot to boots visible, slim elegant tall silhouette, feet together but relaxed, long ivory and very pale sage layered robes with muted blue-green collar and sash, dark ink hair gathered into a small high topknot with a simple jade pin, a graceful long robe hem and loose sleeve edges drifting gently to the left, one slender ancient sword held angled gently downward beside him. Refined ink outline with varying brush weight, subtle flat pale watercolor shading and deliberate clean negative spaces, polished high-end hand-painted 2D Chinese mobile game art, delicate but strong silhouette readable at 100px tall. Face small and dignified, no oversized anime eyes, no chibi proportions. Costume panels form elegant tapered shapes. Soft minimal shading with no cinematic lighting. NO floor, NO cast shadow, NO pedestal, NO environment, NO backdrop, NO text, NO lettering, NO UI, NO logo, NO watermark, NO frame, no collage, no multiple poses. The background must be transparent, not an illustrated checkerboard. Original character, do not reproduce any named game character. Character fills about 85 percent of canvas height with sufficient clear padding around the whole silhouette.

## 复用素材

当前人物头像来自原 `games/apps/client/public/art/avatar/`；青云狼与灵猿头像来自 `art/monster/`，青云虎王头像来自 `art/boss/`。仅用 macOS `sips` 将 WebP 转换为 Unity 可导入的 PNG，没有改动原文件。游戏通过 shader 完成圆形裁切与球体描边，不使用全身精灵。

灵气、微粒、飞剑小图与薄雾为原生代码生成的轻量效果纹理；地图使用上方原创绘画，人物与怪物使用原项目头像。
