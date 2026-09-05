/**
 * Single source of truth for the Image2 art pipeline.
 *
 * Mirrors the 82 IDs defined in docs/ASSETS.md (that file is the contract; this
 * file must follow it, never the other way around). Consumed by:
 *   gen-specs.mjs  -> writes specs/<id with '/' replaced by '--'>.txt
 *   process.mjs    -> raw/<same>.png -> apps/client/public/art/<id>.webp + manifest.json
 *   check.mjs      -> validates the built output against these rules
 */

// ---------------------------------------------------------------------------
// Shared prompt fragments. The STYLE string is byte-identical in all 82 specs —
// that is what keeps the set looking like one painter's hand.
// ---------------------------------------------------------------------------

export const STYLE =
  'traditional Chinese ink wash painting (shuimo) on textured xuan rice paper, ' +
  'expressive calligraphic brush strokes, controlled ink bleed and dry-brush texture, ' +
  'muted palette with sparse accents of vermilion #B23A2E, indigo #3B5F6B and antique gold #C9A063, ' +
  'paper tone #F3EBDC, ink #1E1B18, generous negative space, misty atmosphere';

export const PALETTE =
  'paper #F3EBDC, ink #1E1B18, light ink #5C5650, vermilion #B23A2E, indigo #3B5F6B, antique gold #C9A063';

/** Verbatim Avoid list from docs/ASSETS.md. Every spec starts its Avoid line with this. */
export const AVOID_BASE =
  'neon or cyberpunk colors, glossy 3D render look, photorealism, anime cel-shading, ' +
  'any readable text or letters, logos, watermarks, UI frames, borders, signatures, split panels';

export const TRANSPARENT =
  'genuinely transparent background, preserve the alpha channel, no backdrop, no drop shadow';

// ---------------------------------------------------------------------------
// Per-category rules: how to ask for it, and how to process what comes back.
//   request  – Output size sent to gpt-image-2 (both sides multiples of 16,
//              total pixels 655,360..8,294,400, long:short <= 3:1)
//   out      – final WebP size after cover-crop + resize
//   small    – optional extra derivative (backgrounds only, short edge 720)
//   alpha    – whether the final WebP is expected to carry real transparency
// ---------------------------------------------------------------------------

