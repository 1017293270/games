# 寻宝阁背景

- 生成方式：内置 imagegen。
- 游戏成品：`apps/client/public/art/progression/gacha-hall-v1.webp`，768 × 1152；1024 × 1536 生成原图保留在 Codex 的 generated_images 目录。
- 使用：寻宝页面中央展示区的背景，不含文字或游戏控件；控件使用真实 HTML。
- 视觉检查：青金山云、描金星盘、朱砂光源和宝匣主体完整，上下留深色区域供界面覆盖。

## 生成提示词

Use case: stylized-concept. Asset type: portrait background illustration for the original Chinese cultivation idle game 青云问道, to be placed behind a mobile treasure-summoning interface. Primary request: a rich vivid Chinese ink-wash treasure pavilion interior, a deep black-navy mystical hall with elegant antique gold architectural edges, saturated teal mineral-pigment clouds, a warm vermilion incense glow, floating gold dust, and one circular astrolabe altar with a small closed ancient bronze treasure casket at lower center. Style: sophisticated Chinese gongbi brush detail combined with expressive ink wash, hand-painted mineral color, dramatic rim light; premium mobile xianxia game art. Composition: vertical 2:3, atmospheric depth, symmetric but organic, keep upper 20 percent and lower 18 percent dark with restrained detail so real UI text can be placed there. Center ceremonial altar visible in middle half; no characters. Colors deep ink #0E1116, teal #4FA7B8, cinnabar #C8402F, antique gold #D9B15F. No text, no letters, no logos, no watermarks, no UI panels, no borders, no floating interface cards. Render at 1024x1536.

## 器物素材与提示词

9 张器物按名称分别生成，稀有度复用器型并用游戏卡框和文字区分。最终位图为 384 × 384 WebP，全部保留透明通道。两张背景为 768 × 1152 WebP；11 张合计 767,818 字节，原始 PNG 合计 18,957,331 字节。使用项目已安装的 sharp 作尺寸与格式准备，生成原图仍保留在 Codex 的 generated_images 目录。

以下公共提示词加各行 Subject，即为实际内置 imagegen 请求：

Use case: stylized-concept. Create ONE isolated item icon for the Chinese cultivation game 青云问道. Style is fine Chinese gongbi brushwork and vivid mineral-pigment ink wash, elegant restrained antique gold accents, teal/jade and cinnabar details; premium xianxia mobile game inventory art. The object must be a readable distinct silhouette at 80px. Centered three-quarter view, occupy about 76 percent of a square canvas, ample transparent padding, detailed but not cluttered. Actual transparent PNG background, not a checkerboard drawing, not an opaque scene. No characters, no extra objects, no text or readable calligraphy, no numbers, no UI frame, no border, no logos, no watermark. Not glossy 3D or photorealistic. Output 1024x1024.

| 文件（apps/client/public/art/progression/） | Subject                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| relic-0-v1.webp                             | one circular celadon jade bi disc with a clean hole in the center, carved gold-cloud fittings, a crimson tassel and a soft jade inner glow.          |
| relic-1-v1.webp                             | one rectangular ancient cinnabar talisman tablet of carved stone, mountain relief in gold, dark teal edge fittings; abstract markings only, no text. |
| relic-2-v1.webp                             | one luminous sky-blue spirit pearl held inside an elegant open bronze-and-gold claw mount, subtle swirling mineral color inside the orb.             |
| relic-3-v1.webp                             | one antique round handheld bronze mirror with an ornate small handle, finely engraved golden rim, an opaque luminous teal mirror face.               |
| relic-4-v1.webp                             | one ancient Chinese standing soul lantern with a warm vermilion flame, dark bronze frame, gold ornamental cloudwork and turquoise inlays.            |
| relic-5-v1.webp                             | one small rounded teal-jade ritual wine ewer with curved spout, gold handle, gold lid and refined cinnabar ribbon.                                   |
| treasure-banner-v1.webp                     | one ancient vermilion ritual banner hanging from a dark carved pole, flowing silk, abstract gold cloud motifs and a subtle teal spirit flame.        |
| treasure-shield-v1.webp                     | one round Chinese mythic shield, dark bronze with an antique gold rim and a central turquoise jade protective beast relief.                          |
| treasure-tower-v1.webp                      | a miniature seven-story Chinese bronze pagoda with jade-green roofs, elegant gold filigree and a small luminous cyan core.                           |

## 洞府场景

文件：`apps/client/public/art/progression/cultivation-vivid-v1.webp`。输入为本轮打开的《一念逍遥》官网内容区截图，只作为风格参照；未复制网页布局、文字、标志或人物。

Use case: stylized-concept. Asset: a new portrait 1024x1536 background painting for the original Chinese cultivation game 青云问道's cave meditation home and login screen. The supplied screenshot is a STYLE REFERENCE ONLY: study the navy and blue-grey night atmosphere, fine drifting antique gold particles, gauzy curved clouds and mineral-pigment Chinese ink landscapes in its LOWER background. Do NOT reproduce its website, text, logos, QR codes, characters or panels. Paint a completely original enchanted mountain sanctuary: layered tall Chinese blue-green ink-wash mountains receding into translucent dark mist, delicate sweeping pale-gold cloud ribbons framing the left and right, a subtle star-filled slate-blue sky, a small distant temple on a cliff at lower right, and an empty broad stone meditation terrace at bottom center. The middle 45 percent must remain compositionally calm and open for a separate meditating character sprite and circular progress ring. Upper 15 percent calm blue-grey mist for headings; bottom 15 percent transitions into deep ink for controls. Refined traditional ink-on-silk/gongbi fantasy painting, strong atmospheric depth and intentional negative space, saturated cyan highlights and faint warm gold, luminous ivory moon glow, tiny restrained cinnabar accent on distant temple. NOT flat teal, not generic gradients, not glossy 3D, not a sci-fi starfield. No characters, no words, no decorative UI frame, no watermark. Full opaque background, portrait 2:3.
