using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine.UIElements;

namespace Qingyun
{
    public sealed partial class GameUi
    {
        // Reviewed official partial UI: TapTap 319422586373014969 (2022-09-15 test-server
        // skill tiles), 243367722686089051 (2022-02-17 selected-title slots), and
        // 646662775375924488 (2025-03-06 item/settings dialogs). Columns and the existing
        // four skill/equipment slots below are Qingyun choices, not claimed official slot counts.
        string characterTab = "stats";
        string bagFilter = "all";
        string bagSelectedUid;
        VisualElement bagItemGrid;
        readonly string[] characterStatKeys = { "hp", "atk", "def", "spd", "crit", "critResist", "acc", "eva" };
        readonly string[] characterStatNames = { "气血", "攻击", "防御", "速度", "暴击", "抗暴", "命中", "闪避" };
        readonly string[] bagSlots = { "treasure", "robe", "accessory", "pet" };

        void RenderCharacter()
        {
            Heading("己身", "一身修为，皆有来处");
            if (!CharacterReady()) return;
            var tabs = Row(content);
            foreach (var tab in new[] { new[] { "stats", "资质" }, new[] { "techniques", "功法" }, new[] { "skills", "神通" } })
            {
                var id = tab[0];
                Button(tabs, tab[1], () => { characterTab = id; Rebuild(); }, true, characterTab == id ? "primary" : "secondary");
            }
            if (characterTab == "techniques") CharacterTechniques();
            else if (characterTab == "skills") CharacterSkills();
            else CharacterStats();
        }

        bool CharacterReady()
        {
            if (app.CharacterView?["character"] is JObject) return true;
            Text(content, "角色资料尚未载入。", "muted");
            Button(content, "重新读取", app.RefreshCharacter, !app.Busy);
            return false;
        }

        void CharacterStats()
        {
            var ch = app.Character;
            var view = app.CharacterView;
            var identity = Card(content, (string)ch["name"]);
            identity.AddToClassList("character-identity");
            var portrait = Row(identity);
            Art(portrait, (string)ch["avatarArt"], 80);
            var bio = new VisualElement();
            bio.style.flexGrow = 1;
            portrait.Add(bio);
            Text(bio, (string)view["stageName"], "section-title");
            var root = ch["spiritRoot"];
            string quality = (string)root?["quality"];
            Text(bio, CharacterElement((string)root?["element"]) + " · " + (quality == "heaven" ? "天灵根" : quality == "rare" ? "异灵根" : "凡灵根"));
            Text(bio, "战力 " + CharacterNumber(ch["powerScore"]) + "　声望 " + CharacterNumber(ch["prestige"]));
            Meter(identity, (float?)ch["hpPercent"] ?? 0, "当前气血 " + ((double?)ch["hpPercent"] ?? 0).ToString("P1"));
            Text(identity, "修为 " + CharacterNumber(ch["exp"]) + " / " + CharacterNumber(view["expRequired"]));
            Text(identity, "修炼速度 " + CharacterNumber(view["ratePerSec"]) + " / 秒", "muted");
            var stats = Card(content, "八相 · 当前实际属性");
            Text(stats, "装备与养成加成已计入。", "muted");
            var statGrid = CharacterGrid(stats, "character-stat-grid");
            for (int i = 0; i < characterStatKeys.Length; i++)
            {
                var cell = Row(statGrid, "character-stat-cell");
                cell.style.width = Length.Percent(48);
                cell.style.flexDirection = FlexDirection.Row;
                cell.style.justifyContent = Justify.SpaceBetween;
                Text(cell, characterStatNames[i], "muted");
                Text(cell, CharacterStat(characterStatKeys[i], view["stats"]?[characterStatKeys[i]]), "section-title");
            }
            var study = Card(content, "修行与装备");
            string technique = (string)ch["techniqueId"];
            Text(study, "正修功法：" + (string.IsNullOrEmpty(technique) ? "尚未选择" : app.Catalog.Name("techniques", technique)));
            Button(study, "查看随身装备", () => app.Navigate("bag"));
            Button(study, "法宝养成", () => app.Navigate("treasures"));
            var buffs = ch["buffs"] as JArray;
            if (buffs != null && buffs.Count > 0)
            {
                var list = Card(content, "服药增益");
                foreach (var buff in buffs)
                {
                    Text(list, app.Catalog.Name("items", (string)buff["itemId"]) + "　截止 " + DateTimeOffset.FromUnixTimeMilliseconds((long?)buff["expiresAt"] ?? 0).ToLocalTime().ToString("MM-dd HH:mm:ss"));
                    if (buff["stats"] is JObject bonus) CharacterBonus(list, bonus, true);
                    else Text(list, "修炼 +" + ((double?)buff["bonus"] ?? 0).ToString("P0"), "small");
                }
            }
        }