export const CATEGORIES = {
  bg: {
    request: '1088x1920',
    out: [1080, 1920],
    // docs/ASSETS.md: "srcSmall 仅背景类有（短边 720）" -> short edge 720 on a 9:16 frame
    small: [720, 1280],
    alpha: false,
    useCase: 'stylized-concept',
    assetType: 'full-screen vertical game background for a mobile idle-cultivation RPG',
    composition:
      'vertical 9:16 portrait format; the top third of the frame stays pale, misty and almost empty so a translucent status bar can sit over it; ' +
      'the bottom quarter fades into darker ink wash or bare paper so a tab bar can sit over it; the main subject occupies the middle band',
    constraints:
      'no human figures anywhere in the frame, no animals in the foreground, no text of any kind, edge-to-edge painted composition with no border or frame',
    avoidExtra: 'people, characters, close-up faces, video game HUD, minimap, vignette frames',
  },
  npc: {
    request: '1024x1024',
    out: [512, 512],
    alpha: false,
    useCase: 'illustration-story',
    assetType: 'square NPC portrait card for a mobile idle-cultivation RPG',
    composition:
      'square 1:1 format; head-and-shoulders bust portrait only, cropped just below the chest; ' +
      'the figure is centered, facing the viewer at a slight three-quarter turn; plain undecorated xuan rice paper ground behind the figure with soft ink wash',
    constraints:
      'exactly one person in the frame, bust only, plain paper background, no props floating around the figure, no text',
    avoidExtra:
      'multiple people, full body, legs, hands raised across the face, busy background scenery, speech bubbles, name plates',
  },
  avatar: {
    request: '1024x1024',
    out: [512, 512],
    alpha: false,
    useCase: 'illustration-story',
    assetType: 'square player-avatar portrait for a mobile idle-cultivation RPG',
    composition:
      'square 1:1 format; head-and-shoulders bust portrait only, cropped just below the chest; ' +
      'the figure is centered, facing the viewer at a slight three-quarter turn; plain undecorated xuan rice paper ground behind the figure with soft ink wash',
    constraints:
      'exactly one person in the frame, bust only, plain paper background, no props floating around the figure, no text',
    avoidExtra:
      'multiple people, full body, legs, hands raised across the face, busy background scenery, speech bubbles, name plates',
  },
  monster: {
    request: '1024x1280',
    out: [640, 800],
    alpha: false,
    useCase: 'illustration-story',
    assetType: 'vertical enemy card illustration for a mobile idle-cultivation RPG',
    composition:
      'vertical 4:5 format; the whole creature is centered in frame with its full body visible and a comfortable margin of bare paper on all four sides; ' +
      'plain xuan rice paper ground with only a suggestion of ink mist under the feet',
    constraints:
      'exactly one creature, complete body inside the frame, plain paper background, no scenery, no text',
    avoidExtra: 'cropped limbs, multiple creatures, detailed landscape background, health bars',
  },
  boss: {
    request: '1024x1280',
    out: [640, 800],
    alpha: false,
    useCase: 'illustration-story',
    assetType: 'vertical boss card illustration for a mobile idle-cultivation RPG',
    composition:
      'vertical 4:5 format; the whole creature is centered in frame with its full body visible and a comfortable margin of bare paper on all four sides; ' +
      'plain xuan rice paper ground with heavier swirling ink mist around the base to read as menace',
    constraints:
      'exactly one creature, complete body inside the frame, plain paper background, no scenery, no text',
    avoidExtra: 'cropped limbs, multiple creatures, detailed landscape background, health bars',
  },
  item: {
    request: '1024x1024',
    out: [256, 256],
    alpha: true,
    useCase: 'stylized-concept',
    assetType: 'transparent inventory item icon for a mobile idle-cultivation RPG',
    composition:
      'square 1:1 format; one single object, centered, filling about 70 percent of the frame, seen straight on at a slight three-quarter angle; ' +
      'nothing else in the frame',
    constraints:
      TRANSPARENT +
      '; the ink-wash brushwork and paper tone belong to the painted object itself — the area around the object must be fully transparent, not filled with paper colour; ' +
      'single object centered, no scene, no ground plane, no cast shadow, no text',
    avoidExtra:
      'multiple objects, collections or sets, a scene or setting, tabletop, background wash, plate or pedestal, drop shadow, glow halo, icon badge frame',
  },
  char: {
    request: '1024x1280',
    out: [800, 1000],
    alpha: true,
    useCase: 'illustration-story',
    assetType: 'transparent full-body seated cultivator sprite for the main meditation scene of a mobile idle-cultivation RPG',
    composition:
      'vertical 4:5 format; one complete figure seated cross-legged in lotus meditation, centered, facing the viewer at a slight three-quarter turn, hands resting in a mudra in the lap, eyes closed; ' +
      'the whole figure including the folded legs and the hem of the robe is inside the frame with a small margin on every side; there is no ground, no cushion and no scenery — the figure floats on nothing',
    constraints:
      TRANSPARENT +
      '; the ink-wash brushwork and paper tone belong to the painted figure itself — everything around the figure must be fully transparent, not filled with paper colour; ' +
      'exactly one person, complete body, no props on the ground, no text',
    avoidExtra:
      'multiple people, standing pose, cropped limbs, ground plane, cushion, mat, background wash, scenery, drop shadow, glow halo, cast shadow',
  },
  ui: {
    // per-asset request/out; see UI entries below
    alpha: true,
    useCase: 'stylized-concept',
    assetType: 'transparent ink-wash UI ornament for a mobile idle-cultivation RPG',
    constraints:
      TRANSPARENT +
      '; the ink-wash brushwork and paper tone belong to the painted ornament itself — everything around it must be fully transparent, not filled with paper colour; ' +
      'no text, no frame, no border',
    avoidExtra: 'drop shadow, glow halo, background wash, buttons, panels, readable characters',
  },
};

// ---------------------------------------------------------------------------
// The 82 assets. `subject` becomes the Primary request line; optional fields
// override or extend the category defaults.
// ---------------------------------------------------------------------------

