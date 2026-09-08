using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    public sealed partial class GameUi
    {
        // Official references: docs/full-migration-official-reference.md, checked 2026-09-07.
        // Catalog grids, three slots and all numeric rules below migrate this project's shared/progression,
        // not unpublished Yinian Xiaoyao mechanics. No official promotional artwork is used.
        bool progressionOwnedOnly;
        string progressionPool = "treasure";
        string progressionCharacterId;
        JObject progressionPending;
        readonly string[] progressionSlots = { "本命", "辅助一", "辅助二" };
        readonly Dictionary<string, string> progressionMaterials = new Dictionary<string, string>
        {
            { "jade", "仙玉" }, { "stardust", "星尘" }, { "starStones", "星辉石" },
            { "breakthroughWood", "天罡木" }, { "fragments", "本体碎片" }
        };
        readonly Dictionary<string, string> progressionStats = new Dictionary<string, string>
        {
            { "hp", "气血" }, { "atk", "攻击" }, { "def", "防御" }, { "spd", "速度" },
            { "crit", "暴击" }, { "critResist", "抗暴" }, { "acc", "命中" }, { "eva", "闪避" }
        };

        void RenderProgression()
        {
            ProgressionRestoreReceipt();
            string page = app.Page;
            Heading(page == "treasures" ? "万宝归宗" : page == "relics" ? "古宝图鉴" : page == "gacha" ? "寻宝阁" : "仙途日课", "青云问道 · 一念修行");
            var navigation = Row(content);
            Button(navigation, "法宝", () => app.Navigate("treasures"));
            Button(navigation, "古宝", () => app.Navigate("relics"));
            Button(navigation, "寻宝", () => app.Navigate("gacha"));
            Button(navigation, "日课", () => app.Navigate("daily"));
            var p = ProgressionState();
            if (p == null) { ProgressionLoading(content); return; }
            Text(content, string.Join(" · ", progressionMaterials.Where(v => v.Key != "fragments").Select(v => v.Value + " " + (p["materials"]?.Value<double>(v.Key) ?? 0).ToString("N0"))), "section-title");
            if (app.Busy) Text(content, "正在与仙府同步…", "muted");
            if (page == "gacha") { ProgressionGacha(p); return; }
            if (page == "daily") { ProgressionDaily(p); return; }
            string kind = page == "relics" ? "relic" : "treasure";
            string table = kind == "treasure" ? "treasures" : "relics";
            var owned = (p[table] as JArray ?? new JArray()).OfType<JObject>().ToList();
            var definitions = app.Catalog.Table(table);
            if (kind == "treasure")
            {
                if (p.Value<bool?>("starterClaimed") != true)
                {
                    var starter = Card(content, "仙门馈赠");
                    var gifts = Row(starter);
                    foreach (var id in new[] { "t-starter-bell", "t-starter-shield" })
                    {
                        var gift = Card(gifts, app.Catalog.Name("treasures", id));
                        Picture(gift, app.Catalog.ProgressionArt(id));
                    }
                    Text(starter, "清音铃与守心盾均可设为本命。附赠 " + ProgressionReward(app.Catalog.Json["starterReward"]));
                    Button(starter, "领取入门法宝", () => ProgressionClaim("starter", "starter"), !app.Busy, "primary");
                }
                var slots = Row(content);
                for (int i = 0; i < progressionSlots.Length; i++)
                {
                    int slot = i;
                    var item = owned.FirstOrDefault(v => v.Value<int?>("slot") == slot);
                    var card = Card(slots, progressionSlots[slot]);
                    card.style.flexGrow = 1;
                    if (item == null) Text(card, "虚位以待\n从下方藏品装配", "muted");
                    else
                    {
                        string id = item.Value<string>("definitionId");
                        Picture(card, app.Catalog.ProgressionArt(id), 64);
                        Text(card, app.Catalog.Name(table, id));
                        Text(card, $"{item["level"]}级 · {item["stars"]}星", "small");
                        Button(card, "查看", () => ProgressionShowDetail(kind, id));
                    }
                }
                Text(content, "本命独立施展威能，双辅加持属性。百级修行，十重注灵，五星觉醒。", "muted");
            }
            else
            {
                var resonance = Card(content, $"藏品共鸣 · {owned.Count}/{definitions.Count}");
                Text(resonance, "古宝无需装配，收藏即永久生效。");
                Text(resonance, ProgressionBonus(owned, true));
            }
            var filters = Row(content);
            Button(filters, $"全部图鉴 {definitions.Count}", () => { progressionOwnedOnly = false; Rebuild(); }, true, !progressionOwnedOnly ? "primary" : "secondary");
            Button(filters, $"已拥有 {owned.Count}", () => { progressionOwnedOnly = true; Rebuild(); }, true, progressionOwnedOnly ? "primary" : "secondary");
            var grid = Row(content, "grid");
            int count = 0;
            foreach (var def in definitions.OfType<JObject>())
            {
                string id = def.Value<string>("id");
                var item = owned.FirstOrDefault(v => v.Value<string>("definitionId") == id);
                if (progressionOwnedOnly && item == null) continue;
                count++;
                var card = Card(grid, def.Value<string>("name"));
                card.style.width = 156;
                card.AddToClassList(ProgressionRarity(def.Value<string>("grade")));
                Picture(card, app.Catalog.ProgressionArt(id), 86);
                Text(card, ProgressionGrade(def.Value<string>("grade")), "small");
                Text(card, item == null ? (def.Value<string>("grade") == "mortal" ? "入门专属 · 未拥有" : "未拥有 · 寻宝可得") : $"{item["stars"]}星 · 注灵{item["spiritLevel"]}重\n碎片 {item["fragments"]}", "muted");
                Button(card, "鉴赏 / 养成", () => ProgressionShowDetail(kind, id));
            }
            if (count == 0)
            {
                Text(content, "尚无藏品，可领取入门礼或前往寻宝阁。", "muted");
                Button(content, "前往寻宝", () => app.Navigate("gacha"));
            }
            if (kind == "relic")
                foreach (var set in app.Catalog.Table("relicSets").OfType<JObject>())
                {
                    var ids = set["relicIds"].Values<string>().ToArray();
                    int n = ids.Count(id => owned.Any(v => v.Value<string>("definitionId") == id));
                    var card = Card(content, $"{set["name"]} · {n}/{ids.Length} {(n == ids.Length ? "已激活" : "待集齐")}");
                    Text(card, string.Join("、", ids.Select(id => app.Catalog.Name("relics", id))));
                    Text(card, set.Value<string>("description"), "muted");
                }
        }

        JObject ProgressionState() => app.Data("progression.get")?["progression"] as JObject;
        void ProgressionLoading(VisualElement parent)
        {
            Text(parent, "仙府资料尚未载入。请求完成后将自动显示；连接异常时可重试。", "muted");
            Button(parent, "重新同步", () => app.Refresh("progression.get", "progression.history"), !app.Busy);
        }
        string ProgressionReward(JToken reward) => reward is JObject obj
            ? string.Join(" · ", obj.Properties().Where(v => v.Value.Value<double>() != 0).Select(v => (progressionMaterials.TryGetValue(v.Name, out var name) ? name : v.Name) + " " + v.Value.Value<double>().ToString("N0")))
            : "资料加载中";
        string ProgressionGrade(string grade) => (app.Catalog.Json["progressionGradeNames"]?[grade]?.ToString() ?? grade) + "阶 · " + (grade == "mortal" ? "白" : grade == "spirit" ? "蓝" : grade == "immortal" ? "紫" : grade == "saint" ? "金" : "红") + "品";
        string ProgressionRarity(string grade) => "rarity-" + (grade == "mortal" ? "common" : grade == "spirit" ? "rare" : grade == "immortal" ? "epic" : grade == "saint" ? "legendary" : "mythic");
        bool ProgressionHas(JToken array, string value) => (array as JArray)?.Values<string>().Contains(value) == true;
        void ProgressionClaim(string kind, string id) => ProgressionCommand("progression.claim", new JObject { ["kind"] = kind, ["id"] = id });
        void ProgressionCommand(string route, JObject input)
        {
            if (app.Busy) return;
            app.Command(route, input, _ => app.Refresh("progression.get"));
        }
        void ProgressionShowDetail(string kind, string id)
        {
            ShowSheet(app.Catalog.Name(kind == "treasure" ? "treasures" : "relics", id), parent => ProgressionDetail(parent, kind, id));
        }
        void ProgressionDetail(VisualElement parent, string kind, string id)
        {
            var p = ProgressionState();
            if (p == null) { ProgressionLoading(parent); return; }
            string table = kind == "treasure" ? "treasures" : "relics";
            var def = app.Catalog.Find(table, id);
            if (def == null) { Text(parent, "藏品资料未找到。", "muted"); return; }
            Picture(parent, app.Catalog.ProgressionArt(id), 150);
            Text(parent, ProgressionGrade(def.Value<string>("grade")) + (kind == "treasure" ? " · " + app.Catalog.Json["treasureFormNames"]?[def.Value<string>("form")] + "形" : " · 收藏永久生效"));
            Text(parent, def.Value<string>("description"));
            var owned = (p[table] as JArray)?.OfType<JObject>().FirstOrDefault(v => v.Value<string>("definitionId") == id);
            if (owned == null)
            {
                Text(parent, def.Value<string>("grade") == "mortal" ? "领取入门馈赠可得。凡阶法宝不进入寻宝奖池。" : "尚未拥有，寻宝可收集此宝。", "muted");
                Button(parent, "前往" + (def.Value<string>("grade") == "mortal" ? "法宝" : "寻宝"), () => { CloseSheet(); app.Navigate(def.Value<string>("grade") == "mortal" ? "treasures" : "gacha"); });
                return;
            }
            Text(parent, (kind == "treasure" ? $"等级 {owned["level"]}/100 · " : "") + $"注灵 {owned["spiritLevel"]}/10 · 星级 {owned["stars"]}/5" + (owned.Value<int>("stars") == 5 ? " · 已觉醒" : ""));
            Text(parent, $"本体碎片 {owned["fragments"]} · 重复获得转为 {app.Catalog.Json["gachaRules"]?["duplicateFragments"]} 枚碎片");
            Text(parent, ProgressionBonus(new[] { owned }, kind == "relic"));
            if (kind == "treasure")
            {
                // Same read-only preview as shared mainTreasureCombat; server remains authoritative.
                string form = def.Value<string>("form");
                double interval = form == "bell" ? 1 : form == "tower" ? 2.5 : form == "chain" ? 3.5 : form == "seal" ? 4 : form == "banner" ? 6 : 8;
                double power = 1 + (ProgressionGradeScale(def.Value<string>("grade")) - 1) * .04 + (owned.Value<int>("level") - 1) * .004 + owned.Value<int>("spiritLevel") * .02 + owned.Value<int>("stars") * .025;
                Text(parent, $"设为本命后：每 {interval:0.0} 秒施展 · 威力 ×{power:0.00}");
                var slots = Row(parent);
                for (int i = 0; i < progressionSlots.Length; i++)
                {
                    int slot = i;
                    bool equipped = owned.Value<int?>("slot") == slot;
                    Button(slots, (equipped ? "已装" : "设为") + progressionSlots[slot], () => ProgressionCommand("progression.equip", new JObject { ["uid"] = owned["uid"], ["slot"] = slot }), !app.Busy && !equipped);
                }
                if (owned.Value<int?>("slot") != null)
                    Button(slots, "卸下", () => ProgressionCommand("progression.equip", new JObject { ["uid"] = owned["uid"], ["slot"] = JValue.CreateNull() }), !app.Busy);
            }
            foreach (string action in kind == "treasure" ? new[] { "level", "infuse", "star" } : new[] { "infuse", "star" })
            {
                var cost = ProgressionCost(owned, action, app.Catalog.Table("starFragmentCosts"));
                bool enough = cost != null && cost.Properties().All(v => (v.Name == "fragments" ? owned.Value<double>("fragments") : p["materials"]?.Value<double>(v.Name) ?? 0) >= v.Value.Value<double>());
                string label = action == "level" ? (owned.Value<int>("level") % 10 == 0 ? "突破" : "升级") : action == "infuse" ? "注灵" : owned.Value<int>("stars") == 4 ? "升星觉醒" : "升星";
                var card = Card(parent, label);
                Text(card, cost == null ? "已达上限" : "消耗 " + ProgressionReward(cost) + (enough ? "" : "（材料不足）"), "muted");
                Button(card, cost == null ? label + "已满" : label, () => ProgressionCommand("progression.upgrade", new JObject { ["kind"] = kind, ["id"] = kind == "treasure" ? owned["uid"] : owned["definitionId"], ["action"] = action }), !app.Busy && enough);
            }
        }

        // Exact read-only cost preview from packages/shared/src/progression/index.ts.
        static JObject ProgressionCost(JObject owned, string action, JArray fragmentCosts)
        {
            int stars = owned.Value<int>("stars"), spirit = owned.Value<int>("spiritLevel"), level = owned.Value<int?>("level") ?? 0;
            if (action == "star") return stars >= 5 || stars >= fragmentCosts.Count ? null : new JObject { ["fragments"] = fragmentCosts[stars], ["stardust"] = 20 * (stars + 1) };
            if (action == "infuse") return spirit >= 10 ? null : new JObject { ["stardust"] = 20 * (spirit + 1) };
            if (action != "level" || level < 1 || level >= 100) return null;
            var cost = new JObject { ["starStones"] = 5 + level * 2 };
            if (level % 10 == 0) cost["breakthroughWood"] = level / 10;
            return cost;
        }
        double ProgressionGradeScale(string grade)
        {
            var exported = app.Catalog.Json["progressionGradeMult"]?[grade];
            if (exported != null) return exported.Value<double>();
            return grade == "spirit" ? 1.6 : grade == "immortal" ? 2.6 : grade == "saint" ? 4.2 : grade == "divine" ? 6.5 : 1;
        }
        string ProgressionBonus(IEnumerable<JObject> items, bool relic)
        {
            var values = new Dictionary<string, double>();
            var sets = new Dictionary<string, int>();
            double cultivation = 0;
            foreach (var item in items)
            {
                var def = app.Catalog.Find(relic ? "relics" : "treasures", item.Value<string>("definitionId"));
                if (def == null) continue;
                int stars = item.Value<int>("stars"), spirit = item.Value<int>("spiritLevel");
                double scale = ProgressionGradeScale(def.Value<string>("grade"));
                if (!relic)
                {
                    scale *= 1 + (item.Value<int>("level") - 1) * .01 + spirit * .04 + stars * .06 + (stars == 5 ? .1 : 0);
                    values["atk"] = (values.TryGetValue("atk", out var atk) ? atk : 0) + .025 * scale;
                    values["hp"] = (values.TryGetValue("hp", out var hp) ? hp : 0) + .015 * scale;
                    continue;
                }
                scale *= 1 + spirit * .08 + stars * .12 + (stars == 5 ? .2 : 0);
                foreach (var field in new[] { "percent", "flat" })
                    foreach (var stat in (def[field] as JObject ?? new JObject()).Properties())
                        values[stat.Name] = (values.TryGetValue(stat.Name, out var previous) ? previous : 0) + stat.Value.Value<double>() * scale;
                cultivation += def.Value<double>("cultivationBonus") * scale;
                string set = def.Value<string>("setId");
                if (set != null) sets[set] = (sets.TryGetValue(set, out var count) ? count : 0) + 1;
            }
            foreach (int count in sets.Values.Where(v => v >= 3))
            {
                values["hp"] = (values.TryGetValue("hp", out var hp) ? hp : 0) + .01;
                values["atk"] = (values.TryGetValue("atk", out var atk) ? atk : 0) + .01;
                cultivation += .005;
            }
            var parts = values.Where(v => v.Value != 0).Select(v => (progressionStats.TryGetValue(v.Key, out var name) ? name : v.Key) + " +" + (v.Value * 100).ToString("0.0") + "%").ToList();
            if (cultivation != 0) parts.Add("修炼 +" + (cultivation * 100).ToString("0.0") + "%");
            return parts.Count == 0 ? "尚无收藏加成" : string.Join(" · ", parts);
        }

        void ProgressionGacha(JObject p)
        {
            var tabs = Row(content);
            foreach (string pool in new[] { "treasure", "relic" })
                Button(tabs, pool == "treasure" ? "法宝秘藏" : "古宝遗珍", () => { progressionPool = pool; Rebuild(); }, true, progressionPool == pool ? "primary" : "secondary");
            var hero = Card(content, progressionPool == "treasure" ? "万宝归宗" : "千古遗珍");
            var picture = Picture(hero, Resources.Load<Texture2D>(app.Catalog.Json["sceneArt"]?["gacha-hall-v1"]?.ToString() ?? ""), 210);
            picture.style.alignSelf = Align.Center;
            Text(hero, "仙缘一念 · 探得天地奇珍", "muted");
            var rules = app.Catalog.Json["gachaRules"] as JObject;
            if (rules == null) { Text(content, "寻宝规则尚未载入，暂不可抽取。", "muted"); return; }
            int pity = p["gacha"]?[progressionPool]?.Value<int>("pity") ?? 0;
            int hard = rules.Value<int>("hardPity");
            Meter(hero, hard > 0 ? (float)pity / hard : 0, $"红品保底 {pity}/{hard} · 至多再 {Math.Max(0, hard - pity)} 抽");
            Text(hero, "十连至少一件金品或红品 · 两池独立 · 每池每日免费一次");
            if (progressionPending != null)
            {
                var pending = Card(content, "上次寻宝结果尚未确认");
                Text(pending, (progressionPending.Value<string>("pool") == "treasure" ? "法宝" : "古宝") + $" · {progressionPending["count"]}抽。重试将使用原凭据取回结果，不创建新抽取。", "muted");
                Button(pending, "重试上次寻宝", ProgressionRetryDraw, !app.Busy, "primary");
            }
            bool free = !ProgressionHas(p["daily"]?["freePools"], progressionPool);
            Button(content, free ? "每日免费寻宝" : "今日免费已用", () => ProgressionDraw(1, true), !app.Busy && progressionPending == null && free, "primary");
            var paid = Row(content);
            foreach (int count in new[] { 1, 10 })
            {
                int cost = rules.Value<int>(count == 1 ? "singleCost" : "tenCost");
                bool enough = (p["materials"]?.Value<double>("jade") ?? 0) >= cost;
                Button(paid, (count == 1 ? "寻宝一次" : "寻宝十次") + $" · {cost}仙玉" + (enough ? "" : "（不足）"), () => ProgressionDraw(count, false), !app.Busy && progressionPending == null && enough);
            }
            var links = Row(content);
            Button(links, "概率与规则", () => ShowSheet("寻宝规则公示", ProgressionRules));
            Button(links, "寻宝记录", () => { app.Refresh("progression.history"); ShowSheet("最近100笔寻宝", ProgressionHistory); });
            Button(links, "日课获取仙玉", () => app.Navigate("daily"));
        }
        void ProgressionRules(VisualElement parent)
        {
            var rules = app.Catalog.Json["gachaRules"];
            if (rules == null) { Text(parent, "规则资料未载入。"); return; }
            var grades = rules["grades"] as JArray;
            var weights = rules["weights"] as JArray;
            if (grades != null && weights != null)
                for (int i = 0; i < Math.Min(grades.Count, weights.Count); i++) Text(parent, ProgressionGrade(grades[i].ToString()) + "：" + weights[i] + "%");
            Text(parent, "本作基础概率，各品级内藏品等概率。保底提高实际金／红品占比。");
            Text(parent, $"单抽 {rules["singleCost"]} 仙玉，十连 {rules["tenCost"]} 仙玉。十连前九抽均无金或红，第十抽补至金品（已出红则保留）。未出红达到第 {rules["hardPity"]} 抽必得红品，出红后归零。");
            Text(parent, $"两池独立计数，免费抽计入保底。每日 UTC 00:00 重置免费次数。重复藏品转为 {rules["duplicateFragments"]} 枚本体碎片。凡阶入门法宝不进入奖池。");
            Text(parent, "仙玉来自日课、成就与游戏奖励；本页没有真实付费入口。", "muted");
        }
        void ProgressionHistory(VisualElement parent)
        {
            var response = app.Data("progression.history");
            if (response == null) { Text(parent, "正在读取寻宝记录…", "muted"); Button(parent, "重试", () => app.Refresh("progression.history"), !app.Busy); return; }
            var items = response["items"] as JArray;
            if (items == null || items.Count == 0) { Text(parent, "暂无寻宝记录。", "muted"); return; }
            foreach (var entry in items.OfType<JObject>())
            {
                var card = Card(parent, DateTimeOffset.FromUnixTimeMilliseconds(entry.Value<long>("at")).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"));
                ProgressionResults(card, entry["results"] as JArray, false);
            }
        }
        void ProgressionResults(VisualElement parent, JArray results, bool artwork)
        {
            if (results == null || results.Count == 0) { Text(parent, "本次结果为空，请同步寻宝记录。", "muted"); return; }
            var grid = Row(parent, "grid");
            foreach (var result in results.OfType<JObject>())
            {
                string id = result.Value<string>("definitionId");
                string table = result.Value<string>("pool") == "treasure" ? "treasures" : "relics";
                var item = Card(grid, app.Catalog.Name(table, id));
                item.style.width = artwork ? 150 : 220;
                item.AddToClassList(ProgressionRarity(result.Value<string>("grade")));
                if (artwork) Picture(item, app.Catalog.ProgressionArt(id), 84);
                Text(item, ProgressionGrade(result.Value<string>("grade")), "small");
                Text(item, result.Value<bool>("duplicate") ? "本体碎片 +" + result["fragments"] : "新获藏品", "muted");
            }
        }
        void ProgressionRestoreReceipt()
        {
            string id = app.Character?.Value<string>("id");
            if (id == progressionCharacterId) return;
            progressionCharacterId = id;
            progressionPending = null;
            if (string.IsNullOrEmpty(id)) return;
            string saved = PlayerPrefs.GetString("qingyun-pending-draw:" + id, "");
            if (saved.Length == 0) return;
            try
            {
                var request = JObject.Parse(saved);
                string pool = request.Value<string>("pool"), receipt = request.Value<string>("requestId");
                int count = request.Value<int>("count");
                if ((pool == "treasure" || pool == "relic") && (count == 1 || count == 10) && !(request.Value<bool?>("free") == true && count != 1) && !string.IsNullOrWhiteSpace(receipt) && receipt.Length <= 100)
                    progressionPending = request;
                else app.Notice("上次寻宝凭据损坏，请先核对寻宝记录。");
            }
            catch (Exception) { app.Notice("上次寻宝凭据无法读取，请先核对寻宝记录。"); }
        }
        void ProgressionDraw(int count, bool free)
        {
            if (app.Busy || progressionPending != null || string.IsNullOrEmpty(progressionCharacterId)) return;
            progressionPending = new JObject { ["pool"] = progressionPool, ["count"] = count, ["free"] = free, ["requestId"] = Guid.NewGuid().ToString("N") };
            PlayerPrefs.SetString("qingyun-pending-draw:" + progressionCharacterId, progressionPending.ToString(Newtonsoft.Json.Formatting.None));
            PlayerPrefs.Save();
            ProgressionRetryDraw();
        }
        void ProgressionRetryDraw()
        {
            if (app.Busy || progressionPending == null) return;
            string owner = progressionCharacterId;
            var request = (JObject)progressionPending.DeepClone();
            app.Command("progression.draw", request, result =>
            {
                if (owner != app.Character?.Value<string>("id")) return;
                progressionPending = null;
                PlayerPrefs.DeleteKey("qingyun-pending-draw:" + owner);
                PlayerPrefs.Save();
                app.Refresh("progression.get", "progression.history");
                ShowSheet("仙缘已至", parent =>
                {
                    ProgressionResults(parent, result["results"] as JArray, true);
                    Text(parent, "藏品已收入仙府，重复藏品已转为本体碎片。");
                    Button(parent, "收入囊中", CloseSheet, true, "primary");
                });
            }, code =>
            {
                if (owner != app.Character?.Value<string>("id")) return;
                // Only explicit business rejection proves no draw was committed. Unknown failures retain the receipt.
                if (ProgressionRejectedDraw(code))
                {
                    progressionPending = null;
                    PlayerPrefs.DeleteKey("qingyun-pending-draw:" + owner);
                    PlayerPrefs.Save();
                }
                app.Refresh("progression.get");
            });
        }
        static bool ProgressionRejectedDraw(string code) => new[] { "INSUFFICIENT_ITEMS", "ITEM_NOT_FOUND", "CONDITION_UNMET", "QUEST_ALREADY_CLAIMED" }.Contains(code);

        void ProgressionDaily(JObject p)
        {
            var daily = p["daily"] as JObject;
            if (daily == null) { ProgressionLoading(content); return; }
            Text(content, $"今日修行 · {daily["date"]} · UTC 00:00 更新", "section-title");
            Text(content, "每项奖励：" + ProgressionReward(app.Catalog.Json["dailyReward"]), "muted");
            foreach (var quest in app.Catalog.Table("dailyQuests").OfType<JObject>())
            {
                string id = quest.Value<string>("id");
                double target = quest.Value<double>("target"), current = daily.Value<double>(quest.Value<string>("counter"));
                bool claimed = ProgressionHas(daily["claimed"], id), complete = current >= target;
                var card = Card(content, quest.Value<string>("name"));
                Meter(card, target > 0 ? (float)Math.Min(1, current / target) : 0, id == "cultivation" ? $"{Math.Floor(Math.Min(current, target) / 60)}/{target / 60:0} 分钟" : $"{Math.Min(current, target):0}/{target:0}");
                if (complete) Button(card, claimed ? "已领取" : "领取日课奖励", () => ProgressionClaim("daily", id), !app.Busy && !claimed, claimed ? "secondary" : "primary");
                else Button(card, "前往修行", () => app.Navigate(id == "cultivation" ? "home" : id == "chat" ? "social" : id == "arena" || id == "dungeon" ? "town" : "world"));
            }
            Text(content, "仙途里程碑", "section-title");
            Text(content, "每项奖励：" + ProgressionReward(app.Catalog.Json["achievementReward"]), "muted");
            foreach (var achievement in app.Catalog.Table("progressionAchievements").OfType<JObject>())
            {
                string id = achievement.Value<string>("id");
                bool claimed = ProgressionHas(p["claimedAchievements"], id), complete = ProgressionHas(p["achievements"], id);
                var card = Card(content, achievement.Value<string>("name"));
                Text(card, id == "first_breakthrough" ? "首次成功突破大境界" : "首次击败妖王 BOSS", "muted");
                Button(card, claimed ? "已领取" : complete ? "领取成就奖励" : "未达成", () => ProgressionClaim("achievement", id), !app.Busy && complete && !claimed);
            }
        }

        [ContextMenu("Verify progression cost boundaries")]
        void ProgressionVerifyCosts()
        {
            Debug.Assert(ProgressionRejectedDraw("INSUFFICIENT_ITEMS") && !ProgressionRejectedDraw("NETWORK_ERROR") && !ProgressionRejectedDraw("INTERNAL_ERROR") && !ProgressionRejectedDraw("VALIDATION_ERROR") && !ProgressionRejectedDraw(null), "Only definitive draw rejection can release its receipt");
            var fragments = new JArray(10, 20, 40, 80, 120);
            var owned = new JObject { ["level"] = 10, ["spiritLevel"] = 9, ["stars"] = 4 };
            var level = ProgressionCost(owned, "level", fragments);
            Debug.Assert(level.Value<int>("starStones") == 25 && level.Value<int>("breakthroughWood") == 1, "Tenth level must include breakthrough wood");
            Debug.Assert(ProgressionCost(owned, "star", fragments).Value<int>("fragments") == 120, "Fifth star fragment cost");
            Debug.Assert(ProgressionCost(owned, "infuse", fragments).Value<int>("stardust") == 200, "Tenth infusion cost");
            owned["level"] = 100; owned["stars"] = 5; owned["spiritLevel"] = 10;
            Debug.Assert(ProgressionCost(owned, "level", fragments) == null && ProgressionCost(owned, "star", fragments) == null && ProgressionCost(owned, "infuse", fragments) == null, "Maximum upgrades must be disabled");
        }
    }
}