        void CharacterTechniques()
        {
            Text(content, "择一功法修行；参悟后可改修，效果以当前人物属性为准。", "muted");
            var techniques = app.Catalog.Table("techniques");
            if (techniques.Count == 0) Text(content, "功法资料暂不可用。", "muted");
            var grid = CharacterGrid(content, "character-study-grid");
            foreach (JObject technique in techniques)
            {
                var card = Card(grid, (string)technique["name"]);
                card.AddToClassList("character-study-tile");
                card.AddToClassList(BagRarity((string)technique["grade"]));
                card.style.width = Length.Percent(48);
                Text(card, BagGrade((string)technique["grade"]) + " · 修炼 +" + ((double?)technique["cultivationBonus"] ?? 0).ToString("P0"), "small");
                CharacterTechniqueAction(card, technique);
                Button(card, "功法详情", () => ShowSheet((string)technique["name"], parent => CharacterTechniqueDetail(parent, technique)));
            }
        }

        void CharacterTechniqueAction(VisualElement parent, JObject technique)
        {
            string id = (string)technique["id"];
            if ((string)app.Character["techniqueId"] == id) Text(parent, "正修", "section-title");
            else if (CharacterHas("learnedTechniqueIds", id)) Button(parent, "改修此功法", () => app.Command("character.setTechnique", new JObject { ["techniqueId"] = id }), !app.Busy);
            else CharacterLearn(parent, technique, "requiredStage", "character.learnTechnique", "techniqueId");
        }

        void CharacterTechniqueDetail(VisualElement parent, JObject technique)
        {
            var card = Card(parent, (string)technique["name"] + " · " + BagGrade((string)technique["grade"]));
            Text(card, (string)technique["description"]);
            Text(card, "修炼速度 +" + ((double?)technique["cultivationBonus"] ?? 0).ToString("P0"));
            CharacterBonus(card, technique["percent"] as JObject, true);
            if ((double?)technique["elementAffinity"] > 0)
                Text(card, CharacterElement((string)technique["element"]) + "系神通伤害 +" + ((double)technique["elementAffinity"]).ToString("P0"));
            CharacterTechniqueAction(card, technique);
        }

        void CharacterSkills()
        {
            var equipped = Card(content, "神通装配");
            Text(equipped, "按槽位顺序择可施展神通；冷却与灵力共同决定实际施法。", "muted");
            var slots = app.Character["skillSlots"] as JArray;
            var slotGrid = CharacterGrid(equipped, "character-slot-grid");
            for (int index = 0; index < 4; index++)
            {
                int slot = index;
                string id = slots != null && slots.Count > index ? (string)slots[index] : null;
                var button = Button(slotGrid, "第 " + (slot + 1) + " 槽 · " + (string.IsNullOrEmpty(id) ? "空槽" : app.Catalog.Name("skills", id)), () => ShowSheet("装配第 " + (slot + 1) + " 槽", parent => CharacterSlot(parent, slot)));
                button.AddToClassList("character-slot-button");
                button.style.width = Length.Percent(23);
                button.style.minHeight = 72;
                button.style.marginRight = 0;
            }
            var skills = app.Catalog.Table("skills");
            if (skills.Count == 0) Text(content, "神通资料暂不可用。", "muted");
            var grid = CharacterGrid(content, "character-study-grid");
            foreach (JObject skill in skills)
            {
                var id = (string)skill["id"];
                var card = Card(grid, (string)skill["name"]);
                card.AddToClassList("character-study-tile");
                card.style.width = Length.Percent(48);
                CharacterSkillMark(card, skill);
                Text(card, CharacterElement((string)skill["element"]) + " · " + skill["tier"] + "层 · 灵力 " + skill["manaCost"] + " / 冷却 " + skill["cooldown"], "small");
                int equippedAt = slots == null ? -1 : slots.ToList().FindIndex(value => (string)value == id);
                if (CharacterHas("learnedSkillIds", id)) Text(card, equippedAt >= 0 ? "已装第 " + (equippedAt + 1) + " 槽" : "已习得 · 可装配", "muted");
                else CharacterLearn(card, skill, "unlockStage", "character.learnSkill", "skillId");
                Button(card, "神通详情", () => ShowSheet((string)skill["name"], parent =>
                {
                    var detail = Card(parent, (string)skill["name"]);
                    CharacterSkillDescription(detail, skill);
                    if (!CharacterHas("learnedSkillIds", id)) CharacterLearn(detail, skill, "unlockStage", "character.learnSkill", "skillId");
                    else Text(detail, "已习得 · 在神通装配区选择槽位", "muted");
                }));
            }
        }

