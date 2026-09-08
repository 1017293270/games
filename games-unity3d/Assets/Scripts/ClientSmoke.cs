using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    // Explicit opt-in, isolated fixture only. Exercises real UI Toolkit Button default actions.
    // This is a reproducible core journey, not a declaration that the whole migration is accepted.
    public sealed class ClientSmoke : MonoBehaviour
    {
        Bootstrap app;
        UIDocument document;
        string evidenceDir, currentStep, screenshotFailure;
        string smokeMode = "full";
        GameConnection observedConnection;
        int connectionDisconnects;
        long connectionEnteredAt;
        JObject fixture, report, activeStep;
        int stepNumber;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Activate()
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.IndexOf(args, "-qingyunSmoke");
            if (at < 0) return;
            var runner = new GameObject("Qingyun Client Smoke").AddComponent<ClientSmoke>();
            runner.evidenceDir = at + 1 < args.Length ? args[at + 1] : "";
            int modeAt = Array.IndexOf(args, "-qingyunSmokeMode");
            if (modeAt >= 0) runner.smokeMode = modeAt + 1 < args.Length ? args[modeAt + 1] : "";
            DontDestroyOnLoad(runner.gameObject);
            runner.StartCoroutine(runner.Guarded());
        }

        IEnumerator Guarded()
        {
            var stack = new Stack<IEnumerator>();
            stack.Push(Run());
            Exception failure = null;
            while (stack.Count > 0)
            {
                object value = null;
                bool moved = false;
                try { moved = stack.Peek().MoveNext(); if (moved) value = stack.Peek().Current; }
                catch (Exception error) { failure = error; break; }
                if (!moved) { stack.Pop(); continue; }
                if (value is IEnumerator nested) stack.Push(nested);
                else yield return value;
            }
            if (failure != null)
            {
                Debug.LogError("CLIENT_SMOKE_FAILED " + failure);
                if (report != null)
                {
                    report["failure"] = failure.ToString();
                    if (activeStep != null) { activeStep["status"] = "failed"; activeStep["failure"] = failure.Message; activeStep["after"] = State(); }
                    yield return Capture("failure");
                }
            }
            if (report != null)
            {
                report["coreJourneyPassed"] = failure == null;
                report["finishedAt"] = DateTimeOffset.UtcNow.ToString("O");
                File.WriteAllText(Path.Combine(evidenceDir, "client-smoke.json"), report.ToString(Formatting.Indented));
            }
            Debug.Log(failure == null ? "CLIENT_SMOKE_CORE_PASSED (full migration acceptance remains incomplete)" : "CLIENT_SMOKE_FAILED");
            Application.Quit(failure == null ? 0 : 1);
        }

        IEnumerator Run()
        {
            if (smokeMode != "full" && smokeMode != "connection" && smokeMode != "commerce") throw new InvalidOperationException("Unknown -qingyunSmokeMode; expected full, connection or commerce");
            if (string.IsNullOrWhiteSpace(evidenceDir)) throw new InvalidOperationException("-qingyunSmoke requires the fresh fixture evidence directory");
            evidenceDir = Path.GetFullPath(evidenceDir);
            string manifest = Path.Combine(evidenceDir, "fixture.json");
            if (!File.Exists(manifest)) throw new InvalidOperationException("fixture.json is required; run tools/client-fixture.mjs first");
            fixture = JObject.Parse(File.ReadAllText(manifest));
            if ((int?)fixture["smokeFixtureVersion"] != 1) throw new InvalidOperationException("Unknown fixture format");
            if (smokeMode == "full" && (!(fixture["raidBots"] is JArray bots) || bots.Count == 0 || !(fixture["newAccount"] is JObject)))
                throw new InvalidOperationException("Expanded smoke requires a fresh fixture with raidBots and newAccount; do not reuse an older fixture");
            if (smokeMode == "connection" && (bool?)fixture["connection"]?["enabled"] != true)
                throw new InvalidOperationException("Connection mode requires a new fixture started with QINGYUN_SMOKE_MODE=connection");
            if (smokeMode == "commerce" && ((bool?)fixture["commerce"]?["enabled"] != true || new Uri((string)fixture["serverUrl"]).Port == 3191))
                throw new InvalidOperationException("Commerce requires a new commerce fixture, not port 3191");
            if (File.Exists(Path.Combine(evidenceDir, "client-smoke.json"))) throw new InvalidOperationException("Refusing to overwrite earlier acceptance evidence; create a new fixture");
            report = new JObject
            {
                ["startedAt"] = DateTimeOffset.UtcNow.ToString("O"), ["coreJourneyPassed"] = false, ["mode"] = smokeMode,
                ["fullMigrationAccepted"] = false, ["interaction"] = "UI Toolkit NavigationSubmitEvent on real Button; TextField.value changes trigger real bindings; app.Navigate only assists navigation",
                ["limitation"] = "Keyboard-submit binding acceptance; screenshots require human visual review. Pointer hit testing, drag gestures and mobile performance are not verified.",
                ["steps"] = new JArray(),
                ["notCovered"] = new JArray("network loss and retry", "insufficient resources and locked states", "all equipment slots and quantity limits", "paid gacha/ten-draw/idempotent retry", "all treasure/relic stars and ceilings", "all daily/achievement rewards", "shop limits and every quest/chapter", "all dungeon difficulties and defeat branches", "arena defence notification and expired records", "raid repeated attacks/protection expiry/concurrent raiders", "rankings pagination/out-of-page self rank", "world multi-client/PvP/Boss and long offline farming", "all exploration outcomes; this run samples one server-selected branch", "second Unity client; peer uses actual REST/Socket.IO", "full mobile visual and accessibility acceptance")
            };
            yield return Until(() => (app = FindAnyObjectByType<Bootstrap>()) != null && (document = app.GetComponent<UIDocument>()) != null, "Bootstrap and UIDocument initialization");
            if (!IsIsolatedUrl(app.ServerUrl) || app.ServerUrl.TrimEnd('/') != ((string)fixture["serverUrl"]).TrimEnd('/'))
                throw new InvalidOperationException("Smoke driver refuses non-loopback, port 3100, or a server different from its fixture");
            report["serverUrl"] = app.ServerUrl;
            if (app.LoggedIn) throw new InvalidOperationException("Start without -qingyunDemo or an existing login; this driver tests login through UI");

            if (smokeMode == "connection")
            {
                report["notCovered"] = new JArray("37-step functional journey is deliberately not rerun", "long-duration offline gains/Boss/PvP", "multiple simultaneous tabs", "repeated transport failures and expired auth", "mobile/background process suspension", "all possible packet interleavings", "pointer hit testing and human visual acceptance");
                report["connectionTrace"] = new JArray();
                observedConnection = app.GetComponent<GameConnection>();
                observedConnection.ConnectionChanged += ObserveConnection;
                yield return Step("connection-login-select-before-old-none", ConnectionQuickSelect());
                yield return Step("connection-home-keeps-membership", ConnectionHome());
                yield return Step("connection-disconnect-hidden-resume", ConnectionCut(true));
                yield return Step("connection-show-same-zone", ConnectionShow());
                yield return Step("connection-explicit-retreat", ConnectionRetreat());
                yield return Step("connection-reconnect-stays-out", ConnectionCut(false));
                yield break;
            }

            if (smokeMode == "commerce")
            {
                report["notCovered"] = new JArray("37-step journey is not rerun", "all items and shop stock limits", "pointer input and mobile performance");
                yield return Step("commerce-login", Login());
                yield return Step("commerce-shelf", CommerceShelf());
                yield return Step("commerce-focused-balance-and-cancel", CommerceBalance());
                yield return Step("commerce-buy-two", CommerceBuy());
                yield return Step("commerce-sell-one", ShopSell());
                if ((long)app.Character["spiritStones"] != 45 || !string.IsNullOrEmpty(app.Error)) throw new InvalidOperationException("Commerce final balance/error mismatch");
                yield break;
            }

            yield return Step("login-ui", Login());
            yield return Step("home-breakthrough", Breakthrough());
            yield return Step("character-learn-technique", LearnTechnique());
            yield return Step("character-equip-technique", EquipTechnique());
            yield return Step("character-learn-skill", LearnSkill());
            yield return Step("character-equip-skill", EquipSkill());
            yield return Step("bag-equip-uid", EquipRobe());
            yield return Step("bag-use-real-stat-pill", UseStatPill());
            yield return Step("treasures-starter", ClaimStarter());
            yield return Step("treasures-main-slot-and-upgrade", EquipTreasure());
            yield return Step("gacha-free-relic", DrawRelic());
            yield return Step("relics-infuse", InfuseRelic());
            yield return Step("town-real-dialogue", TownDialogue());
            yield return Step("social-accept-real-peer", AcceptPeer());
            yield return Step("social-create-party-peer-joins", CreateParty());
            yield return Step("social-world-chat-two-way", SendChat("world"));
            yield return Step("social-party-chat-two-way", SendChat("party"));
            yield return Step("daily-claim-chat", ClaimChatDaily());
            yield return Step("town-shop-buy", ShopBuy());
            yield return Step("town-shop-sell", ShopSell());
            yield return Step("quest-accept", QuestAccept());
            yield return Step("quest-talk-objective", QuestObjective());
            yield return Step("quest-submit-reward", QuestSubmit());
            yield return Step("dungeon-solo-replay", Dungeon(false));
            yield return Step("dungeon-party-peer-reward", Dungeon(true));
            yield return Step("arena-challenge-record", Arena());
            yield return Step("bag-heal-before-raid", Heal());
            yield return Step("raid-server-blood-pool", Raid());
            yield return Step("rankings-realm", Ranking("realm", "境界榜"));
            yield return Step("rankings-power", Ranking("power", "战力榜"));
            yield return Step("rankings-arena", Ranking("arena", "论道榜"));
            yield return Step("directory-public-profile", PublicProfile());
            yield return Step("world-second-map-gather", Gather());
            yield return Step("world-explore-branch", Explore());
            yield return Step("world-second-map-enter-retreat", EnterRetreat());
            yield return Step("logout-relogin-persistence", Relogin());
            yield return Step("register-create-new-character", RegisterCharacter());
        }

        static bool IsIsolatedUrl(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.Port == 3100 || uri.Port < 1 || uri.UserInfo.Length != 0) return false;
            return uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]" || uri.Host == "::1";
        }
        IEnumerator Step(string name, IEnumerator action)
        {
            currentStep = (++stepNumber).ToString("D2") + "-" + name;
            activeStep = new JObject { ["id"] = currentStep, ["status"] = "running", ["before"] = State(), ["buttonsSubmitted"] = new JArray() };
            ((JArray)report["steps"]).Add(activeStep);
            yield return Capture(currentStep + "-before");
            if (screenshotFailure != null) throw new InvalidOperationException(screenshotFailure);
            yield return action;
            yield return Until(() => !app.Busy, name + " completes");
            yield return new WaitForSecondsRealtime(.2f);
            activeStep["after"] = State(); activeStep["status"] = "passed";
            yield return Capture(currentStep + "-after");
            if (screenshotFailure != null) throw new InvalidOperationException(screenshotFailure);
            File.WriteAllText(Path.Combine(evidenceDir, "client-smoke.json"), report.ToString(Formatting.Indented));
            Debug.Log("CLIENT_SMOKE_STEP " + currentStep + " passed");
        }
        JObject State() => new JObject
        {
            ["at"] = DateTimeOffset.UtcNow.ToString("O"), ["page"] = app?.Page, ["busy"] = app?.Busy,
            ["connected"] = app?.Connected, ["error"] = app?.Error,
            ["activeZoneId"] = app?.ActiveZoneId,
            ["connectionServer"] = smokeMode == "connection" ? ConnectionState() : null,
            ["characterView"] = app?.CharacterView?.DeepClone(),
            ["visibleLabels"] = new JArray(document == null ? Enumerable.Empty<string>() : Root.Query<Label>().ToList().Where(Visible).Select(label => label.text)),
            ["visibleButtons"] = new JArray(document == null ? Enumerable.Empty<string>() : Root.Query<Button>().ToList().Where(Visible).Select(button => button.text))
        };
        VisualElement Root => document.rootVisualElement;
        IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            Texture2D texture = null;
            try
            {
                texture = ScreenCapture.CaptureScreenshotAsTexture();
                if (texture == null) throw new InvalidOperationException("Screenshot unavailable: launch a rendered player, not -nographics");
                File.WriteAllBytes(Path.Combine(evidenceDir, name + ".png"), texture.EncodeToPNG());
                File.WriteAllText(Path.Combine(evidenceDir, name + ".json"), State().ToString(Formatting.Indented));
            }
            catch (Exception error) { screenshotFailure = error.Message; if (report != null) report["screenshotFailure"] = screenshotFailure; }
            finally { if (texture != null) Destroy(texture); }
        }
        IEnumerator Until(Func<bool> predicate, string reason, float timeout = 30)
        {
            float end = Time.realtimeSinceStartup + timeout;
            while (!predicate())
            {
                if (Time.realtimeSinceStartup > end) throw new TimeoutException(reason + "; UI error: " + (app?.Error ?? "none"));
                yield return null;
            }
        }
        static bool Visible(VisualElement element)
        {
            for (var p = element; p != null; p = p.parent)
                if (p.resolvedStyle.display == DisplayStyle.None || p.resolvedStyle.visibility == Visibility.Hidden) return false;
            return element.panel != null;
        }
        Button FindButton(string label, string card = null)
        {
            var scope = Root.Q<VisualElement>(className: "sheet");
            if (scope == null || !Visible(scope)) scope = Root;
            var candidates = scope.Query<Button>().ToList().Where(button => button.text == label && button.enabledInHierarchy && Visible(button));
            if (card != null) candidates = candidates.Where(button =>
            {
                for (var parent = button.parent; parent != null && parent != scope; parent = parent.parent)
                    if (parent.ClassListContains("card") && parent.Query<TextElement>().ToList().Any(text => text.text != null && text.text.StartsWith(card, StringComparison.Ordinal))) return true;
                return false;
            });
            var result = candidates.ToArray();
            if (result.Length > 1) throw new InvalidOperationException("Ambiguous button: " + label + " in " + card);
            return result.FirstOrDefault();
        }
        IEnumerator Click(string label, string card = null)
        {
            Button button = null;
            yield return Until(() => !app.Busy && (button = FindButton(label, card)) != null, "enabled UI button " + label + " in " + card);
            for (var parent = button.parent; parent != null; parent = parent.parent)
                if (parent is ScrollView scroll) { scroll.ScrollTo(button); break; }
            yield return null;
            if (button.panel == null) { yield return Click(label, card); yield break; }
            ((JArray)activeStep["buttonsSubmitted"]).Add(new JObject { ["text"] = label, ["card"] = card, ["at"] = DateTimeOffset.UtcNow.ToString("O"), ["epochMs"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
            button.Focus();
            using (var submit = NavigationSubmitEvent.GetPooled()) { submit.target = button; button.SendEvent(submit); }
            yield return new WaitForSecondsRealtime(.15f);
        }
        IEnumerator CloseSheet()
        {
            if (Root.Q<VisualElement>(className: "sheet") != null) yield return Click("关闭");
            yield return null;
        }
        IEnumerator Navigate(string page)
        {
            yield return CloseSheet();
            app.Navigate(page);
            yield return Until(() => app.Page == page && !app.Busy, "navigate " + page);
            yield return new WaitForSecondsRealtime(.25f);
        }
        void Fill(string name, string value)
        {
            var field = Root.Q<TextField>(name);
            if (field == null || !Visible(field)) throw new InvalidOperationException("Missing visible input " + name);
            field.value = value; // Sends ChangeEvent and executes the production binding.
        }
        bool HasLabel(string text) => Root.Query<Label>().ToList().Any(label => Visible(label) && label.text != null && label.text.Contains(text));
        int Quantity(string id) => (app.CharacterView?["inventory"] as JArray ?? new JArray()).Where(row => (string)row["itemId"] == id).Sum(row => (int)row["qty"]);
        JObject Progression => app.Data("progression.get")?["progression"] as JObject;

        IEnumerator Login()
        {
            yield return Until(() => Root.Q<TextField>("auth-user") != null, "login form");
            Fill("auth-user", (string)fixture["main"]["username"]); Fill("auth-pass", (string)fixture["main"]["password"]);
            yield return Click("进入仙府");
            yield return Until(() => app.Character != null && app.Connected && !app.Busy, "authenticated character and socket");
            if ((string)app.Character["id"] != (string)fixture["main"]["characterId"]) throw new InvalidOperationException("Wrong fixture character");
            yield return CloseSheet();
        }
        IEnumerator Breakthrough()
        {
            yield return Navigate("home");
            int pills = Quantity("pill-breakthrough"), stage = (int)app.Character["stageIndex"];
            yield return Click("运功破境"); yield return Click("4 颗"); yield return Click("起念破境");
            yield return Until(() => !app.Busy && Quantity("pill-breakthrough") == pills - 4 && (HasLabel("突破成功") || HasLabel("此次未能破境")), "actual breakthrough receipt and four pills consumed");
            activeStep["outcome"] = (int)app.Character["stageIndex"] > stage ? "success" : "legitimate failed breakthrough; outcome is server-authoritative";
            yield return Click("收功");
        }
        IEnumerator LearnTechnique()
        {
            yield return Navigate("character"); yield return Click("功法");
            long stones = (long)app.Character["spiritStones"];
            yield return Click("参悟", app.Catalog.Name("techniques", "tech-lieyang"));
            yield return Until(() => ((JArray)app.Character["learnedTechniqueIds"]).Values<string>().Contains("tech-lieyang") && (long)app.Character["spiritStones"] == stones - (long)app.Catalog.Find("techniques", "tech-lieyang")["learnCost"], "technique learned and cost deducted");
        }
        IEnumerator EquipTechnique()
        {
            yield return Click("改修此功法", app.Catalog.Name("techniques", "tech-lieyang"));
            yield return Until(() => (string)app.Character["techniqueId"] == "tech-lieyang", "technique equipped");
        }
        IEnumerator LearnSkill()
        {
            yield return Click("神通"); long stones = (long)app.Character["spiritStones"];
            yield return Click("参悟", app.Catalog.Name("skills", "skill-metal-2"));
            yield return Until(() => ((JArray)app.Character["learnedSkillIds"]).Values<string>().Contains("skill-metal-2") && (long)app.Character["spiritStones"] == stones - (long)app.Catalog.Find("skills", "skill-metal-2")["learnCost"], "skill learned and cost deducted");
        }
        IEnumerator EquipSkill()
        {
            yield return Click("第 2 槽 · 空槽");
            yield return Click("装入此槽", app.Catalog.Name("skills", "skill-metal-2"));
            yield return Until(() => (string)app.Character["skillSlots"][1] == "skill-metal-2", "second skill slot persisted");
        }
        IEnumerator EquipRobe()
        {
            yield return Navigate("bag");
            string uid = (string)((JArray)app.CharacterView["inventory"]).First(row => (string)row["itemId"] == "robe-daoist")["uid"];
            double before = (double)app.CharacterView["stats"]["def"];
            yield return Click("查看详情", app.Catalog.Name("items", "robe-daoist")); yield return Click("穿戴");
            yield return Until(() => (string)app.Character["equipment"]["robe"] == uid && (double)app.CharacterView["stats"]["def"] > before, "instance uid equipped and actual defence increased");
            yield return CloseSheet();
        }
        IEnumerator UseStatPill()
        {
            int qty = Quantity("pill-power"); double atk = (double)app.CharacterView["stats"]["atk"];
            yield return Click("查看详情", app.Catalog.Name("items", "pill-power"));
            string uid = (string)((JArray)app.CharacterView["inventory"]).First(row => (string)row["itemId"] == "pill-power")["uid"];
            Fill("bag-qty-" + uid, "1"); yield return Click("确认服用");
            yield return Until(() => Quantity("pill-power") == qty - 1 && (double)app.CharacterView["stats"]["atk"] > atk, "pill consumed and real combat stat increased");
            yield return CloseSheet();
        }
        IEnumerator ClaimStarter()
        {
            yield return Navigate("treasures"); yield return Click("领取入门法宝");
            yield return Until(() => Progression?.Value<bool>("starterClaimed") == true && (Progression["treasures"] as JArray)?.Count >= 2, "starter grant persisted");
            yield return CloseSheet();
        }
        IEnumerator EquipTreasure()
        {
            yield return Click("鉴赏 / 养成", app.Catalog.Name("treasures", "t-starter-shield"));
            yield return Click("设为本命");
            yield return Until(() => (Progression?["treasures"] as JArray)?.Any(t => (string)t["definitionId"] == "t-starter-shield" && (int?)t["slot"] == 0) == true, "main treasure slot persisted");
            int before = (int)Progression["materials"]["starStones"];
            yield return Click("升级");
            yield return Until(() => (Progression?["treasures"] as JArray)?.Any(t => (string)t["definitionId"] == "t-starter-shield" && (int)t["level"] == 2) == true && (int)Progression["materials"]["starStones"] < before, "treasure upgraded and material consumed");
            yield return CloseSheet();
        }
        IEnumerator DrawRelic()
        {
            yield return Navigate("gacha"); yield return Click("古宝遗珍");
            yield return Until(() => Progression != null, "gacha state");
            int before = (int)Progression["gacha"]["relic"]["total"];
            yield return Click("每日免费寻宝");
            yield return Until(() => (int?)Progression?["gacha"]?["relic"]?["total"] == before + 1 && (Progression["relics"] as JArray)?.Count > 0, "real free relic draw result");
            yield return Click("收入囊中");
        }
        IEnumerator InfuseRelic()
        {
            yield return Navigate("relics"); yield return Until(() => Progression != null, "relic state");
            string id = (string)Progression["relics"][0]["definitionId"];
            int before = (int)Progression["materials"]["stardust"];
            yield return Click("鉴赏 / 养成", app.Catalog.Name("relics", id)); yield return Click("注灵");
            yield return Until(() => (Progression?["relics"] as JArray)?.Any(r => (string)r["definitionId"] == id && (int)r["spiritLevel"] == 1) == true && (int)Progression["materials"]["stardust"] < before, "relic infusion persisted");
            yield return CloseSheet();
        }
        IEnumerator TownDialogue()
        {
            yield return Navigate("town"); JObject roster = null;
            yield return Until(() => (roster = app.Data("npc.list")) != null, "NPC roster");
            var npc = ((JArray)roster["npcs"]).First(n => (bool)n["unlocked"]);
            string label = npc.Value<string>("shopId") == null ? "叙话" : "叙话 · 交易";
            yield return Click(label, (string)npc["name"]);
            yield return Until(() => !app.Busy && Root.Q<VisualElement>(className: "sheet") != null && (FindButton("离开叙话") != null || FindButton("告辞") != null), "server dialogue choices visible");
            activeStep["dialogueUi"] = State();
            yield return Capture(currentStep + "-dialogue");
            yield return Click(FindButton("离开叙话") != null ? "离开叙话" : "告辞");
        }
        IEnumerator AcceptPeer()
        {
            yield return Navigate("friends"); yield return Click("接受名帖", (string)fixture["peer"]["name"]);
            yield return Until(() => (app.Data("social.friends")?["friends"] as JArray)?.Any(f => (string)f["characterId"] == (string)fixture["peer"]["characterId"] && (string)f["state"] == "accepted") == true && PeerObserved("peer-friend-accepted"), "friend accepted on both real clients");
            activeStep["friendsResponse"] = app.Data("social.friends").DeepClone();
        }
        IEnumerator CreateParty()
        {
            yield return Navigate("party"); yield return Click("建立队伍");
            yield return Until(() => (app.Data("party.get")?["party"] as JObject)?["members"] is JArray members && members.Count == 2 && PeerObserved("peer-joined"), "UI created party and peer joined");
            activeStep["partyResponse"] = app.Data("party.get").DeepClone();
        }
        IEnumerator SendChat(string channel)
        {
            yield return Navigate("social"); yield return Click(channel == "party" ? "队伍" : "世界");
            string suffix = channel + "-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            yield return Until(() => Root.Query<TextField>().ToList().Any(field => field.name.StartsWith("social-chat-", StringComparison.Ordinal) && Visible(field)), "chat input");
            var input = Root.Query<TextField>().ToList().First(field => field.name.StartsWith("social-chat-", StringComparison.Ordinal) && Visible(field));
            input.value = "验收传音:" + suffix; yield return Click("发送");
            yield return Until(() => HasLabel("同道已收到:" + suffix) && PeerObserved("验收传音:" + suffix), "peer receives and replies in " + channel);
            activeStep["peerEvents"] = new JArray(File.ReadAllLines(Path.Combine(evidenceDir, "peer-events.jsonl")).Where(line => line.Contains(suffix)).Select(JObject.Parse));
        }
        IEnumerator ClaimChatDaily()
        {
            yield return Navigate("daily"); yield return Until(() => Progression != null, "daily state");
            int before = (int)Progression["materials"]["jade"];
            yield return Click("领取日课奖励", "仙友传音");
            yield return Until(() => (Progression?["daily"]?["claimed"] as JArray)?.Values<string>().Contains("chat") == true && (int)Progression["materials"]["jade"] > before, "chat daily reward credited");
        }

        IEnumerator OpenNpc(string id)
        {
            yield return Navigate("town"); yield return Click("镇民");
            JObject data = null;
            yield return Until(() => (data = app.Data("npc.list")) != null, "NPC list");
            var npc = ((JArray)data["npcs"]).First(n => (string)n["id"] == id);
            yield return Click(npc.Value<string>("shopId") == null ? "叙话" : "叙话 · 交易", (string)npc["name"]);
            yield return Until(() => !app.Busy && Root.Q<VisualElement>(className: "sheet") != null, "NPC dialogue arrives");
        }
        IEnumerator CommerceShelf()
        {
            yield return OpenNpc("npc-yaowang"); yield return Click("看看丹药");
            yield return Until(() => FindButton("买入", app.Catalog.Name("items", "pill-qi")) != null, "commerce shelf");
            if ((long)app.Character["spiritStones"] != 50 || app.ActiveZoneId != null || !HasLabel("灵石 50"))
                throw new InvalidOperationException("Commerce initial balance/shelf/zone mismatch");
        }
        IEnumerator CommerceBalance()
        {
            string name = app.Catalog.Name("items", "pill-qi");
            yield return Click("买入", name);
            string key = "town-qty:" + app.Character["id"] + ":shop-yaowang:buy:pill-qi";
            foreach (string invalid in new[] { "0", "100" })
            {
                Fill(key, invalid); yield return null;
                if (FindButton("买入", name) != null) throw new InvalidOperationException("Invalid trade quantity enabled: " + invalid);
            }
            Fill(key, "2");
            var field = Root.Q<TextField>(key); field.Focus();
            yield return null;
            if (FindButton("买入", name) != null) throw new InvalidOperationException("120-stone purchase enabled with only 50 stones");
            int quantity = Quantity("pill-qi");
            yield return Capture("commerce-confirm-insufficient-focused");
            File.WriteAllText(Path.Combine(evidenceDir, "commerce-control.json"), new JObject { ["id"] = "commerce-grant-100", ["action"] = "grant-100" }.ToString());
            JObject serverState = null;
            yield return Until(() =>
            {
                serverState = JObject.Parse(File.ReadAllText(Path.Combine(evidenceDir, "commerce-state.json")));
                if (serverState["error"] != null) throw new InvalidOperationException("Commerce fixture: " + serverState["error"]);
                return (bool?)serverState["granted"] == true && (long?)serverState["view"]?["character"]?["spiritStones"] == 150 &&
                    (long)app.Character["spiritStones"] == 150 && HasLabel("持有灵石 150") && FindButton("买入", name) != null;
            }, "real grant updates balance and focused purchase availability");
            var focused = field.panel?.focusController.focusedElement as VisualElement;
            bool hasFocus = false;
            for (var element = focused; element != null; element = element.parent) if (element == field) hasFocus = true;
            if (!hasFocus || Root.Q<TextField>(key) != field || field.value != "2" || Quantity("pill-qi") != quantity ||
                serverState["mainZoneId"]?.Type != JTokenType.Null || !HasLabel("持有灵石 150") || !string.IsNullOrEmpty(app.Error))
                throw new InvalidOperationException("Focused input, quantity, balance label, inventory or zone changed incorrectly");
            activeStep["grantServer"] = serverState.DeepClone();
            activeStep["focusedQuantityPreserved"] = true;
            yield return Capture("commerce-confirm-funded-focused");
            yield return Click("返回货架");
            yield return Until(() => HasLabel("灵石 150"), "fresh shelf balance");
            if ((long)app.Character["spiritStones"] != 150 || Quantity("pill-qi") != quantity)
                throw new InvalidOperationException("Returning to shelf consumed currency or inventory");
        }
        IEnumerator CommerceBuy()
        {
            string name = app.Catalog.Name("items", "pill-qi");
            int quantity = Quantity("pill-qi");
            yield return Click("买入", name);
            Fill("town-qty:" + app.Character["id"] + ":shop-yaowang:buy:pill-qi", "2");
            yield return Capture("commerce-confirm-buy-two");
            yield return Click("买入", name);
            yield return Until(() => Quantity("pill-qi") == quantity + 2 && (long)app.Character["spiritStones"] == 30 && HasLabel("灵石 30"), "two pills cost exactly 120");
            if (!string.IsNullOrEmpty(app.Error)) throw new InvalidOperationException(app.Error);
        }
        IEnumerator ShopBuy()
        {
            yield return OpenNpc("npc-yaowang"); yield return Click("看看丹药");
            JObject shop = null;
            yield return Until(() => (shop = app.Data("shop.list", new JObject { ["shopId"] = "shop-yaowang" })) != null, "actual shop prices");
            var entry = ((JArray)shop["entries"]).First(e => (string)e["itemId"] == "pill-qi");
            long before = (long)app.Character["spiritStones"], price = (long)entry["price"];
            int quantity = Quantity("pill-qi");
            activeStep["shopBefore"] = shop.DeepClone();
            yield return Click("买入", app.Catalog.Name("items", "pill-qi"));
            Fill("town-qty:" + app.Character["id"] + ":shop-yaowang:buy:pill-qi", "2");
            yield return Click("买入", app.Catalog.Name("items", "pill-qi"));
            yield return Until(() => Quantity("pill-qi") == quantity + 2 && (long)app.Character["spiritStones"] == before - price * 2, "shop purchase quantity and exact price");
        }
        IEnumerator ShopSell()
        {
            yield return Click("卖出");
            JObject shop = null;
            yield return Until(() => (shop = app.Data("shop.list", new JObject { ["shopId"] = "shop-yaowang" })) != null, "buyback prices");
            string uid = (string)((JArray)app.CharacterView["inventory"]).First(i => (string)i["itemId"] == "pill-qi")["uid"];
            int quantity = Quantity("pill-qi");
            long before = (long)app.Character["spiritStones"], price = (long)shop["sellPrices"][uid];
            yield return Click("卖出", app.Catalog.Name("items", "pill-qi"));
            Fill("town-qty:" + app.Character["id"] + ":shop-yaowang:sell:" + uid, "1");
            if (smokeMode == "commerce") yield return Capture("commerce-confirm-sell-one");
            yield return Click("卖出", app.Catalog.Name("items", "pill-qi"));
            yield return Until(() => Quantity("pill-qi") == quantity - 1 && (long)app.Character["spiritStones"] == before + price, "instance sold and exact buyback credited");
            if (smokeMode == "commerce") yield return Capture("commerce-shelf-after-sale");
            yield return CloseSheet();
        }
        JToken QuestState => (app.Character?["quests"] as JArray)?.FirstOrDefault(q => (string)q["questId"] == "quest-c1-01");
        IEnumerator QuestAccept()
        {
            yield return Navigate("town"); yield return Click("任务簿");
            yield return Click("接下差事", app.Catalog.Name("quests", "quest-c1-01"));
            yield return Until(() => QuestState != null && new[] { "active", "completed" }.Contains((string)QuestState["state"]), "quest accepted");
        }
        IEnumerator QuestObjective()
        {
            yield return OpenNpc("npc-zhenshou");
            yield return Until(() => (QuestState?["counters"] as JArray)?.Any(c => (int)c >= 1) == true, "talk objective counted by server");
            activeStep["questProgress"] = QuestState.DeepClone();
            yield return CloseSheet();
        }
        IEnumerator QuestSubmit()
        {
            yield return Navigate("town"); yield return Click("任务簿");
            long stones = (long)app.Character["spiritStones"];
            var quest = app.Catalog.Find("quests", "quest-c1-01");
            int qty = Quantity("pill-qi");
            yield return Click("复命领赏", (string)quest["name"]);
            int pillReward = ((JArray)quest["reward"]["items"]).Where(i => (string)i["itemId"] == "pill-qi").Sum(i => (int)i["qty"]);
            yield return Until(() => (string)QuestState?["state"] == "claimed" && (long)app.Character["spiritStones"] == stones + (long)quest["reward"]["spiritStones"] && Quantity("pill-qi") == qty + pillReward, "quest submission and actual reward");
        }

        IEnumerator FinishReplay()
        {
            var waves = new JArray(); activeStep["replayFrames"] = waves;
            for (int wave = 1; wave <= 20; wave++)
            {
                yield return Click("跳过本阵");
                yield return Until(() => FindButton("进入下一阵") != null || FindButton("收功") != null, "server battle wave verdict");
                waves.Add(State()); yield return Capture(currentStep + "-wave-" + wave);
                if (FindButton("进入下一阵") != null) { yield return Click("进入下一阵"); continue; }
                yield return Click("收功"); yield break;
            }
            throw new InvalidOperationException("Replay exceeded the safety bound of 20 observed waves");
        }
        JObject PeerState() => JObject.Parse(File.ReadAllText(Path.Combine(evidenceDir, "peer-state.json")))["view"] as JObject;
        IEnumerator Dungeon(bool team)
        {
            yield return Navigate("dungeons"); JObject list = null;
            yield return Until(() => (list = app.Data("explore.dungeons")) != null, "dungeon list");
            var dungeon = ((JArray)list["dungeons"]).First(d => (bool)d["unlocked"] && (int)d["runsToday"] < (int)d["dailyLimit"]);
            int count = (int)app.Character["dailyCounters"]["dungeon"];
            long stones = (long)app.Character["spiritStones"];
            var peerBefore = PeerState();
            activeStep["dungeonBefore"] = dungeon.DeepClone(); activeStep["peerBefore"] = peerBefore;
            yield return Click(team ? "带队入境" : "独闯", (string)dungeon["name"]);
            yield return Until(() => !app.Busy && (int)app.Character["dailyCounters"]["dungeon"] == count + 1, "dungeon entry charged exactly once");
            yield return FinishReplay();
            int expectedWaves = ((JArray)dungeon["waves"]).Count + 1;
            var replayFrames = (JArray)activeStep["replayFrames"];
            if (replayFrames.Count != expectedWaves || !((JArray)replayFrames.Last()["visibleLabels"]).Values<string>().Contains("秘境通关"))
                throw new InvalidOperationException("Fixture dungeon did not render every successful wave; inspect the actual verdict");
            if ((long)app.Character["spiritStones"] <= stones) throw new InvalidOperationException("Fixture dungeon did not return a positive clear reward; review actual replay");
            if (team)
            {
                yield return Until(() => PeerObserved("peer-dungeon-state") && (int)PeerState()["character"]["dailyCounters"]["dungeon"] == (int)peerBefore["character"]["dailyCounters"]["dungeon"] + 1 && (long)PeerState()["character"]["spiritStones"] > (long)peerBefore["character"]["spiritStones"], "peer actual dungeon reward and entry");
                activeStep["peerAfter"] = PeerState();
                activeStep["peerDungeonEvents"] = new JArray(File.ReadAllLines(Path.Combine(evidenceDir, "peer-events.jsonl")).Select(JObject.Parse).Where(e => (string)e["kind"] == "dungeon:result" || (string)e["kind"] == "peer-dungeon-state"));
                var peerResult = ((JArray)activeStep["peerDungeonEvents"]).Last(e => (string)e["kind"] == "dungeon:result")["value"];
                if ((bool?)peerResult["cleared"] != true || ((JArray)peerResult["replay"]).Count != expectedWaves || !((JArray)peerResult["participantIds"]).Values<string>().Contains((string)fixture["main"]["characterId"]) || !((JArray)peerResult["participantIds"]).Values<string>().Contains((string)fixture["peer"]["characterId"]))
                    throw new InvalidOperationException("Peer did not receive the same successful team dungeon with both participants");
                long peerDelta = (long)PeerState()["character"]["spiritStones"] - (long)peerBefore["character"]["spiritStones"];
                if (peerDelta != (long)peerResult["reward"]["spiritStones"]) throw new InvalidOperationException("Peer wallet does not match its dungeon reward receipt");
            }
        }
        IEnumerator Arena()
        {
            yield return Navigate("arena"); JObject data = null;
            yield return Until(() => (data = app.Data("arena.opponents")) != null, "arena opponents");
            var opponent = ((JArray)data["opponents"]).First();
            int before = (int)app.Character["dailyCounters"]["arena"];
            yield return Click("论道", (string)opponent["name"]);
            yield return Until(() => !app.Busy && (int)app.Character["dailyCounters"]["arena"] == before + 1, "actual arena challenge counted");
            yield return FinishReplay(); JObject records = null;
            yield return Until(() => (records = app.Data("arena.records", new JObject { ["page"] = 1, ["pageSize"] = 20 })) != null && ((JArray)records["items"]).Any(r => (string)r["attackerId"] == (string)app.Character["id"] && (string)r["defenderId"] == (string)opponent["id"] && r["battle"] is JObject), "server arena history contains replay");
            activeStep["arenaRecords"] = records.DeepClone();
        }
        IEnumerator Heal()
        {
            yield return Navigate("bag"); yield return Click("查看详情", app.Catalog.Name("items", "pill-heal"));
            string uid = (string)((JArray)app.CharacterView["inventory"]).First(i => (string)i["itemId"] == "pill-heal")["uid"];
            int before = Quantity("pill-heal");
            Fill("bag-qty-" + uid, "5"); yield return Click("确认服用");
            yield return Until(() => Quantity("pill-heal") == before - 5 && (double)app.Character["hpPercent"] >= .99, "healing pills restore actual HP");
            yield return CloseSheet();
        }
        IEnumerator Raid()
        {
            yield return Navigate("raid"); JObject data = null;
            yield return Until(() => (data = app.Data("raid.targets")) != null, "raid targets");
            string id = (string)fixture["raidBots"][0]["id"];
            var target = ((JArray)data["targets"]).First(t => (string)t["id"] == id);
            double hp = (double)target["hpPercent"];
            activeStep["targetBefore"] = target.DeepClone();
            yield return Click("结伴围攻", (string)target["name"]);
            yield return FinishReplay();
            yield return Until(() => (data = app.Data("raid.targets")) != null && ((JArray)data["targets"]).Any(t => (string)t["id"] == id && (double)t["hpPercent"] < hp), "real shared raid HP decreases");
            activeStep["targetAfter"] = ((JArray)data["targets"]).First(t => (string)t["id"] == id).DeepClone();
        }
        IEnumerator Ranking(string board, string label)
        {
            yield return Navigate("rankings"); yield return Click(label); JObject data = null;
            yield return Until(() => (data = app.Data("character.rankings", new JObject { ["board"] = board, ["page"] = 1, ["pageSize"] = 20 })) != null && ((JArray)data["items"]).Count > 0, "real " + board + " rankings");
            var top = data["items"][0];
            yield return Until(() => HasLabel("第 " + top["rank"] + " 位"), "ranking row rendered");
            activeStep["rankingResponse"] = data.DeepClone();
        }
        IEnumerator PublicProfile()
        {
            yield return Navigate("directory"); Fill("social-search", (string)fixture["peer"]["name"]); yield return Click("检索");
            yield return Click((string)fixture["peer"]["name"]); JObject profile = null;
            yield return Until(() => (profile = app.Data("character.publicProfile", new JObject { ["id"] = fixture["peer"]["characterId"] })) != null && HasLabel("这是你自己的名帖。") == false && Root.Q<VisualElement>(className: "sheet") != null && HasLabel("功法："), "peer full public profile rendered");
            if ((string)profile["id"] != (string)fixture["peer"]["characterId"]) throw new InvalidOperationException("Wrong public profile");
            activeStep["publicProfile"] = profile.DeepClone(); yield return CloseSheet();
        }
        const string smokeSecondMap = "map-luoshui-city";
        IEnumerator Gather()
        {
            yield return Navigate("world"); JObject maps = null;
            yield return Until(() => (maps = app.Data("explore.maps")) != null, "maps");
            long stones = (long)app.Character["spiritStones"];
            yield return Click("采药", app.Catalog.Name("maps", smokeSecondMap));
            yield return Until(() => !app.Busy && (long)app.Character["spiritStones"] > stones && (app.Data("explore.maps")?["maps"] as JArray)?.Any(m => (string)m["id"] == smokeSecondMap && (long)m["gatherReadyAt"] > app.ServerTime) == true, "gather rewards and server cooldown");
            activeStep["mapsAfter"] = app.Data("explore.maps").DeepClone();
        }
        IEnumerator Explore()
        {
            yield return Click("探索机缘", app.Catalog.Name("maps", smokeSecondMap));
            yield return Until(() => !app.Busy && Root.Q<VisualElement>(className: "sheet") != null, "server exploration branch");
            if (FindButton("跳过本阵") != null) { activeStep["sampledBranch"] = "battle"; yield return FinishReplay(); yield break; }
            var encounter = app.Catalog.Table("encounters").OfType<JObject>().FirstOrDefault(e => HasLabel((string)e["name"]));
            if (encounter == null) throw new InvalidOperationException("No known actual encounter is visible");
            var option = ((JArray)encounter["options"]).FirstOrDefault(o => FindButton((string)o["text"]) != null);
            if (option == null) throw new InvalidOperationException("Encounter has no available option");
            activeStep["sampledBranch"] = encounter["id"];
            yield return Click((string)option["text"]);
            yield return Until(() => HasLabel("机缘既成"), "real encounter result");
            yield return Capture(currentStep + "-outcome"); yield return Click("继续前行");
        }
        IEnumerator EnterRetreat()
        {
            yield return Click("入境挂机", app.Catalog.Name("maps", smokeSecondMap));
            yield return Until(() => app.WatchingZone && app.ActiveZoneId == smokeSecondMap, "joined second map through real socket");
            yield return new WaitForSecondsRealtime(2);
            activeStep["joined"] = State(); yield return Capture(currentStep + "-joined");
            yield return Click("撤离秘境");
            yield return Until(() => app.ActiveZoneId == null && !app.WatchingZone, "real retreat confirmation");
        }
        IEnumerator LogoutUi()
        {
            yield return CloseSheet(); yield return Click("设置"); yield return Click("退出当前账号");
            yield return Until(() => !app.LoggedIn && Root.Q<TextField>("auth-user") != null, "logout returns login form");
        }
        IEnumerator Relogin()
        {
            var equipment = app.Character["equipment"].DeepClone(); var skills = app.Character["skillSlots"].DeepClone();
            string technique = (string)app.Character["techniqueId"];
            yield return LogoutUi(); yield return Login();
            if (!JToken.DeepEquals(equipment, app.Character["equipment"]) || !JToken.DeepEquals(skills, app.Character["skillSlots"]) || (string)app.Character["techniqueId"] != technique)
                throw new InvalidOperationException("Equipped state changed across reauthentication");
            if (!((JArray)app.Character["progression"]["daily"]["claimed"]).Values<string>().Contains("chat")) throw new InvalidOperationException("Daily claim was lost across login");
        }
        IEnumerator RegisterCharacter()
        {
            yield return LogoutUi(); yield return Click("注册");
            Fill("auth-user", (string)fixture["newAccount"]["username"]); Fill("auth-pass", (string)fixture["newAccount"]["password"]);
            yield return Click("注册入门"); yield return Until(() => app.NeedsCharacter && Root.Q<TextField>("create-name") != null, "new account reaches character creation");
            Fill("create-name", (string)fixture["newAccount"]["name"]); yield return Click("立道号 · 入青云");
            yield return Until(() => app.Character != null && !app.Busy && (string)app.Character["name"] == (string)fixture["newAccount"]["name"] && app.Connected, "new character and socket created");
            if ((string)app.Character["id"] == (string)fixture["main"]["characterId"]) throw new InvalidOperationException("New account reused main character");
        }

        JObject ConnectionState()
        {
            string path = Path.Combine(evidenceDir, "connection-state.json");
            return File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : null;
        }
        void ObserveConnection(bool connected)
        {
            if (!connected) connectionDisconnects++;
            (report?["connectionTrace"] as JArray)?.Add(new JObject { ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["connected"] = connected, ["page"] = app.Page, ["activeZoneId"] = app.ActiveZoneId });
        }
        IEnumerator ConnectionQuickSelect()
        {
            yield return Login();
            yield return Navigate("world");
            yield return Click("入境挂机", app.Catalog.Name("maps", smokeSecondMap));
            long clickedAt = (long)((JArray)activeStep["buttonsSubmitted"]).Last(b => (string)b["text"] == "入境挂机")["epochMs"];
            yield return Until(() => ConnectionState()?.Value<long?>("resumeNoneDeliveredAt") != null && app.WatchingZone && app.ActiveZoneId == smokeSecondMap && (string)ConnectionState()?["mainZoneId"] == smokeSecondMap, "explicit second-map intent survives the delayed initial none", 40);
            var server = ConnectionState();
            long deliveredAt = (long)server["resumeNoneDeliveredAt"];
            if (clickedAt >= deliveredAt) throw new InvalidOperationException("Race was not exercised: the explicit map button was submitted after the delayed none reply; increase fixture delay");
            connectionEnteredAt = (long)server["latestJoined"]["enteredAt"];
            activeStep["mapClickEpochMs"] = clickedAt; activeStep["oldNoneDeliveredEpochMs"] = deliveredAt;
            activeStep["interleavingProved"] = true;
        }
        IEnumerator ConnectionHome()
        {
            yield return Navigate("home");
            yield return Until(() => !app.WatchingZone && app.ActiveZoneId == smokeSecondMap && (string)ConnectionState()?["mainZoneId"] == smokeSecondMap && (ConnectionState()?["mainWatchingZones"] as JArray)?.All(z => z.Type == JTokenType.Null) == true, "home leaves the viewport while preserving server membership");
            yield return new WaitForSecondsRealtime(2);
            if ((string)ConnectionState()?["mainZoneId"] != smokeSecondMap) throw new InvalidOperationException("Returning home removed the server-side character from its map");
        }
        IEnumerator ConnectionCut(bool expectStanding)
        {
            var before = ConnectionState();
            var oldIds = ((JArray)before["mainSocketIds"]).Values<string>().ToArray();
            if (oldIds.Length == 0 || !app.Connected) throw new InvalidOperationException("No live main-player socket to disconnect");
            int clientCuts = connectionDisconnects, serverCuts = (int)before["disconnectCount"];
            string requestId = Guid.NewGuid().ToString("N");
            // A fixture-only file signal closes the real transport; it never sends a game command.
            File.WriteAllText(Path.Combine(evidenceDir, "connection-control.json"), new JObject { ["id"] = requestId, ["action"] = "disconnect" }.ToString(Formatting.None));
            yield return Until(() => connectionDisconnects > clientCuts && (int?)ConnectionState()?["disconnectCount"] > serverCuts, "real client and server observed a transport disconnect");
            activeStep["observedDisconnected"] = State();
            yield return Until(() => app.Connected && (ConnectionState()?["mainSocketIds"] as JArray)?.Values<string>().Any(id => !oldIds.Contains(id)) == true, "a new authenticated Socket.IO session is connected", 40);
            if (expectStanding)
            {
                yield return Until(() => app.Page == "home" && !app.WatchingZone && app.ActiveZoneId == smokeSecondMap && (string)ConnectionState()?["mainZoneId"] == smokeSecondMap && (long?)ConnectionState()?["latestJoined"]?["enteredAt"] == connectionEnteredAt, "hidden reconnect restores the existing standing membership without resetting entry time");
            }
            else
            {
                yield return Until(() => app.ActiveZoneId == null && !app.WatchingZone && ConnectionState()?["mainZoneId"]?.Type == JTokenType.Null && (string)ConnectionState()?["latestLeft"]?["reason"] == "none", "reconnect after retreat remains outside all maps");
                yield return new WaitForSecondsRealtime(2);
                if (app.ActiveZoneId != null || ConnectionState()?["mainZoneId"]?.Type != JTokenType.Null) throw new InvalidOperationException("Client automatically re-entered after an explicit retreat");
            }
            activeStep["oldSocketIds"] = new JArray(oldIds); activeStep["newSocketIds"] = ConnectionState()["mainSocketIds"].DeepClone();
        }
        IEnumerator ConnectionShow()
        {
            yield return Click("查看秘境");
            yield return Until(() => app.WatchingZone && app.ActiveZoneId == smokeSecondMap && (string)ConnectionState()?["mainZoneId"] == smokeSecondMap && (long?)ConnectionState()?["latestJoined"]?["enteredAt"] == connectionEnteredAt, "view resumes the same map and original entry time");
        }
        IEnumerator ConnectionRetreat()
        {
            yield return Click("撤离秘境");
            yield return Until(() => app.ActiveZoneId == null && !app.WatchingZone && ConnectionState()?["mainZoneId"]?.Type == JTokenType.Null && (string)ConnectionState()?["latestLeft"]?["reason"] == "retreat", "authoritative retreat clears client and server membership");
        }
        void OnDestroy()
        {
            if (observedConnection != null) observedConnection.ConnectionChanged -= ObserveConnection;
        }
        bool PeerObserved(string text)
        {
            string path = Path.Combine(evidenceDir, "peer-events.jsonl");
            return File.Exists(path) && File.ReadAllText(path).Contains(text);
        }
    }
}