const CENTER_RESERVED =
  '. Additionally, the exact centre of the middle band is left as calm empty ground — a seated cultivator sprite will be composited there later, so paint no figure at all in that space.';

export const ASSETS = [
  // --- bg (10) -------------------------------------------------------------
  {
    id: 'bg/cultivation-day',
    subject:
      'a bare blue-grey stone meditation terrace on a mountain summit floating above a rolling sea of clouds, pale layered mountain ridges receding into mist behind it, one wind-bent pine clinging to the rock at the left edge',
    mood: 'clear late-morning daylight, high and airy, serene, warm pale sunlight diffusing through thin cloud',
    extraConstraints: CENTER_RESERVED,
  },
  {
    id: 'bg/cultivation-night',
    subject:
      'the same bare blue-grey stone meditation terrace on a mountain summit above a sea of clouds, now under a night sky with a thin crescent moon and scattered stars, the same wind-bent pine at the left edge',
    mood: 'deep still night, cool indigo #3B5F6B dominant, moonlight rimming the cloud tops, quiet and vast',
    extraConstraints: CENTER_RESERVED,
  },
  {
    id: 'bg/town-qingyun',
    subject:
      'a small mountain-town street of grey-tiled white-walled houses stepping down a slope, an arched stone bridge over a narrow canal, a scatter of hanging lanterns painted in vermilion as the only warm accents',
    mood: 'soft overcast afternoon, homely and quiet, thin smoke rising from a chimney',
  },
  {
    id: 'bg/map-qingyun-mountain',
    subject:
      'towering pine-covered cliffs rising out of drifting cloud, a tall thin waterfall falling down a dark rock face into unseen depths, layered ridges fading pale into the distance',
    mood: 'cool damp mountain air, spray haze, majestic and remote',
  },
  {
    id: 'bg/map-luoshui-city',
    subject:
      'a riverside walled city seen from across the water, a tiled gate tower above the ramparts, two ornate painted pleasure barges moored at the quay, trailing willow branches framing the foreground water',
    mood: 'hazy warm dusk over slow water, gentle reflections, prosperous and calm',
  },
  {
    id: 'bg/map-youming-valley',
    subject:
      'a cold dead valley of leafless twisted trees with claw-like branches, thick low fog swallowing the ground, a few sparse pale ghost-green will-o-wisp lights drifting between the trunks as the only colour',
    mood: 'cold, damp and haunted, almost monochrome ink, heavy fog, unsettling stillness',
    paletteExtra: ', plus a very sparse pale ghost-green #6E8B7A for the wisps only',
  },
  {
    id: 'bg/map-kunlun-ruins',
    subject:
      'a high snowfield beneath jagged white peaks, the broken stumps of enormous stone columns and a cracked toppled stele half-buried in snow, a shaft of antique gold light breaking through the cloud onto the ruins',
    mood: 'thin freezing air, immense and ancient, solemn gold light against cold white',
  },
  {
    id: 'bg/dungeon-secret-realm',
    subject:
      'the interior of a vast karst grotto, hanging stalactites and wet rock walls, a jagged luminous fissure splitting the far wall and bleeding pale spirit light into the chamber',
    mood: 'enclosed, echoing and cool, the fissure is the only light source, dramatic dark rock masses',
  },
  {
    id: 'bg/tribulation',
    subject:
      'a violent churning mass of black storm cloud pressing down on a lone dark peak, one jagged bolt of gold and vermilion lightning tearing from the cloud to the summit',
    mood: 'apocalyptic and heavy, wild wet ink splashes for the cloud, the lightning is the only bright element',
  },
  {
    id: 'bg/login',
    subject:
      'a single tiny fishing boat on wide still water in the lower third of the frame, one distant solitary peak faintly suggested near the horizon, everything else bare paper',
    mood: 'extremely minimal and quiet, dawn haze, almost entirely empty',
    compositionOverride:
      'vertical 9:16 portrait format; the entire top two thirds of the frame is empty untouched paper reserved for a game title, ' +
      'the small boat and its faint water lines sit low in the frame around the 70 percent height mark, ' +
      'the bottom quarter stays pale and uncluttered for buttons; extreme negative space is the point of this image',
  },

  // --- npc (8) -------------------------------------------------------------
  {
    id: 'npc/zhangmen',
    subject:
      'an elderly Daoist sect grandmaster with a long flowing white beard and white topknot, wearing a pale crane-embroidered robe, holding a horsehair whisk against his shoulder, benevolent and unhurried expression',
  },
  {
    id: 'npc/zhanglao',
    subject:
      'a stern middle-aged Daoist elder with heavy black brows and a short beard, wearing a dark indigo Daoist robe, mouth set hard, severe and judging expression',
  },
  {
    id: 'npc/yaowang',
    subject:
      'a hunchbacked old herb-gathering hermit with a wispy beard and weathered face, a woven medicine basket on his back and a bottle gourd hanging at his chest, sly kindly squint',
  },
  {
    id: 'npc/shangren',
    subject:
      'a plump round-faced merchant with a thin moustache and a small cap, wearing a patterned brocade robe, holding an abacus at chest height, broad ingratiating smile',
  },
  {
    id: 'npc/laozhe',
    subject:
      'a mysterious old man whose face is almost entirely hidden in the shadow of a wide woven bamboo hat, wearing a ragged straw rain cape over his shoulders, only a hint of jaw and beard visible',
  },
  {
    id: 'npc/tiejiang',
    subject:
      'a burly bare-chested blacksmith with thick arms and a full beard, wearing a heavy scorched leather apron, a forging hammer resting on his shoulder, soot on his skin, direct steady gaze',
  },
  {
    id: 'npc/xianzi',
    subject:
      'a graceful young female cultivator in flowing plain white silk robes, dark hair dressed with a blue-green phoenix feather ornament, calm composed expression, faint ribbon of silk lifting near her shoulder',
  },
  {
    id: 'npc/zhenshou',
    subject:
      'a young male sect disciple in a neat indigo-trimmed uniform robe, hair in a simple topknot, a straight sword held upright with the blade beside his shoulder, alert dutiful expression',
  },

  // --- avatar (16) ---------------------------------------------------------
  { id: 'avatar/m01', subject: 'a young male sword cultivator with hair bound in a high topknot, plain pale robe, sharp cold aloof expression, faint sword-guard visible at his shoulder' },
  { id: 'avatar/m02', subject: 'a cheerful boy Daoist acolyte around twelve with two small side buns, simple grey robe, bright open smile' },
  { id: 'avatar/m03', subject: 'a middle-aged scholarly cultivator wearing a soft square scholar cap and a wide-sleeved robe, thin beard, thoughtful mild expression' },
  { id: 'avatar/m04', subject: 'a demonic-path cultivator in a black high-collared robe, a pale scar running down the left half of his face, dark hair loose, cruel narrow eyes' },
  { id: 'avatar/m05', subject: 'a shaven-headed Buddhist monk cultivator in a plain kasaya robe, a string of prayer beads around his neck, eyes half closed in serenity' },
  { id: 'avatar/m06', subject: 'an old wandering rogue cultivator with long loose white hair and beard drifting in the wind, worn open robe, wild carefree grin' },
  { id: 'avatar/m07', subject: 'a teenage wandering swordsman under a tilted woven bamboo travelling hat, short travel jacket, cocky half smile, face still clearly visible under the brim' },
  { id: 'avatar/m08', subject: 'a young man of royal bearing wearing an antique gold coronet over dressed hair, richly patterned collar, proud level gaze' },
  { id: 'avatar/f01', subject: 'a young female sword cultivator with a high ponytail, practical fitted robe with a sword strap across the chest, spirited confident expression' },
  { id: 'avatar/f02', subject: 'a gentle young healer woman with softly pinned hair, a small embroidered medicine pouch at her shoulder, warm caring expression' },
  { id: 'avatar/f03', subject: 'an alluring demonic-path woman in a flowing vermilion red robe, long loose black hair, a dangerous knowing smile' },
  { id: 'avatar/f04', subject: 'a serene Daoist nun in a plain undyed robe and simple wooden hairpin crown, no ornament, detached tranquil expression' },
  { id: 'avatar/f05', subject: 'a lively young girl cultivator with hair in two round buns, light simple robe, mischievous bright eyes' },
  { id: 'avatar/f06', subject: 'a female general in layered lamellar armour with pauldrons, hair bound back tightly, resolute battle-hardened stare' },
  { id: 'avatar/f07', subject: 'a female zither cultivator holding a long guqin upright against her shoulder, elegant draped sleeves, quiet absorbed expression' },
  { id: 'avatar/f08', subject: 'an icy beautiful female cultivator with the lower half of her face behind a thin gauze veil, ornate hairpin, cold distant eyes' },

  // --- char (2) -----------------------------------------------------------
  {
    id: 'char/meditate-m',
    subject:
      'a male cultivator seated cross-legged in deep meditation, wide-sleeved plain daoist robe stirring slightly as if in a mountain breeze, hair bound high with a long ribbon that drifts to one side, eyes closed, hands folded in a mudra at the lap, serene and still',
    mood: 'soft even daylight, calm, weightless',
  },
  {
    id: 'char/meditate-f',
    subject:
      'a female cultivator seated cross-legged in deep meditation, long loose hair and a plain pale robe with wide sleeves drifting slightly as if in a mountain breeze, eyes closed, hands folded in a mudra at the lap, serene and still',
    mood: 'soft even daylight, calm, weightless',
  },
  // --- monster (8) ---------------------------------------------------------
  { id: 'monster/qingyun-wolf', subject: 'a lean blue-grey mountain wolf standing braced on all fours, hackles raised, pale spirit light glinting in its eyes, ink-splash fur texture' },
  { id: 'monster/spirit-ape', subject: 'a heavy-shouldered spirit ape standing upright on two legs, clutching a gnarled peachwood staff, thick shaggy ink-brushed coat, wary intelligent eyes' },
  { id: 'monster/luoshui-flood-dragon', subject: 'a serpentine river flood-dragon rearing its horned head and neck up out of churning water, whiskers streaming, coils half submerged, scales suggested with dry-brush strokes' },
  { id: 'monster/river-bandit', subject: 'a masked river-pirate cultivator standing in a fighting stance, cloth mask over the lower face, ragged short jacket, a curved sabre held low' },
  { id: 'monster/ghost-lantern', subject: 'a gaunt hollow-eyed ghost in tattered trailing robes drifting just above the ground, holding up a small paper lantern with a pale cold flame, its lower body dissolving into mist' },
  { id: 'monster/bone-general', subject: 'a skeletal warlord standing tall in shattered rusted lamellar armour, empty eye sockets, a broken halberd gripped in one bony hand, tattered war cape' },
  { id: 'monster/ice-qilin', subject: 'a qilin standing proud, its scaled hide rendered as pale translucent ice crystal, antler-like horns, a mane of frozen spines, cold breath curling from its muzzle' },
  { id: 'monster/golden-crow', subject: 'a three-legged golden crow with wings spread wide, wreathed in swirling ink-drawn flame, antique gold plumage accents, fierce sun-bird bearing' },

  // --- boss (4) ------------------------------------------------------------
  { id: 'boss/qingyun-tiger-king', subject: 'a colossal white tiger king mid-stride with head lowered and jaws parting in a roar, bold black stripe strokes laid over white fur, immense muscular shoulders' },
  { id: 'boss/luoshui-dragon-lord', subject: 'a humanoid dragon lord standing in imperial river-court robes, a horned draconic head with whiskers above the human-shaped body, clawed hands, water swirling at the hem' },
  { id: 'boss/youming-ghost-emperor', subject: 'a towering ghost emperor in dark funerary court robes wearing a flat-topped crown with hanging bead strings partly veiling a fleshless face, arms folded into wide sleeves' },
  { id: 'boss/kunlun-heaven-beast', subject: 'a monstrous nine-headed divine beast, nine serpentine necks fanning out from one massive four-legged body, each head snarling in a different direction' },

  // --- item: pills (8) -----------------------------------------------------
  { id: 'item/pill-qi', subject: 'a single round polished elixir pill with a faint pale-blue sheen and a thin curl of spirit vapour rising from it' },
  { id: 'item/pill-foundation', subject: 'a single round earth-brown elixir pill with a dense granular surface and a faint gold flake pressed into it' },
  { id: 'item/pill-breakthrough', subject: 'a single round elixir pill in deep vermilion with a hairline crack of gold light across its surface' },
  { id: 'item/pill-heal', subject: 'a single round jade-green elixir pill with one small fresh leaf still stuck to its side' },
  { id: 'item/pill-spirit', subject: 'a single round pale indigo elixir pill, perfectly smooth, with a soft cool halo of wash around its rim' },
  { id: 'item/pill-power', subject: 'a single large knobbly dark-red elixir pill with a raised dragon-scale texture over its surface' },
  { id: 'item/pill-golden-core', subject: 'a single round elixir pill of solid antique gold with a swirling nebula pattern turning inside it' },
  { id: 'item/pill-enlightenment', subject: 'a single round translucent pearl-white elixir pill with a tiny ink landscape faintly suspended inside it' },

  // --- item: materials (8) -------------------------------------------------
  { id: 'item/mat-spirit-herb', subject: 'a single freshly pulled spirit herb: three slender leaves on one stem with the pale root and root hairs still attached' },
  { id: 'item/mat-iron-essence', subject: 'a single rough chunk of dark black-iron ore with sharp fractured faces and a cold metallic sheen along the edges' },
  { id: 'item/mat-beast-core', subject: 'a single smooth spherical beast core the size of an egg, dark translucent amber, with a faint spark of light at its centre' },
  { id: 'item/mat-spirit-stone', subject: 'a single hexagonal prismatic crystal of pale blue-green spirit stone, faceted and slightly translucent' },
  { id: 'item/mat-jade', subject: 'a single carved oval tablet of pale green jade with a soft waxy surface and one subtle vein running through it' },
  { id: 'item/mat-soul-crystal', subject: 'a single sharp-tipped violet-grey soul crystal shard with a wisp of pale vapour trapped inside it' },
  { id: 'item/mat-cloud-silk', subject: 'a single loosely coiled skein of gossamer cloud-pattern silk thread, its loose end lifting weightlessly' },
  { id: 'item/mat-thunder-wood', subject: 'a single short length of lightning-struck timber, blackened and split down the middle, with charred fibres along the fracture' },

  // --- item: treasures (4) -------------------------------------------------
  { id: 'item/treasure-sword', subject: 'a single straight Chinese jian sword shown diagonally, slender blue-grey blade, wrapped grip and a simple cross guard, tassel hanging from the pommel' },
  { id: 'item/treasure-bell', subject: 'a single small bronze hand bell with a ring handle, an aged green patina and abstract non-readable relief markings on its skirt' },
  { id: 'item/treasure-fan', subject: 'a single folding fan opened about two thirds, dark bamboo ribs and a pale paper leaf carrying a faint wash of cloud, no writing on it' },
  { id: 'item/treasure-seal', subject: 'a single heavy square stone seal standing upright, a small crouching beast carved as its knob, faint vermilion pigment on the base edge' },

  // --- item: robes (4) -----------------------------------------------------
  { id: 'item/robe-linen', subject: 'a single plain coarse hemp robe laid out flat and neatly folded at the sleeves, undyed oatmeal colour, visibly rough weave and one small patch' },
  { id: 'item/robe-daoist', subject: 'a single Daoist robe laid out flat with wide sleeves spread, pale grey cloth with dark indigo trim at the collar and cuffs' },
  { id: 'item/robe-cloud', subject: 'a single flowing cultivator robe laid out flat with wide sleeves spread, pale silk with a drifting cloud pattern woven across it and trailing sash ends' },
  { id: 'item/robe-golden', subject: 'a single resplendent immortal robe laid out flat with wide sleeves spread, antique gold silk with vermilion trim and a faint radiant sheen along the folds' },

  // --- item: accessories (3) -----------------------------------------------
  { id: 'item/acc-jade-pendant', subject: 'a single flat ring-shaped pale green jade pendant hanging from a knotted silk cord with a short tassel' },
  { id: 'item/acc-prayer-beads', subject: 'a single closed loop of dark bodhi-seed prayer beads lying in a neat coil with one larger head bead and a short tassel' },
  { id: 'item/acc-talisman', subject: 'a single narrow yellow paper protection talisman with abstract non-readable vermilion brush marks running down it, one end slightly curled' },

  // --- item: pets (3) ------------------------------------------------------
  { id: 'item/pet-crane', subject: 'a single red-crowned crane standing on one leg with its neck curved back, white plumage in dry-brush strokes, black wing tips, a small vermilion crown patch' },
  { id: 'item/pet-fox', subject: 'a single small spirit fox sitting upright with three fluffy tails curled around its paws, alert pointed ears, pale russet ink wash' },
  { id: 'item/pet-turtle', subject: 'a single dark tortoise seen from a three-quarter front angle, a heavily patterned domed shell and a wise wrinkled head extended forward' },

  // --- ui (4) --------------------------------------------------------------
  {
    id: 'ui/cloud-pattern',
    request: '1536x512',
    out: [1024, 256],
    subject:
      'a long horizontal band of stylised auspicious ruyi cloud scroll motif, the same rolling spiral cloud unit repeating across the full width so the strip could tile seamlessly left to right',
    compositionOverride:
      'wide horizontal strip; the cloud band is one continuous ribbon centred vertically and running the entire width edge to edge, ' +
      'the space above and below the ribbon is completely empty and transparent, the left and right ends are cut mid-motif so the strip can repeat',
    mood: 'flat decorative, even weight across the whole strip, no focal point',
  },
  {
    id: 'ui/seal-red',
    request: '1024x1024',
    out: [256, 256],
    subject:
      'a single square vermilion seal impression stamped on nothing, the block of red carrying abstract angular seal-script-like marks that are deliberately not real readable characters, with the uneven ink-starved edges and small voids of a hand-pressed chop',
    compositionOverride:
      'square format; the seal impression is centred and fills about 75 percent of the frame; everything outside the red impression is fully transparent',
    mood: 'flat stamped pigment, slightly rough and uneven, no lighting',
  },
  {
    id: 'ui/scroll-bg',
    request: '1008x1344',
    out: [768, 1024],
    subject:
      'a vertical hanging scroll of blank xuan rice paper with a wooden roller bar across the top and another across the bottom, the paper surface warm and faintly fibrous and completely unpainted',
    compositionOverride:
      'vertical 3:4 format; the scroll runs the full height, centred, with its two roller bars at the very top and very bottom; ' +
      'the paper field between them is entirely empty because UI content is drawn over it; the narrow margins to the left and right of the scroll are fully transparent',
    mood: 'flat and even, no strong lighting, no shadow under the scroll',
    alphaOptional: true,
  },
  {
    id: 'ui/ink-splash',
    request: '1024x1024',
    out: [512, 512],
    subject:
      'a single loose blot of black ink dropped on wet paper: one dense dark core with feathered bleeding edges, a few flung droplets and one dry-brush drag tailing off to the side',
    compositionOverride:
      'square format; the blot is roughly centred and fills about 70 percent of the frame; everything not touched by ink is fully transparent',
    mood: 'raw wet ink on damp paper, high contrast between the dense core and the pale bleed',
  },
];

/** 'bg/cultivation-day' -> 'bg--cultivation-day' (spec + raw filenames). */
export const flat = (id) => id.replace(/\//g, '--');

/** Category rules + per-asset overrides resolved into one object. */
export function resolve(asset) {
  const cat = asset.id.split('/')[0];
  const base = CATEGORIES[cat];
  if (!base) throw new Error(`unknown category for ${asset.id}`);
  const out = asset.out ?? base.out;
  if (!out) throw new Error(`no output size for ${asset.id}`);
  return {
    ...asset,
    cat,
    base,
    request: asset.request ?? base.request,
    out,
    small: asset.small ?? base.small ?? null,
    alpha: asset.alpha ?? base.alpha,
    flat: flat(asset.id),
  };
}

export const RESOLVED = ASSETS.map(resolve);