        void CharacterSkillDescription(VisualElement parent, JObject skill)
        {
            Text(parent, (string)skill["description"]);
            Text(parent, "灵力 " + skill["manaCost"] + " · 冷却 " + skill["cooldown"] + " 回合", "muted");
            string type = (string)skill["type"];
            string target = (string)skill["target"];
            Text(parent, "目标：" + (target == "all_enemies" ? "敌方全体" : target == "self" ? "自身" : target == "ally" ? "友方" : "敌方单体"), "small");
            if (type == "damage" || type == "heal" || (type == "debuff" && ((double?)skill["power"] ?? 0) > 0))
                Text(parent, (type == "heal" ? "治疗" : "伤害") + "系数 " + skill["power"], "small");
            if (skill["modifier"] is JObject modifier)
            {
                if (type != "buff" && type != "debuff") Text(parent, "附加词条（当前回合战尚未生效）", "muted");
                CharacterBonus(parent, modifier["stats"] as JObject, true);
                Text(parent, "持续 " + modifier["durationRounds"] + " 回合", "small");
            }
        }

        void CharacterSkillMark(VisualElement parent, JObject skill)
        {
            // Native element seals keep skills identifiable without substituting unrelated artwork.
            var mark = Text(parent, CharacterElement((string)skill["element"]), "skill-mark");
            mark.AddToClassList("skill-mark-" + (string)skill["element"]);
        }

        void CharacterSlot(VisualElement parent, int slot)
        {
            var learned = app.Character?["learnedSkillIds"] as JArray;
            if (learned == null || learned.Count == 0) Text(parent, "尚未习得神通，请先参悟。", "muted");
            var grid = CharacterGrid(parent, "character-study-grid");
            foreach (var token in learned ?? new JArray())
            {
                string id = (string)token;
                var skill = app.Catalog.Find("skills", id);
                if (skill == null) continue;
                var card = Card(grid, (string)skill["name"]);
                card.AddToClassList("character-study-tile");
                card.style.width = Length.Percent(48);
                CharacterSkillMark(card, skill);
                Text(card, CharacterElement((string)skill["element"]) + " · 灵力 " + skill["manaCost"] + " / 冷却 " + skill["cooldown"], "small");
                Text(card, (string)skill["description"], "small");
                var currentSlots = app.Character["skillSlots"] as JArray;
                int at = currentSlots == null ? -1 : currentSlots.ToList().FindIndex(value => (string)value == id);
                Button(card, at < 0 ? "装入此槽" : "从第 " + (at + 1) + " 槽移至此槽", () => CharacterAssign(slot, id), !app.Busy);
            }
            Button(parent, "清空此槽", () => CharacterAssign(slot, null), !app.Busy);
        }

        void CharacterAssign(int slot, string id)
        {
            var current = app.Character?["skillSlots"] as JArray;
            if (current == null || current.Count != 4 || slot < 0 || slot >= 4)
            {
                app.Notice("神通装配资料不完整，请重新读取角色。");
                return;
            }
            var slots = CharacterMoveSkill(current, slot, id);
            app.Command("character.equipSkills", new JObject { ["slots"] = slots }, _ => CloseSheet());
        }

        // Duplicate skills move instead of occupying two slots. Used by the runtime and self-check.
        static JArray CharacterMoveSkill(JArray current, int slot, string id)
        {
            var slots = (JArray)current.DeepClone();
            for (int i = 0; i < slots.Count; i++)
                if (id != null && (string)slots[i] == id) slots[i] = JValue.CreateNull();
            slots[slot] = id == null ? JValue.CreateNull() : new JValue(id);
            return slots;
        }

