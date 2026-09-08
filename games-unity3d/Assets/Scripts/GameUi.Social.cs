using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    public sealed partial class GameUi
    {
        string socialChannel = "world", socialOwner, socialPartyId, socialSearch = "", socialBoard = "realm";
        int socialDirectoryPage = 1, socialRankingPage = 1, socialRecordPage = 1;
        bool socialOnlineOnly;
        long socialBefore, socialRankingReadAt;
        JObject socialRankingSnapshot;
        readonly Dictionary<string, List<JObject>> socialMessages = new Dictionary<string, List<JObject>>();
        readonly List<JObject> socialReports = new List<JObject>();
        readonly HashSet<string> socialSeenReports = new HashSet<string>();
        VisualElement socialTranscript;
        TextField socialInput;
        Label socialSendState;
        Button socialSendButton;
        string socialPendingText, socialPendingChannel, socialSelfDungeon;
        JObject socialHeldDungeon;
        long socialPendingAt, socialNextChatAt;
        // Existing backend CHAT_MIN_INTERVAL_MS, modules/social/service.ts:22; shared across channels.
        const long socialChatIntervalMs = 1000;

        void RenderSocial()
        {
            SocialSession();
            socialTranscript = null;
            Heading("同道", "传音结伴，共赴仙途");
            var nav = Row(content);
            foreach (var entry in new[] { new[] { "social", "传音" }, new[] { "party", "组队" }, new[] { "friends", "道友" }, new[] { "directory", "名录" }, new[] { "dungeons", "秘境" }, new[] { "arena", "论道" }, new[] { "raid", "围攻" }, new[] { "rankings", "混沌榜" } })
            {
                string page = entry[0];
                Button(nav, entry[1], () => app.Navigate(page), true, app.Page == page ? "primary" : "secondary");
            }
            RenderSocialNotifications(content);
            switch (app.Page)
            {
                case "party": SocialParty(); break;
                case "friends": SocialFriends(); break;
                case "directory": SocialDirectory(); break;
                case "dungeons": SocialDungeons(); break;
                case "arena": SocialArena(); break;
                case "raid": SocialRaid(); break;
                case "rankings": SocialRankings(); break;
                default: SocialChat(); break;
            }
        }

        void SocialSession()
        {
            string owner = (string)app.Character?["id"];
            if (owner == socialOwner) return;
            socialOwner = owner;
            socialMessages.Clear(); socialReports.Clear(); socialSeenReports.Clear();
            socialPartyId = null; socialPendingText = null; socialSelfDungeon = null; socialHeldDungeon = null;
            socialChannel = "world"; socialBefore = 0; socialNextChatAt = 0;
        }

        JObject SocialRead(VisualElement parent, string route, JObject query = null)
        {
            var result = app.Data(route, query);
            if (result != null) return result;
            Text(parent, "正在读取资料；若读取失败，可重试。", "muted");
            Button(parent, "重新读取", () => app.Refresh(route), !app.Busy);
            return null;
        }

        void SocialChat()
        {
            var partyResponse = app.Data("party.get");
            if (partyResponse != null) SocialSyncParty((string)(partyResponse["party"] as JObject)?["id"]);
            var channels = Row(content);
            Button(channels, "世界", () => { socialChannel = "world"; socialBefore = 0; Rebuild(); }, true, socialChannel == "world" ? "primary" : "secondary");
            Button(channels, "队伍", () => { socialChannel = "party"; socialBefore = 0; Rebuild(); }, true, socialChannel == "party" ? "primary" : "secondary");
            Text(content, app.Connected ? "已连入传音" : "传音连接中断，待连接恢复后发送。", "muted");
            if (socialChannel == "party" && socialPartyId == null)
            {
                Text(content, partyResponse == null ? "正在读取队伍……" : "尚未结队，加入队伍后可传音。", "muted");
                Button(content, "前往组队", () => app.Navigate("party"));
                return;
            }
            var query = new JObject { ["channel"] = socialChannel, ["limit"] = 50 };
            if (socialChannel == "party") query["partyId"] = socialPartyId;
            if (socialBefore > 0) query["before"] = socialBefore;
            var history = SocialRead(content, "social.chatHistory", query);
            if (history?["messages"] is JArray messages)
                foreach (JObject message in messages) SocialMergeMessage(message);
            socialTranscript = Card(content, "传音簿");
            SocialDrawTranscript();
            var held = SocialCurrentMessages();
            if (history?["messages"] is JArray batch && batch.Count > 0)
                Button(content, "查看更早传音", () => { socialBefore = held.Min(message => (long?)message["sentAt"] ?? 0); Rebuild(); });
            else if (socialBefore > 0 && history != null) Text(content, "更早的传音已阅尽。", "muted");
            Button(content, "刷新最新传音", () => { socialBefore = 0; app.Refresh("social.chatHistory"); });
            socialInput = Field(content, "social-chat-" + socialChannel + "-" + (socialPartyId ?? "world"), "传音（最多200字）");
            socialInput.maxLength = 200;
            socialInput.multiline = true;
            socialSendState = Text(content, socialPendingText == null ? "" : "传音已提交，等待回音；未确认前保留原文。", "muted");
            socialSendButton = Button(content, "发送", SocialSendChat, false);
            SocialUpdateSendButton();
            // The element's schedule pauses when detached; rebuilding/changing channel installs a fresh one.
            socialSendButton.schedule.Execute(SocialUpdateSendButton).Every(100);
        }

        static bool SocialChatReady(long now, long nextChatAt, bool pending, long pendingAt) =>
            now >= nextChatAt && (!pending || now - pendingAt >= 8000);

        void SocialUpdateSendButton()
        {
            long now = app.ServerTime;
            socialSendButton?.SetEnabled(app.Connected && SocialChatReady(now, socialNextChatAt, socialPendingText != null, socialPendingAt));
            if (socialSendState == null) return;
            if (socialPendingText != null && now - socialPendingAt >= 8000)
                socialSendState.text = "暂未收到发送确认，请先刷新传音簿核对；原文仍保留。";
            else if (socialPendingText == null && socialNextChatAt > 0)
                socialSendState.text = now < socialNextChatAt ? "已发送，请稍候再传音。" : "已发送";
        }

        void SocialSendChat()
        {
            string text = socialInput?.value?.Trim() ?? "";
            if (!app.Connected) { app.Notice("尚未连入传音，请等待连接恢复。"); return; }
            if (text.Length < 1 || text.Length > 200) { app.Notice("传音需为1至200字。"); return; }
            if (!SocialChatReady(app.ServerTime, socialNextChatAt, socialPendingText != null, socialPendingAt))
            { app.Notice(socialPendingText != null ? "上一条传音尚待确认，请稍候。" : "传音稍歇，请稍候再发。"); return; }
            socialPendingText = text; socialPendingChannel = socialChannel; socialPendingAt = app.ServerTime;
            socialNextChatAt = socialPendingAt + socialChatIntervalMs;
            if (socialSendState != null) socialSendState.text = "已提交，等待回音；未确认前保留原文。";
            SocialUpdateSendButton();
            app.Emit("chat:send", new { channel = socialChannel, text });
        }

        string SocialChatKey(string channel) => channel == "party" ? "party:" + socialPartyId : "world";
        List<JObject> SocialCurrentMessages()
        {
            string key = SocialChatKey(socialChannel);
            if (!socialMessages.TryGetValue(key, out var list)) socialMessages[key] = list = new List<JObject>();
            return list;
        }
        void SocialSyncParty(string id)
        {
            if (id == socialPartyId) return;
            foreach (string key in socialMessages.Keys.Where(key => key.StartsWith("party:", StringComparison.Ordinal)).ToArray()) socialMessages.Remove(key);
            socialPartyId = id;
            socialBefore = 0;
            if (socialPendingChannel == "party") socialPendingText = null;
        }
        void SocialMergeMessage(JObject message)
        {
            string channel = (string)message["channel"];
            if (channel == "party" && socialPartyId == null) return;
            string key = SocialChatKey(channel);
            if (!socialMessages.TryGetValue(key, out var list)) socialMessages[key] = list = new List<JObject>();
            SocialAppendMessage(list, message);
            if (socialPendingText != null && (string)message["senderId"] == (string)app.Character?["id"] && (string)message["text"] == socialPendingText && channel == socialPendingChannel && ((long?)message["sentAt"] ?? 0) >= socialPendingAt - 1000)
            {
                if (socialInput != null && socialChannel == socialPendingChannel && socialInput.value.Trim() == socialPendingText) socialInput.value = "";
                socialPendingText = null;
                socialNextChatAt = app.ServerTime + socialChatIntervalMs;
                SocialUpdateSendButton();
            }
        }
        static void SocialAppendMessage(List<JObject> list, JObject message)
        {
            string id = (string)message["id"];
            if (!list.Any(entry => (string)entry["id"] == id)) list.Add((JObject)message.DeepClone());
            list.Sort((a, b) => ((long?)a["sentAt"] ?? 0).CompareTo((long?)b["sentAt"] ?? 0));
        }
        void SocialDrawTranscript()
        {
            if (socialTranscript == null) return;
            socialTranscript.Clear();
            var messages = SocialCurrentMessages();
            if (messages.Count == 0) Text(socialTranscript, "暂无传音。", "muted");
            foreach (var message in messages)
            {
                string id = (string)message["senderId"];
                var line = Card(socialTranscript);
                string name = (string)message["senderName"];
                if (!string.IsNullOrEmpty(id)) Button(line, name + " · " + SocialTime(message["sentAt"]), () => SocialOpenProfile(id));
                else Text(line, "天地传讯 · " + SocialTime(message["sentAt"]), "small");
                Text(line, (string)message["text"]);
            }
        }

        void SocialParty()
        {
            var response = SocialRead(content, "party.get");
            if (response == null) return;
            var party = response["party"] as JObject;
            SocialSyncParty((string)party?["id"]);
            if (party == null)
            {
                var empty = Card(content, "尚未结队");
                Button(empty, "建立队伍", () => app.Command("party.create"), !app.Busy);
                var code = Field(empty, "social-party-code", "队伍邀请码");
                code.maxLength = 12;
                Button(empty, "凭码入队", () =>
                {
                    string value = code.value.Trim().ToUpperInvariant();
                    if (value.Length < 4 || value.Length > 12) { app.Notice("请输入4至12位邀请码。"); return; }
                    app.Command("party.join", new JObject { ["code"] = value });
                }, !app.Busy);
                return;
            }
            var members = party["members"] as JArray ?? new JArray();
            var head = Card(content, "同行 " + members.Count + " / " + party["maxSize"]);
            string invite = (string)party["code"];
            Text(head, "邀请码：" + invite, "section-title");
            Button(head, "复制邀请码", () => { GUIUtility.systemCopyBuffer = invite; app.Notice("邀请码已复制。"); });
            Text(head, "将邀请码告知同道，对方在组队页输入即可加入。", "muted");
            bool leader = (string)party["leaderId"] == (string)app.Character?["id"];
            foreach (JObject member in members)
            {
                string id = (string)member["characterId"];
                var card = SocialPerson(content, member, id);
                if ((bool?)member["isLeader"] == true) Text(card, "队长", "section-title");
                Meter(card, (float?)member["hpPercent"] ?? 0, "当前气血 " + ((double?)member["hpPercent"] ?? 0).ToString("P0"));
                if (leader && id != (string)app.Character?["id"])
                    Button(card, "请离队伍", () => SocialConfirm("请离队伍", "请 " + member["name"] + " 离开当前队伍？", () => app.Command("party.kick", new JObject { ["characterId"] = id }, _ => CloseSheet())), !app.Busy);
            }
            Button(content, "结伴入秘境", () => app.Navigate("dungeons"));
            Button(content, "队伍传音", () => { socialChannel = "party"; app.Navigate("social"); });
            Button(content, "离开队伍", () => SocialConfirm("离队", leader ? "离队后，队长会交由剩余成员；无人时队伍解散。" : "离开当前队伍？", () => app.Command("party.leave", null, _ => CloseSheet())), !app.Busy);
            Button(content, "刷新队伍", () => app.Refresh("party.get"));
        }

        void SocialFriends()
        {
            Button(content, "前往名录结交同道", () => app.Navigate("directory"));
            var data = SocialRead(content, "social.friends");
            if (data == null) return;
            var friends = data["friends"] as JArray ?? new JArray();
            if (friends.Count == 0) Text(content, "尚未结交道友，也没有待回应的名帖。", "muted");
            foreach (JObject friend in friends)
            {
                string id = (string)friend["characterId"], state = (string)friend["state"];
                var card = SocialPerson(content, friend, id);
                Text(card, state == "accepted" ? "已结交" : state == "pending_in" ? "来帖待回应" : "名帖已递，静候回音", "muted");
                if (state == "pending_in") Button(card, "接受名帖", () => app.Command("social.friendAccept", new JObject { ["characterId"] = id }), !app.Busy);
                string action = state == "accepted" ? "解除道友" : state == "pending_in" ? "谢绝名帖" : "撤回名帖";
                Button(card, action, () => SocialConfirm(action, action + "：" + friend["name"] + "？", () => app.Command("social.friendRemove", new JObject { ["characterId"] = id }, _ => CloseSheet())), !app.Busy);
            }
            Button(content, "刷新道友", () => app.Refresh("social.friends"));
        }

        void SocialDirectory()
        {
            var search = Field(content, "social-search", "道号检索（最多20字）", false, socialSearch);
            search.maxLength = 20;
            var controls = Row(content);
            Button(controls, "检索", () => { socialSearch = search.value.Trim(); socialDirectoryPage = 1; app.Refresh("character.cultivators"); });
            Button(controls, socialOnlineOnly ? "仅在线 · 开" : "仅在线 · 关", () => { socialOnlineOnly = !socialOnlineOnly; socialDirectoryPage = 1; Rebuild(); });
            var query = new JObject { ["q"] = socialSearch, ["onlyOnline"] = socialOnlineOnly, ["page"] = socialDirectoryPage, ["pageSize"] = 20 };
            var data = SocialRead(content, "character.cultivators", query);
            if (data == null) return;
            var people = data["items"] as JArray ?? new JArray();
            if (people.Count == 0) Text(content, "未寻到符合条件的修士。", "muted");
            foreach (JObject person in people) SocialPerson(content, person, (string)person["id"]);
            SocialPages(content, data, socialDirectoryPage, page => { socialDirectoryPage = page; Rebuild(); });
        }

        void SocialOpenProfile(string id)
        {
            ShowSheet("修士名帖", parent =>
            {
                var profile = SocialRead(parent, "character.publicProfile", new JObject { ["id"] = id });
                if (profile == null) return;
                Art(parent, (string)profile["avatarArt"], 100);
                Text(parent, profile["name"] + ((bool?)profile["isBot"] == true ? " · 傀儡" : ""), "section-title");
                Text(parent, profile["stageName"] + " · 战力 " + SocialNumber(profile["powerScore"]));
                Text(parent, ((bool?)profile["online"] == true ? "在线" : "离线 · 最近 " + SocialTime(profile["lastSeenAt"])), "muted");
                var root = profile["spiritRoot"];
                Text(parent, CharacterElement((string)root?["element"]) + " · " + ((string)root?["quality"] == "heaven" ? "天灵根" : (string)root?["quality"] == "rare" ? "异灵根" : "凡灵根"));
                Text(parent, "论道 " + profile["arenaRating"] + " · " + profile["arenaWins"] + " 胜 " + profile["arenaLosses"] + " 负");
                Text(parent, "功法：" + ((string)profile["techniqueName"] ?? "未择功法"));
                foreach (string key in new[] { "hp", "atk", "def", "spd", "crit", "critResist", "acc", "eva" })
                    Text(parent, SocialStatLabel(key) + "　" + CharacterStat(key, profile["stats"]?[key]), "small");
                var skills = profile["skillIds"] as JArray ?? new JArray();
                Text(parent, "神通：" + (skills.Count == 0 ? "未装配" : string.Join(" · ", skills.Select(token => app.Catalog.Name("skills", (string)token)))));
                var equipment = profile["equipment"] as JArray ?? new JArray();
                foreach (string slot in new[] { "treasure", "robe", "accessory", "pet" })
                {
                    var piece = equipment.FirstOrDefault(entry => (string)entry["slot"] == slot);
                    Text(parent, BagSlotName(slot) + "：" + ((string)piece?["name"] ?? "未着") + (piece == null ? "" : " · " + BagGrade((string)piece["grade"])));
                }
                if (id == (string)app.Character?["id"]) { Text(parent, "这是你自己的名帖。", "muted"); return; }
                var friends = app.Data("social.friends");
                var relation = (friends?["friends"] as JArray)?.FirstOrDefault(friend => (string)friend["characterId"] == id);
                string state = (string)relation?["state"];
                if (state == "pending_in") Button(parent, "接受名帖", () => app.Command("social.friendAccept", new JObject { ["characterId"] = id }), !app.Busy);
                else if (state != null) Text(parent, state == "accepted" ? "已结为道友" : "名帖已递，静候回音", "muted");
                else Button(parent, "加为道友", () => app.Command("social.friendRequest", new JObject { ["characterId"] = id }), !app.Busy && friends != null);
                Button(parent, "切磋论道", () => SocialChallenge(id), !app.Busy);
                var partyData = app.Data("party.get");
                var party = partyData?["party"] as JObject;
                if (party != null)
                {
                    string code = (string)party["code"];
                    Text(parent, "本队邀请码：" + code + "；请将此码告知道友。", "muted");
                    Button(parent, "复制邀请码", () => { GUIUtility.systemCopyBuffer = code; app.Notice("邀请码已复制。"); });
                }
                else Button(parent, "建队以取得邀请码", () => app.Command("party.create"), !app.Busy && partyData != null);
            });
        }

        void SocialDungeons()
        {
            var data = SocialRead(content, "explore.dungeons");
            var partyData = app.Data("party.get");
            var party = partyData?["party"] as JObject;
            if (data == null) return;
            Button(content, "查看 / 建立队伍", () => app.Navigate("party"));
            var dungeons = data["dungeons"] as JArray ?? new JArray();
            if (dungeons.Count == 0) Text(content, "暂未发现秘境。", "muted");
            foreach (JObject dungeon in dungeons)
            {
                string id = (string)dungeon["id"];
                var card = Card(content, (string)dungeon["name"]);
                Art(card, (string)dungeon["art"], 96);
                Text(card, (string)dungeon["description"]);
                Text(card, "门槛 " + CharacterStage((int)dungeon["unlockStage"]) + " · 建议 " + CharacterStage((int)dungeon["recommendedStage"]) + " / " + dungeon["partySize"] + " 人", "muted");
                Text(card, "妖王：" + dungeon["boss"]?["name"]);
                int remaining = Math.Max(0, (int)dungeon["dailyLimit"] - (int)dungeon["runsToday"]);
                Text(card, "今日剩余 " + remaining + " / " + dungeon["dailyLimit"] + " 次");
                Text(card, "奖励预览 · 修为 " + SocialNumber(dungeon["reward"]?["exp"]) + " · 灵石 " + SocialNumber(dungeon["reward"]?["spiritStones"]), "muted");
                foreach (var drop in dungeon["reward"]?["loot"] as JArray ?? new JArray())
                    Text(card, app.Catalog.Name("items", (string)drop["itemId"]) + " " + drop["min"] + "–" + drop["max"] + " 件 · 掉落率 " + ((double?)drop["chance"] ?? 0).ToString("P0"), "small");
                bool ready = (bool?)dungeon["unlocked"] == true && remaining > 0;
                Button(card, "独闯", () => SocialStartDungeon(id, false), ready && !app.Busy);
                bool leader = party != null && (string)party["leaderId"] == (string)app.Character?["id"];
                Button(card, "带队入境", () => SocialStartDungeon(id, true), ready && leader && !app.Busy);
                if (!ready) Text(card, remaining == 0 ? "今日次数已尽。" : "境界尚未达到。", "muted");
                if (!leader) Text(card, partyData == null ? "正在读取队伍。" : party == null ? "结队后可由队长带队。" : "由队长开启队伍秘境。", "muted");
            }
            Button(content, "刷新秘境与次数", () => app.Refresh("explore.dungeons", "party.get"));
        }

        void SocialStartDungeon(string id, bool withParty)
        {
            if (app.Busy) return;
            if (withParty) { socialSelfDungeon = id; socialHeldDungeon = null; }
            app.Command("explore.startDungeon", new JObject { ["dungeonId"] = id, ["withParty"] = withParty }, result =>
            {
                socialSeenReports.Add(SocialDungeonKey(result));
                socialSelfDungeon = null; socialHeldDungeon = null;
                ShowBattle(result, "秘境 · " + app.Catalog.Name("dungeons", id));
            }, _ =>
            {
                socialSelfDungeon = null;
                if (socialHeldDungeon != null) { SocialQueueReport(socialHeldDungeon, "队伍秘境战报", SocialDungeonKey(socialHeldDungeon)); socialHeldDungeon = null; }
            });
        }

        void SocialArena()
        {
            var data = SocialRead(content, "arena.opponents");
            if (data == null) return;
            int count = (int)data["challengesToday"], limit = (int)data["dailyLimit"];
            Text(content, "天梯 " + data["rating"] + " · 今日论道 " + count + " / " + limit);
            var opponents = data["opponents"] as JArray ?? new JArray();
            if (opponents.Count == 0) Text(content, "暂未寻到可论道的修士。", "muted");
            foreach (JObject opponent in opponents)
            {
                string id = (string)opponent["id"];
                var card = SocialPerson(content, opponent, id);
                Text(card, "胜算参考 " + ((double?)opponent["winHint"] ?? 0).ToString("P0") + "，以实际交战为准。", "muted");
                Button(card, "论道", () => SocialChallenge(id), !app.Busy && count < limit);
            }
            if (count >= limit) Text(content, "今日论道次数已尽。", "muted");
            Button(content, "刷新对手", () => app.Refresh("arena.opponents"));
            var recordsCard = Card(content, "论道战绩");
            var records = SocialRead(recordsCard, "arena.records", new JObject { ["page"] = socialRecordPage, ["pageSize"] = 20 });
            if (records == null) return;
            var entries = records["items"] as JArray ?? new JArray();
            if (entries.Count == 0) Text(recordsCard, "尚无论道战绩。", "muted");
            foreach (JObject record in entries)
            {
                var row = Card(recordsCard, record["attackerName"] + " 对 " + record["defenderName"]);
                string winner = (string)record["winnerId"];
                Text(row, SocialTime(record["foughtAt"]) + " · " + (winner == null ? "未分胜负" : winner == (string)app.Character?["id"] ? "胜" : "负"));
                Text(row, "天梯变动 " + record["ratingDelta"], "muted");
                if (record["battle"] is JObject battle) Button(row, "回看", () => ShowBattle(battle, "论道战绩"));
                else Text(row, "此场回放已不在保存期。", "muted");
            }
            SocialPages(recordsCard, records, socialRecordPage, page => { socialRecordPage = page; Rebuild(); });
        }
        void SocialChallenge(string id)
        {
            app.Command("arena.challenge", new JObject { ["targetId"] = id }, result => ShowBattle(result, "论道 · " + result["opponent"]?["name"]));
        }

        void SocialRaid()
        {
            Text(content, "围攻共享气血，击破后结算悬赏；队伍模式召集当前可参战成员。", "muted");
            var data = SocialRead(content, "raid.targets");
            var partyData = app.Data("party.get");
            var party = partyData?["party"] as JObject;
            if (data == null) return;
            var targets = data["targets"] as JArray ?? new JArray();
            if (targets.Count == 0) Text(content, "暂无围攻目标。", "muted");
            foreach (JObject target in targets)
            {
                string id = (string)target["id"];
                var card = SocialPerson(content, target, id);
                Meter(card, (float?)target["hpPercent"] ?? 0, "剩余气血 " + ((double?)target["hpPercent"] ?? 0).ToString("P0"));
                Text(card, "悬赏池 " + SocialNumber(target["bounty"]) + " 灵石");
                long until = (long?)target["protectedUntil"] ?? 0;
                bool protectedNow = until > app.ServerTime;
                if (protectedNow) Text(card, "闭关疗伤至 " + SocialTime(target["protectedUntil"]) + "，届时刷新查看。", "muted");
                Button(card, "独自围攻", () => SocialAttack(id, false), !app.Busy && !protectedNow);
                Button(card, "结伴围攻", () => SocialAttack(id, true), !app.Busy && !protectedNow && party != null);
            }
            Button(content, "刷新血池与保护状态", () => app.Refresh("raid.targets", "party.get"));
            Button(content, "前往组队", () => app.Navigate("party"));
        }
        void SocialAttack(string id, bool withParty)
        {
            app.Command("raid.attack", new JObject { ["botId"] = id, ["withParty"] = withParty }, result => ShowBattle(result, "围攻 · " + result["target"]?["name"]));
        }

        void SocialRankings()
        {
            var tabs = Row(content);
            foreach (var entry in new[] { new[] { "realm", "境界榜" }, new[] { "power", "战力榜" }, new[] { "arena", "论道榜" } })
            {
                string board = entry[0];
                Button(tabs, entry[1], () => { socialBoard = board; socialRankingPage = 1; Rebuild(); }, true, socialBoard == board ? "primary" : "secondary");
            }
            var data = SocialRead(content, "character.rankings", new JObject { ["board"] = socialBoard, ["page"] = socialRankingPage, ["pageSize"] = 20 });
            if (data == null) return;
            if (!ReferenceEquals(data, socialRankingSnapshot)) { socialRankingSnapshot = data; socialRankingReadAt = app.ServerTime; }
            Text(content, "本页读取于 " + SocialTime(new JValue(socialRankingReadAt)), "muted");
            var items = data["items"] as JArray ?? new JArray();
            var me = items.FirstOrDefault(entry => (string)entry["characterId"] == (string)app.Character?["id"]);
            Text(content, me == null ? "本页未列出你的名次。" : "你的名次：第 " + me["rank"] + " 位", "section-title");
            if (items.Count == 0) Text(content, "榜单尚未张贴。", "muted");
            foreach (JObject item in items)
            {
                var card = SocialPerson(content, item, (string)item["characterId"]);
                Text(card, "第 " + item["rank"] + " 位 · " + (socialBoard == "realm" ? (string)item["stageName"] : socialBoard == "power" ? "战力 " + SocialNumber(item["powerScore"]) : "天梯 " + item["arenaRating"]), "section-title");
            }
            SocialPages(content, data, socialRankingPage, page => { socialRankingPage = page; Rebuild(); });
            Button(content, "刷新榜单", () => app.Refresh("character.rankings"));
        }

        VisualElement SocialPerson(VisualElement parent, JObject person, string id)
        {
            var card = Card(parent);
            var row = Row(card);
            Art(row, (string)person["avatarArt"], 60);
            Button(row, (string)person["name"] + ((bool?)person["isBot"] == true ? " · 傀儡" : ""), () => SocialOpenProfile(id));
            Text(card, person["stageName"] + " · 战力 " + SocialNumber(person["powerScore"]) + ((bool?)person["online"] == true ? " · 在线" : " · 离线"), "muted");
            return card;
        }
        void SocialPages(VisualElement parent, JObject data, int page, Action<int> change)
        {
            var row = Row(parent);
            Text(row, "第 " + page + " 页 · 共 " + data["total"] + " 条", "muted");
            Button(row, "上一页", () => change(page - 1), page > 1);
            Button(row, "下一页", () => change(page + 1), (bool?)data["hasMore"] == true);
        }
        void SocialConfirm(string title, string message, Action confirm)
        {
            ShowSheet(title, parent => { Text(parent, message); Button(parent, "确认", confirm, !app.Busy, "primary"); Button(parent, "取消", CloseSheet); });
        }

        void RenderSocialNotifications(VisualElement parent)
        {
            if (socialReports.Count == 0) return;
            Button(parent, "待阅战报 " + socialReports.Count, () => ShowSheet("待阅战报", sheet =>
            {
                foreach (JObject report in socialReports.ToArray())
                {
                    var card = Card(sheet, (string)report["title"]);
                    Text(card, (string)report["summary"] ?? "战斗已结算，可查看完整回放。");
                    Button(card, "查看回放", () => { socialReports.Remove(report); ShowBattle((JObject)report["result"], (string)report["title"]); });
                    Button(card, "已阅", () => { socialReports.Remove(report); Rebuild(); });
                }
                if (socialReports.Count == 0) Text(sheet, "战报已阅尽。", "muted");
            }));
        }
        void SocialQueueReport(JObject result, string title, string key, string summary = null)
        {
            if (!socialSeenReports.Add(key)) return;
            socialReports.Insert(0, new JObject { ["title"] = title, ["summary"] = summary, ["result"] = result.DeepClone() });
            app.Notice(title + "，可在“待阅战报”查看。");
            Rebuild();
        }
        static string SocialDungeonKey(JObject result) => "dungeon:" + result["dungeonId"] + ":" + (result["battles"] ?? result["replay"])?.ToString(Formatting.None);

        void HandleSocialRealtime(string eventName, JToken data)
        {
            SocialSession();
            var value = data as JObject;
            if (value == null) return;
            switch (eventName)
            {
                case "chat:message":
                    SocialMergeMessage(value);
                    if (app.Page == "social") SocialDrawTranscript();
                    break;
                case "party:update":
                    SocialSyncParty((string)(value["party"] as JObject)?["id"]);
                    app.Refresh("party.get", "social.chatHistory");
                    string reason = (string)value["reason"], actor = (string)value["actorName"] ?? "同道";
                    if (reason != "sync") app.Notice(reason == "joined" ? actor + "入队" : reason == "left" ? actor + "离队" : reason == "kicked" ? actor + "被请离队伍" : reason == "disbanded" ? "队伍已散" : actor + "接任队长");
                    break;
                case "friend:request":
                    app.Notice(value["fromName"] + "递来道友名帖，请前往道友页回应。");
                    app.Refresh("social.friends");
                    break;
                case "dungeon:start":
                    if (socialSelfDungeon != (string)value["dungeonId"]) app.Notice("队伍已进入 " + value["dungeonName"]);
                    break;
                case "dungeon:result":
                    if (socialSelfDungeon == (string)value["dungeonId"]) socialHeldDungeon = (JObject)value.DeepClone();
                    else SocialQueueReport(value, "队伍秘境 · " + value["dungeonName"], SocialDungeonKey(value));
                    app.Refresh("explore.dungeons", "party.get");
                    app.RefreshCharacter();
                    break;
                case "arena:challenged":
                    SocialQueueReport(value, "来访论道 · " + value["attackerName"], "arena:" + value["attackerId"] + ":" + value["foughtAt"], ((bool?)value["defenderLost"] == true ? "此战未能守住" : "此战守住了") + " · 天梯 " + value["ratingDelta"]);
                    app.Refresh("arena.records", "arena.opponents", "character.rankings");
                    app.RefreshCharacter();
                    break;
                case "raid:update":
                    app.Refresh("raid.targets");
                    if ((bool?)value["defeated"] == true) app.Notice(value["botName"] + "已被击破。");
                    break;
                case "presence:update":
                    if (app.Page == "party" || app.Page == "friends" || app.Page == "directory") app.Refresh("party.get", "social.friends", "character.cultivators");
                    break;
            }
        }

        static string SocialNumber(JToken number) => number == null || number.Type == JTokenType.Null ? "—" : ((double)number).ToString("N0");
        static string SocialTime(JToken time) => time == null || time.Type == JTokenType.Null ? "—" : DateTimeOffset.FromUnixTimeMilliseconds((long)time).ToLocalTime().ToString("MM-dd HH:mm:ss");
        static string SocialStatLabel(string key) => key == "hp" ? "气血" : key == "atk" ? "攻击" : key == "def" ? "防御" : key == "spd" ? "速度" : key == "crit" ? "暴击" : key == "critResist" ? "抗暴" : key == "acc" ? "命中" : "闪避";

        [ContextMenu("Check social chat and dungeon deduplication")]
        void SocialCheckDeduplication()
        {
            var list = new List<JObject>();
            var message = new JObject { ["id"] = "later", ["sentAt"] = 20 };
            SocialAppendMessage(list, message); SocialAppendMessage(list, message);
            SocialAppendMessage(list, new JObject { ["id"] = "earlier", ["sentAt"] = 10 });
            UnityEngine.Assertions.Assert.IsTrue(list.Count == 2 && (string)list[0]["id"] == "earlier" && !ReferenceEquals(list[1], message));
            var rest = new JObject { ["dungeonId"] = "d", ["battles"] = new JArray(new JObject { ["winner"] = "A" }) };
            var realtime = new JObject { ["dungeonId"] = "d", ["replay"] = rest["battles"].DeepClone() };
            UnityEngine.Assertions.Assert.AreEqual(SocialDungeonKey(rest), SocialDungeonKey(realtime));
            UnityEngine.Assertions.Assert.IsFalse(SocialChatReady(1999, 2000, false, 0), "Confirm cooldown also blocks a different channel");
            UnityEngine.Assertions.Assert.IsTrue(SocialChatReady(2000, 2000, false, 0), "Enabled at the one-second boundary");
            UnityEngine.Assertions.Assert.IsFalse(SocialChatReady(8999, 2000, true, 1000), "Unconfirmed send remains blocked before eight seconds");
            UnityEngine.Assertions.Assert.IsTrue(SocialChatReady(9000, 2000, true, 1000), "After eight seconds only manual retry becomes available");
        }
    }
}
