using System;
using System.Globalization;
using System.Linq;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    public sealed partial class GameUi
    {
        // Official comparison checked 2026-09-07: https://xian.leiting.com/news/1.html (2020-12),
        // https://xian.leiting.com/news/3.html (2020-12-03), https://xian.leiting.com/news/670.html (2025-03-28).
        // Re-read 2026-09-07: news/1.html, published 2020-12-03 17:35:07; viewed its shop image:
        // https://xian.leiting.com/static/upload/editor/20201208/160740659436585503864154.jpg
        // Observed: equipment/pill/material groups, compact icon/name/price rows and a trailing purchase button.
        // Adopt that hierarchy. Quantity/total confirmation and buyback remain this project's interaction,
        // not a claim that this historical screenshot proves the original game's confirmation flow.
        // Qingyun NPCs, original artwork, three chapters, prices, stock and dialogue trees are project-specific.
        // DialogueView has no battle field; server npc/service.ts says start_battle is not authored.
        // Do not fabricate combat results or trigger an extra exploration request after an ordinary dialogue.
        string townTab = "people";
        string townShopTab = "buy";
        JObject townDialogue;
        string townOwner;
        int townConversation;

        void RenderTown()
        {
            string owner = app.Character?.Value<string>("id");
            if (townOwner != owner)
            {
                townOwner = owner;
                townDialogue = null;
                townConversation++;
                townTab = "people";
                townShopTab = "buy";
            }
            var roster = app.Data("npc.list");
            var quests = app.Data("quests.list");
            var npcs = roster?["npcs"] as JArray;
            int pending = npcs?.OfType<JObject>().Count(n => n.Value<bool>("hasQuest")) ?? 0;
            Heading("青云镇", $"灵石 {(app.Character?.Value<double>("spiritStones") ?? 0):N0}" + (pending > 0 ? $" · {pending}人有事相询" : ""));
            var image = Picture(content, app.Catalog.Art("bg/town-qingyun"), 190);
            image.style.width = Length.Percent(100);
            image.scaleMode = ScaleMode.ScaleAndCrop;
            var tabs = Row(content);
            Button(tabs, "镇民", () => { townTab = "people"; Rebuild(); }, true, townTab == "people" ? "primary" : "secondary");
            Button(tabs, "任务簿", () => { townTab = "quests"; Rebuild(); }, true, townTab == "quests" ? "primary" : "secondary");
            Button(tabs, "仙途日课", () => app.Navigate("daily"));
            Button(tabs, "刷新", TownRefresh, !app.Busy);
            if (townTab == "quests") { TownQuests(content, quests); return; }
            Text(content, "青石街尽头便是山门。镇民各有故事，也各有相待之礼。", "muted");
            if (npcs == null) { TownLoading(content, "npc.list", "正在探访青云镇…"); return; }
            if (npcs.Count == 0) { Text(content, "街上暂时无人。", "muted"); return; }
            var grid = Row(content, "grid");
            foreach (var npc in npcs.OfType<JObject>())
            {
                string id = npc.Value<string>("id");
                bool unlocked = npc.Value<bool>("unlocked");
                var card = Card(grid, npc.Value<string>("name") + (npc.Value<bool>("hasQuest") ? " · 有事相询" : ""));
                card.style.width = 220;
                var portrait = Picture(card, app.Catalog.Art(npc.Value<string>("art")), 108);
                portrait.style.alignSelf = Align.Center;
                Text(card, npc.Value<string>("title"), "small");
                Text(card, npc.Value<string>("description"), "muted");
                if (!unlocked)
                {
                    int index = npc.Value<int>("unlockStage");
                    var stage = app.Catalog.Table("stages").OfType<JObject>().FirstOrDefault(s => s.Value<int>("index") == index);
                    Text(card, "需 " + (stage?.Value<string>("name") ?? "更高境界"), "small");
                }
                Button(card, unlocked ? (npc.Value<string>("shopId") == null ? "叙话" : "叙话 · 交易") : "尚未结识", () => TownBeginDialogue(id), unlocked && !app.Busy, "primary");
            }
        }
        void TownLoading(VisualElement parent, string route, string message)
        {
            Text(parent, message + "连接异常时可重试。", "muted");
            Button(parent, "重新读取", () => app.Refresh(route), !app.Busy);
        }
        void TownRefresh() => app.Refresh("npc.list", "quests.list", "shop.list");
        void TownBeginDialogue(string npcId)
        {
            if (app.Busy) return;
            int conversation = ++townConversation;
            string owner = app.Character?.Value<string>("id");
            townDialogue = null;
            app.Command("npc.dialogue", new JObject { ["npcId"] = npcId }, result =>
            {
                if (conversation != townConversation || owner != app.Character?.Value<string>("id")) return;
                TownApplyDialogue(result);
            });
        }
        void TownApplyDialogue(JObject result)
        {
            townDialogue = result;
            TownRefresh();
            string shopId = result.Value<string>("openShopId");
            if (!string.IsNullOrEmpty(shopId)) { TownOpenShop(shopId); return; }
            ShowSheet(result.Value<string>("npcName") ?? "叙话", TownDialogueSheet);
        }
        void TownDialogueSheet(VisualElement parent)
        {
            var dialogue = townDialogue;
            if (dialogue == null) { Text(parent, "正在见礼…", "muted"); return; }
            string art = dialogue["node"]?.Value<string>("art") ?? dialogue.Value<string>("npcArt");
            Picture(parent, app.Catalog.Art(art), 160);
            Text(parent, dialogue["node"]?.Value<string>("text") ?? "", "section-title");
            var reward = dialogue["reward"] as JObject;
            if (reward != null)
            {
                string text = TownRewardText(reward);
                if (text.Length > 0) Text(Card(parent, "所得"), text);
            }
            if (dialogue.Value<bool>("ended"))
            {
                Button(parent, "告辞", TownEndDialogue, true, "primary");
                return;
            }
            var choices = dialogue["choices"] as JArray;
            if (choices == null || choices.Count == 0) Text(parent, "此番叙话已毕。", "muted");
            foreach (var choice in (choices ?? new JArray()).OfType<JObject>())
            {
                bool available = choice.Value<bool>("available");
                string choiceId = choice.Value<string>("id");
                Button(parent, choice.Value<string>("text"), () => TownChoose(dialogue, choiceId), available && !app.Busy, "secondary");
                string reason = choice.Value<string>("blockedReason");
                if (!string.IsNullOrEmpty(reason)) Text(parent, reason, "muted");
                else if (!available) Text(parent, "条件尚未满足。", "muted");
            }
            Button(parent, "离开叙话", TownEndDialogue, !app.Busy);
        }
        void TownChoose(JObject dialogue, string choiceId)
        {
            if (app.Busy || dialogue.Value<bool>("ended")) return;
            int conversation = townConversation;
            string owner = app.Character?.Value<string>("id");
            app.Command("npc.talk", new JObject { ["npcId"] = dialogue["npcId"], ["nodeId"] = dialogue["node"]?["id"], ["choiceId"] = choiceId }, result =>
            {
                if (conversation != townConversation || owner != app.Character?.Value<string>("id")) return;
                TownApplyDialogue(result);
            });
        }
        void TownEndDialogue()
        {
            townConversation++;
            townDialogue = null;
            CloseSheet();
            TownRefresh();
        }
        string TownRewardText(JObject reward)
        {
            var parts = new List<string>();
            double exp = reward.Value<double?>("exp") ?? 0, stones = reward.Value<double?>("spiritStones") ?? 0;
            if (exp > 0) parts.Add($"修为 +{exp:N0}");
            if (stones > 0) parts.Add($"灵石 +{stones:N0}");
            var names = reward["itemNames"] as JArray;
            if (names != null && names.Count > 0) parts.AddRange(names.Values<string>());
            else
                foreach (var item in (reward["items"] as JArray ?? new JArray()).OfType<JObject>())
                    parts.Add(app.Catalog.Name("items", item.Value<string>("itemId")) + " ×" + item["qty"]);
            return string.Join(" · ", parts);
        }
        void TownQuests(VisualElement parent, JObject quests)
        {
            if (quests == null) { TownLoading(parent, "quests.list", "正在翻开任务簿…"); return; }
            int current = quests.Value<int>("currentChapter");
            var chapter = (quests["chapters"] as JArray)?.OfType<JObject>().FirstOrDefault(v => v.Value<int>("chapter") == current);
            if (chapter != null) Text(Card(parent, chapter.Value<string>("title")), chapter.Value<string>("summary"), "muted");
            var board = (quests["active"] as JArray ?? new JArray()).OfType<JObject>().Concat((quests["available"] as JArray ?? new JArray()).OfType<JObject>()).ToList();
            if (board.Count == 0) Text(parent, "镇上暂时无事可做，可先去秘境历练。尚未开放的差事将在满足条件后出现。", "muted");
            foreach (string kind in new[] { "main", "side", "daily" })
            {
                var rows = board.Where(v => v["quest"]?.Value<string>("kind") == kind).ToList();
                if (rows.Count == 0) continue;
                Text(parent, (kind == "main" ? "主线" : kind == "side" ? "支线" : "日常") + $" · {rows.Count}条", "section-title");
                foreach (var row in rows) TownQuestRow(parent, row);
            }
            var claimed = quests["claimed"] as JArray;
            if (claimed != null && claimed.Count > 0)
            {
                Text(parent, "已复命", "section-title");
                foreach (var row in claimed.OfType<JObject>()) Text(parent, row["quest"]?.Value<string>("name") ?? "已了差事", "muted");
            }
        }
        void TownQuestRow(VisualElement parent, JObject row)
        {
            var quest = row["quest"] as JObject;
            if (quest == null) return;
            string id = quest.Value<string>("id"), state = row["progress"]?.Value<string>("state");
            bool accepted = state == "active" || state == "completed", claimable = row.Value<bool>("claimable");
            var card = Card(parent, quest.Value<string>("name"));
            string npc = quest.Value<string>(accepted ? "turnInNpcId" : "giverNpcId");
            Text(card, (accepted ? "复命 · " : "发布 · ") + app.Catalog.Name("npcs", npc), "small");
            Text(card, quest.Value<string>("description"));
            if (accepted)
                foreach (string objective in (row["objectiveText"] as JArray ?? new JArray()).Values<string>()) Text(card, objective, "muted");
            if (quest["reward"] is JObject reward) Text(card, "奖励：" + TownRewardText(reward), "small");
            var actions = Row(card);
            Button(actions, accepted ? (claimable ? "复命领赏" : "进行中") : "接下差事", () => TownQuestAction(id, accepted), !app.Busy && (!accepted || claimable), claimable || !accepted ? "primary" : "secondary");
            var known = (app.Data("npc.list")?["npcs"] as JArray)?.OfType<JObject>().FirstOrDefault(v => v.Value<string>("id") == npc);
            Button(actions, "拜访" + app.Catalog.Name("npcs", npc), () => TownBeginDialogue(npc), !app.Busy && known?.Value<bool>("unlocked") == true);
        }
        void TownQuestAction(string id, bool complete)
        {
            if (app.Busy) return;
            app.Command(complete ? "quests.complete" : "quests.accept", new JObject { ["questId"] = id }, result =>
            {
                if (complete)
                {
                    string reward = result["reward"] is JObject r ? TownRewardText(r) : "";
                    string chapter = result.Value<int?>("advancedToChapter") is int next ? $" · 剧情推进至第{next}章" : "";
                    app.Notice("复命完毕" + (reward.Length > 0 ? " · " + reward : "") + chapter);
                }
                else app.Notice("已接下这桩差事。");
                TownRefresh();
            });
        }

        void TownOpenShop(string shopId)
        {
            townDialogue = null;
            townShopTab = "buy";
            app.Refresh("shop.list");
            TownShowShop(shopId);
        }
        void TownShowShop(string shopId) => ShowSheet(app.Catalog.Name("shops", shopId), parent => TownShop(parent, shopId));
        void TownShop(VisualElement parent, string shopId)
        {
            var shop = app.Data("shop.list", new JObject { ["shopId"] = shopId });
            if (shop == null) { TownLoading(parent, "shop.list", "正在看货…"); return; }
            Text(parent, shop["shop"]?.Value<string>("description") ?? "", "muted");
            var tabs = Row(parent, "town-shop-toolbar");
            tabs.style.flexDirection = FlexDirection.Row;
            tabs.style.flexWrap = Wrap.Wrap;
            Button(tabs, "买入", () => { townShopTab = "buy"; Rebuild(); }, true, townShopTab == "buy" ? "primary" : "secondary");
            Button(tabs, "卖出", () => { townShopTab = "sell"; Rebuild(); }, true, townShopTab == "sell" ? "primary" : "secondary");
            Button(tabs, "刷新货架", () => app.Refresh("shop.list"), !app.Busy);
            TownBalance(parent, "town-shop-balance");
            if (townShopTab == "buy")
            {
                var entries = (shop["entries"] as JArray ?? new JArray()).OfType<JObject>().ToList();
                if (entries.Count == 0) Text(parent, "货架暂空。", "muted");
                foreach (var group in entries.GroupBy(entry => app.Catalog.Find("items", entry.Value<string>("itemId"))?.Value<string>("kind") ?? "other"))
                {
                    Text(parent, TownShopGroup(group.Key), "town-shop-group");
                    foreach (var entry in group)
                    {
                        string id = entry.Value<string>("itemId");
                        int? stock = entry.Value<int?>("stockLeft");
                        string reason = entry.Value<string>("blockedReason");
                        string detail = !string.IsNullOrEmpty(reason) ? reason : stock == 0 ? "今日售罄" : stock.HasValue ? $"今日尚余 {stock.Value}" : "货源充足";
                        bool available = entry.Value<bool>("available") && stock != 0;
                        TownShopRow(parent, entry.Value<string>("itemName"), entry.Value<string>("itemArt"), detail,
                            entry.Value<double>("price"), "买入", () => TownSelectTrade(shopId, "buy", id), available);
                    }
                }
            }
            else
            {
                var prices = shop["sellPrices"] as JObject ?? new JObject();
                var items = (app.CharacterView?["inventory"] as JArray ?? new JArray()).OfType<JObject>().Where(v => !v.Value<bool>("equipped") && prices[v.Value<string>("uid")] != null && v.Value<int>("qty") > 0).ToList();
                if (items.Count == 0) Text(parent, "这家不收你行囊里的东西。已装备物品不可直接出售。", "muted");
                foreach (var group in items.GroupBy(item => app.Catalog.Find("items", item.Value<string>("itemId"))?.Value<string>("kind") ?? "other"))
                {
                    Text(parent, TownShopGroup(group.Key), "town-shop-group");
                    foreach (var item in group)
                    {
                        string uid = item.Value<string>("uid"), id = item.Value<string>("itemId");
                        var def = app.Catalog.Find("items", id);
                        TownShopRow(parent, def?.Value<string>("name") ?? id, def?.Value<string>("art"), $"持有 {item["qty"]} 件 · 回收",
                            prices[uid].Value<double>(), "卖出", () => TownSelectTrade(shopId, "sell", uid), true);
                    }
                }
            }
        }
        static string TownShopGroup(string kind) => kind == "equipment" ? "装备" : kind == "pill" ? "丹药" : kind == "material" ? "材料" : "其他";
        void TownShopRow(VisualElement parent, string name, string art, string detail, double price, string action, Action select, bool available)
        {
            // Keep the existing card semantic for item-scoped keyboard/smoke selectors; layout is a single row.
            var row = Card(parent);
            row.AddToClassList("town-shop-row");
            row.style.flexDirection = FlexDirection.Row;
            row.style.alignItems = Align.Center;
            Picture(row, app.Catalog.Art(art), 44).AddToClassList("town-shop-icon");
            var copy = Row(row, "town-shop-copy");
            copy.style.flexGrow = 1;
            copy.style.minWidth = 0;
            Text(copy, name, "town-shop-name");
            Text(copy, detail, "town-shop-note");
            Text(row, $"{price:N0} 灵石", "town-shop-price");
            var button = Button(row, action, select, available && !app.Busy, "secondary");
            button.AddToClassList("town-shop-action");
        }
        void TownSelectTrade(string shopId, string kind, string id)
        {
            if (app.Busy) return;
            ShowSheet(kind == "buy" ? "选购" : "出售", parent => TownTradeDetail(parent, shopId, kind, id));
        }
        void TownTradeDetail(VisualElement parent, string shopId, string kind, string id)
        {
            Button(parent, "返回货架", () => TownShowShop(shopId), !app.Busy);
            var shop = app.Data("shop.list", new JObject { ["shopId"] = shopId });
            if (shop == null) { TownLoading(parent, "shop.list", "正在核对货价…"); return; }
            JObject definition;
            int cap;
            double price;
            bool available;
            string name, art, detail;
            if (kind == "buy")
            {
                var entry = (shop["entries"] as JArray)?.OfType<JObject>().FirstOrDefault(v => v.Value<string>("itemId") == id);
                if (entry == null) { Text(parent, "这件商品已下架，请返回货架重新挑选。", "muted"); return; }
                definition = app.Catalog.Find("items", id);
                name = entry.Value<string>("itemName"); art = entry.Value<string>("itemArt");
                int? stock = entry.Value<int?>("stockLeft");
                cap = Math.Max(0, Math.Min(stock ?? 99, 99));
                price = entry.Value<double>("price");
                available = entry.Value<bool>("available") && cap > 0;
                detail = entry.Value<string>("blockedReason");
                if (string.IsNullOrEmpty(detail)) detail = stock.HasValue ? $"今日尚余 {stock.Value} 件" : "货源充足 · 单次最多 99 件";
            }
            else
            {
                var item = (app.CharacterView?["inventory"] as JArray)?.OfType<JObject>().FirstOrDefault(v => v.Value<string>("uid") == id);
                var prices = shop["sellPrices"] as JObject;
                if (item == null || item.Value<bool>("equipped") || item.Value<int>("qty") <= 0 || prices?[id] == null)
                { Text(parent, "物品已售出、已装备或不在本店回收范围，请返回货架。", "muted"); return; }
                string itemId = item.Value<string>("itemId");
                definition = app.Catalog.Find("items", itemId);
                name = definition?.Value<string>("name") ?? itemId; art = definition?.Value<string>("art");
                cap = Math.Min(999, item.Value<int>("qty")); price = prices[id].Value<double>(); available = true;
                detail = $"持有 {item["qty"]} 件 · 按本店回收价出售";
            }
            var card = Card(parent, name);
            card.AddToClassList("town-trade-detail");
            var preview = Row(card);
            Picture(preview, app.Catalog.Art(art), 64);
            Text(preview, definition?.Value<string>("description") ?? "", "muted");
            Text(card, detail, "muted");
            Text(card, $"{(kind == "buy" ? "单价" : "回收单价")} {price:N0} 灵石", "small");
            TownBalance(card, "small");
            TownTradeControls(card, shopId, kind, id, cap, price, available);
        }
        double TownStones => (double?)app.Character?["spiritStones"] ?? 0;
        void TownBalance(VisualElement parent, string styleClass)
        {
            var balance = Text(parent, "", styleClass);
            Action refresh = () => balance.text = $"持有灵石 {TownStones:N0}";
            refresh();
            balance.schedule.Execute(refresh).Every(250);
        }
        void TownTradeControls(VisualElement parent, string shopId, string kind, string id, int cap, double unitPrice, bool available)
        {
            string key = $"town-qty:{app.Character?.Value<string>("id")}:{shopId}:{kind}:{id}";
            var field = Field(parent, key, $"数量（1–{Math.Max(1, cap)}）", false, "1");
            var total = Text(parent, "", "small");
            var trade = Button(parent, kind == "buy" ? "买入" : "卖出", () =>
            {
                if (app.Busy || !TownQuantity(field.value, cap, out int qty) || !available) return;
                if (kind == "buy" && unitPrice * qty > TownStones) { app.Notice("灵石不足。"); return; }
                var input = new JObject { ["shopId"] = shopId, [kind == "buy" ? "itemId" : "uid"] = id, ["qty"] = qty };
                app.Command(kind == "buy" ? "shop.buy" : "shop.sell", input, result =>
                {
                    field.value = "1";
                    double delta = result.Value<double>("stonesDelta");
                    TownRefresh();
                    TownShowShop(shopId);
                    app.Notice(delta < 0 ? $"付出灵石 {Math.Abs(delta):N0}" : $"所得灵石 {delta:N0}");
                }, _ => app.Refresh("shop.list")); // Shared header shows app.Error once; refresh stock without hiding that error.
            }, false, kind == "buy" ? "primary" : "secondary");
            Action update = () =>
            {
                bool valid = TownQuantity(field.value, cap, out int qty);
                bool enough = kind == "sell" || valid && unitPrice * qty <= TownStones;
                total.text = cap == 0 ? "已售罄" : !valid ? $"请输入1–{cap}之间的整数" : (kind == "buy" ? "合计付出 " : "合计获得 ") + (unitPrice * qty).ToString("N0") + " 灵石" + (!enough ? "（灵石不足）" : "");
                trade.SetEnabled(valid && enough && available && !app.Busy);
            };
            field.RegisterValueChangedCallback(_ => update());
            update();
            // Focused fields defer page rebuilding; pushed income must still update affordability.
            field.schedule.Execute(update).Every(250);
        }
        static bool TownQuantity(string text, int cap, out int amount) => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out amount) && amount >= 1 && amount <= cap;

        [ContextMenu("Verify town quantity limits")]
        void TownVerifyQuantities()
        {
            Debug.Assert(TownQuantity("99", 99, out _) && TownQuantity("999", 999, out _), "Trade limits accepted");
            Debug.Assert(!TownQuantity("100", 99, out _) && !TownQuantity("0", 99, out _) && !TownQuantity("1", 0, out _) && !TownQuantity("1.5", 99, out _) && !TownQuantity("-1", 99, out _), "Invalid quantities rejected");
        }
    }
}