        [UnityEngine.ContextMenu("Check character skill slot movement")]
        void CharacterCheckSlotMovement()
        {
            var initial = new JArray("a", "b", null, "c");
            var moved = CharacterMoveSkill(initial, 2, "a");
            UnityEngine.Assertions.Assert.IsTrue(moved.Count == 4 && moved[0].Type == JTokenType.Null && (string)moved[2] == "a" && (string)initial[0] == "a");
            UnityEngine.Assertions.Assert.IsTrue(CharacterMoveSkill(moved, 2, null)[2].Type == JTokenType.Null);
        }

        void CharacterLearn(VisualElement parent, JObject definition, string stageKey, string route, string idKey)
        {
            int required = (int?)definition[stageKey] ?? 0;
            long cost = (long?)definition["learnCost"] ?? 0;
            bool stageReady = ((int?)app.Character["stageIndex"] ?? 0) >= required;
            bool affordable = ((long?)app.Character["spiritStones"] ?? 0) >= cost;
            Text(parent, "需 " + CharacterStage(required) + " · 参悟 " + cost.ToString("N0") + " 灵石", "muted");
            if (!stageReady) Text(parent, "境界未达", "muted");
            else if (!affordable) Text(parent, "灵石不足，尚缺 " + (cost - ((long?)app.Character["spiritStones"] ?? 0)).ToString("N0"), "muted");
            string id = (string)definition["id"];
            Button(parent, "参悟", () => app.Command(route, new JObject { [idKey] = id }), stageReady && affordable && !app.Busy);
        }

        void RenderBag()
        {
            Heading("行囊", "随身之物，修行所用");
            if (!CharacterReady()) return;
            var inventory = app.CharacterView["inventory"] as JArray;
            if (inventory == null)
            {
                Text(content, "行囊资料尚未载入。", "muted");
                Button(content, "重新读取", app.RefreshCharacter, !app.Busy);
                return;
            }
            var equipment = Card(content, "随身装备");
            var equipmentGrid = CharacterGrid(equipment, "bag-equipment-grid");
            foreach (string slot in bagSlots)
            {
                string uid = (string)app.Character["equipment"]?[slot];
                var row = inventory.OfType<JObject>().FirstOrDefault(item => (string)item["uid"] == uid);
                var definition = row == null ? null : app.Catalog.Find("items", (string)row["itemId"]);
                var cell = Card(equipmentGrid);
                cell.AddToClassList("bag-equipment-slot");
                cell.style.width = Length.Percent(23);
                Text(cell, BagSlotName(slot), "small");
                if (definition != null) Art(cell, (string)definition["art"], 44).style.alignSelf = Align.Center;
                if (row == null) Text(cell, "未着", "muted");
                else
                {
                    cell.AddToClassList(BagRarity((string)definition?["grade"]));
                    Button(cell, BagSlotName(slot) + " · " + ((string)definition?["name"] ?? (string)row["itemId"]), () => BagOpen(uid)).AddToClassList("bag-item-action");
                }
            }
            var tabs = Row(content);
            foreach (var entry in new[] { new[] { "all", "全部" }, new[] { "equipment", "装备" }, new[] { "pill", "丹药" }, new[] { "material", "材料" } })
            {
                string kind = entry[0];
                Button(tabs, entry[1], () => { bagFilter = kind; Rebuild(); }, true, bagFilter == kind ? "primary" : "secondary");
            }
            var filtered = inventory.OfType<JObject>().Where(row => bagFilter == "all" || (string)app.Catalog.Find("items", (string)row["itemId"])?["kind"] == bagFilter).ToList();
            Text(content, "共 " + inventory.Count + " 格 · 当前分类 " + filtered.Count + " 格", "muted");
            if (filtered.Count == 0) Text(content, "此处暂空。探索山野或前往坊市，可得修行所需。", "muted");
            bagItemGrid = CharacterGrid(content, "bag-item-grid");
            foreach (var item in filtered)
            {
                var definition = app.Catalog.Find("items", (string)item["itemId"]);
                string uid = (string)item["uid"];
                var card = Card(bagItemGrid);
                card.AddToClassList("bag-item-tile");
                card.style.width = Length.Percent(23);
                card.userData = uid;
                card.EnableInClassList("bag-selected", bagSelectedUid == uid);
                if (definition != null) card.AddToClassList(BagRarity((string)definition["grade"]));
                if (definition != null) Art(card, (string)definition["art"], 48).style.alignSelf = Align.Center;
                Text(card, ((string)definition?["name"] ?? (string)item["itemId"]) + " ×" + item["qty"], "bag-item-name");
                Text(card, BagGrade((string)definition?["grade"]) + ((bool?)item["equipped"] == true ? " · 已穿戴" : ""), "bag-item-meta");
                var detail = Button(card, "查看详情", () => BagOpen(uid));
                detail.AddToClassList("bag-item-action");
                detail.tooltip = ((string)definition?["name"] ?? (string)item["itemId"]) + "，拥有 " + item["qty"] + " 件";
            }
            Button(content, "前往坊市购买 / 回收", () => app.Navigate("town"));
        }

        void BagOpen(string uid)
        {
            bagSelectedUid = uid;
            if (bagItemGrid != null)
                foreach (var tile in bagItemGrid.Children()) tile.EnableInClassList("bag-selected", (string)tile.userData == uid);
            ShowSheet("物品详情", parent => BagDetails(parent, uid));
        }

        void BagDetails(VisualElement parent, string uid)
        {
            var inventory = app.CharacterView?["inventory"] as JArray;
            var row = inventory?.OfType<JObject>().FirstOrDefault(item => (string)item["uid"] == uid);
            if (row == null || ((int?)row["qty"] ?? 0) <= 0)
            {
                Text(parent, "此物品已不在行囊中。", "muted");
                return;
            }
            var item = app.Catalog.Find("items", (string)row["itemId"]);
            if (item == null) { Text(parent, "物品资料暂不可用：" + row["itemId"], "muted"); return; }
            var heading = Row(parent, "bag-detail-heading");
            heading.style.flexDirection = FlexDirection.Row;
            heading.style.alignItems = Align.Center;
            Art(heading, (string)item["art"], 68);
            var info = new VisualElement(); info.style.flexGrow = 1; info.style.flexShrink = 1; heading.Add(info);
            Text(info, (string)item["name"] + " · " + BagGrade((string)item["grade"]), "section-title");
            Text(info, "拥有 " + row["qty"] + " 件" + ((bool?)row["equipped"] == true ? " · 已穿戴" : ""), "muted");
            Text(parent, (string)item["description"]);
            int qty = (int)row["qty"];
            string kind = (string)item["kind"];
            if (kind == "equipment")
            {
                string slot = (string)item["slot"];
                int required = (int?)item["requiredStage"] ?? 0;
                Text(parent, BagSlotName(slot) + " · 需 " + CharacterStage(required));
                string wornUid = (string)app.Character["equipment"]?[slot];
                var wornRow = inventory.OfType<JObject>().FirstOrDefault(entry => (string)entry["uid"] == wornUid);
                var worn = wornRow == null ? null : app.Catalog.Find("items", (string)wornRow["itemId"]);
                BagCompare(parent, item, worn);
                bool equipped = wornUid == uid;
                if (equipped) Button(parent, "卸下", () => app.Command("inventory.unequip", new JObject { ["slot"] = slot }), !app.Busy);
                else
                {
                    bool ready = ((int?)app.Character["stageIndex"] ?? 0) >= required;
                    if (!ready) Text(parent, "境界未达，暂不能穿戴。", "muted");
                    Button(parent, worn == null ? "穿戴" : "替换当前装备", () => app.Command("inventory.equip", new JObject { ["uid"] = uid }), ready && !app.Busy);
                }
            }
            else if (kind == "pill")
            {
                string effect = (string)item["effect"]?["type"];
                if (effect == "breakthrough_aid")
                {
                    Text(parent, "冲击大境界时选择用量，此处不能直接服用。", "muted");
                    Button(parent, "返回洞府突破", () => { CloseSheet(); app.Navigate("home"); });
                }
                else
                {
                    if (effect == "unlock_skill_slot")
                        Text(parent, "当前此丹仅有服用反馈，尚不增加战斗属性或神通槽位；服用仍会消耗道具。", "muted");
                    var amount = Field(parent, "bag-qty-" + uid, "服用数量（1–" + Math.Min(qty, 99) + "）", false, "1");
                    Button(parent, "确认服用", () =>
                    {
                        if (!int.TryParse(amount.value, out int count) || count < 1 || count > Math.Min(qty, 99))
                        { app.Notice("请输入 1 至 " + Math.Min(qty, 99) + " 的整数。"); return; }
                        app.Command("inventory.use", new JObject { ["uid"] = uid, ["qty"] = count }, result => app.Notice((string)result["message"] ?? "服用完成"));
                    }, !app.Busy);
                }
            }
            else Text(parent, "材料可用于现有任务交付或商店回收。", "muted");
            if (((long?)item["sellPrice"] ?? 0) > 0)
                Button(parent, "前往城镇选择商人回收", () => { CloseSheet(); app.Navigate("town"); });
        }

        void BagCompare(VisualElement parent, JObject item, JObject worn)
        {
            var card = Card(parent, "装备属性对照");
            Text(card, "此件 / 当前：" + item["name"] + " / " + ((string)worn?["name"] ?? "未着"));
            Text(card, "以下为装备基础词条，品质另列；最终属性穿戴后由人物页显示。", "muted");
            Text(card, "品质　" + BagGrade((string)item["grade"]) + " / " + BagGrade((string)worn?["grade"]));
            bool any = false;
            for (int i = 0; i < characterStatKeys.Length; i++)
            {
                string key = characterStatKeys[i];
                foreach (string block in new[] { "flat", "percent" })
                {
                    double a = (double?)item[block]?[key] ?? 0;
                    double b = (double?)worn?[block]?[key] ?? 0;
                    if (a == 0 && b == 0) continue;
                    any = true;
                    string first = block == "percent" ? a.ToString("P1") : CharacterStat(key, new JValue(a));
                    string second = block == "percent" ? b.ToString("P1") : CharacterStat(key, new JValue(b));
                    Text(card, characterStatNames[i] + (block == "percent" ? " 比例　" : " 固定　") + first + " / " + second);
                }
            }
            if (!any) Text(card, "无额外属性。", "muted");
        }

        void CharacterBonus(VisualElement parent, JObject stats, bool percent)
        {
            if (stats == null) return;
            for (int i = 0; i < characterStatKeys.Length; i++)
            {
                string key = characterStatKeys[i];
                double value = (double?)stats[key] ?? 0;
                if (value != 0) Text(parent, characterStatNames[i] + " " + (value > 0 ? "+" : "") + (percent ? value.ToString("P1") : CharacterStat(key, stats[key])), "small");
            }
        }

        VisualElement CharacterGrid(VisualElement parent, string className)
        {
            var grid = Row(parent, className);
            grid.style.flexDirection = FlexDirection.Row;
            grid.style.flexWrap = Wrap.Wrap;
            grid.style.alignItems = Align.Stretch;
            grid.style.justifyContent = Justify.SpaceBetween;
            return grid;
        }

        bool CharacterHas(string key, string id) => (app.Character?[key] as JArray)?.Any(token => (string)token == id) == true;
        string CharacterStage(int index) => (string)app.Catalog.Table("stages").FirstOrDefault(stage => (int?)stage["index"] == index)?["name"] ?? "境界 " + index;
        string BagSlotName(string slot) => (string)app.Catalog.Json["equipSlotNames"]?[slot] ?? slot;
        string BagGrade(string grade) => grade == null ? "—" : ((string)app.Catalog.Json["itemGradeNames"]?[grade] ?? grade);
        static string BagRarity(string grade) => grade == "saint" ? "rarity-legendary" : grade == "immortal" ? "rarity-epic" : grade == "spirit" ? "rarity-rare" : "rarity-common";
        static string CharacterNumber(JToken value) => value == null || value.Type == JTokenType.Null ? "—" : ((double)value).ToString("N1");
        static string CharacterStat(string key, JToken value) => value == null ? "—" : (key == "crit" || key == "critResist" || key == "acc" || key == "eva" ? ((double)value).ToString("P1") : ((double)value).ToString("N0"));
        static string CharacterElement(string element) => element == "metal" ? "金" : element == "wood" ? "木" : element == "water" ? "水" : element == "fire" ? "火" : element == "earth" ? "土" : "无属性";
    }
}
