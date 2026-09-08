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
    // One controller owns the server session. UI reads snapshots; only the server grants rewards.
    public sealed class Bootstrap : MonoBehaviour
    {
        sealed class CachedRead
        {
            public string Route;
            public JObject Value;
        }
        readonly Dictionary<string, CachedRead> reads = new Dictionary<string, CachedRead>();
        readonly ZoneState zone = new ZoneState();
        readonly JArray zoneJournal = new JArray();
        GameConnection connection;
        WorldView world;
        GameUi ui;
        string token;
        int sessionVersion;
        bool busy, needsCharacter, wantsZone, joined, retreatPending, characterLoading, characterDirty;
        bool rebuildPending, enterQueued, enterPending;
        float nextPresence, nextSync, lastFrameAt, nextCharacterRead;
        long clockOffset, enteredAt;
        string desiredZone;
        string latestError = "";

        public JObject CharacterView { get; private set; }
        public JObject Character => CharacterView?["character"] as JObject;
        public GameCatalog Catalog { get; private set; }
        public string Page { get; private set; } = "home";
        public bool Busy => busy;
        public bool LoggedIn => !string.IsNullOrEmpty(token);
        public bool NeedsCharacter => LoggedIn && needsCharacter;
        public string Error { get; private set; } = "";
        public string ServerUrl { get; private set; } = "http://127.0.0.1:3100";
        public string AvatarId => Character?.Value<string>("avatarArt") ?? "avatar/m01";
        public int SelfSlot { get; private set; } = -1;
        public string ActiveZoneId { get; private set; }
        public bool WatchingZone => wantsZone && joined && Page == "world";
        public bool Connected => connection != null && connection.Connected;
        public int OnlineCount { get; private set; }
        public long ServerTime => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + clockOffset;
        public ZoneState Zone => zone;
        public JObject ZoneLoot { get; private set; } = new JObject { ["exp"] = 0L, ["spiritStones"] = 0L, ["kills"] = 0, ["bossKills"] = 0 };
        public JArray ZoneJournal => zoneJournal;

        void Awake()
        {
            Application.targetFrameRate = 60;
            Application.runInBackground = true;
            Catalog = new GameCatalog();
            connection = gameObject.AddComponent<GameConnection>();
            world = gameObject.AddComponent<WorldView>();
            world.Initialize();
            world.SetVisible(false);
            world.PointerBlocked = PointerBlocked;
            ui = gameObject.AddComponent<GameUi>();
            ui.Initialize(this);
            connection.EventReceived += OnEvent;
            connection.Error += OnConnectionError;
            connection.ConnectionChanged += OnConnection;
            string address = Argument("-qingyunServer");
            if (!string.IsNullOrWhiteSpace(address)) ServerUrl = address;
            string page = Argument("-qingyunPage");
            if (!string.IsNullOrEmpty(page)) Page = page;
            Rebuild();
            if (HasArgument("-qingyunDemo")) Login(ServerUrl, "unity_demo", "UnityDemo2026");
            if (!string.IsNullOrEmpty(Argument("-qingyunCapture")))
            { StartCoroutine(Capture()); }
        }

        void Rebuild() { rebuildPending = true; }
        public void Notice(string text) { if (!string.IsNullOrEmpty(text)) ui?.Notice(text); }
        void Fail(string code, string message, Action<string> failed = null)
        {
            Error = message ?? code ?? "请求失败";
            latestError = Error;
            if (code == "UNAUTHORIZED" || code == "BANNED") ClearSession();
            if (failed != null) failed(code ?? "NETWORK_ERROR");
            else Notice(Error);
            Rebuild();
        }
        void OnConnectionError(string message)
        {
            Error = message ?? "实时连接中断";
            latestError = Error;
            Notice(Error);
            Rebuild();
        }

        public void Login(string url, string user, string pass, bool register = false, string invite = null)
        {
            if (busy) return;
            ClearSession();
            ServerUrl = (url ?? "").Trim().TrimEnd('/');
            Error = ""; latestError = "";
            busy = true;
            Rebuild();
            var input = new JObject { ["username"] = user, ["password"] = pass };
            if (register && !string.IsNullOrWhiteSpace(invite)) input["inviteCode"] = invite.Trim();
            StartCoroutine(LoginRoutine(register ? "auth.register" : "auth.login", input, sessionVersion));
        }

        IEnumerator LoginRoutine(string route, JObject input, int version)
        {
            JObject auth = null;
            yield return Request(route, input, null, value => auth = value,
                (code, message) => { if (version == sessionVersion) Fail(code, message); });
            if (version != sessionVersion) yield break;
            if (auth == null) { busy = false; Rebuild(); yield break; }
            token = auth.Value<string>("token");
            if (string.IsNullOrEmpty(token)) { busy = false; Fail("NETWORK_ERROR", "登录响应缺少凭证"); yield break; }
            JObject me = null;
            yield return Request("auth.me", null, token, value => me = value,
                (code, message) => { if (version == sessionVersion) Fail(code, message); });
            if (version != sessionVersion) yield break;
            if (me == null) { ClearSession(); Rebuild(); yield break; }
            clockOffset = me.Value<long>("serverTime") - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            needsCharacter = me["user"]?["characterId"] == null || me["user"]?["characterId"]?.Type == JTokenType.Null;
            JObject offline = null;
            if (!needsCharacter)
            {
                // Settle before GET /character: that read also settles and would erase the offline receipt window.
                yield return Request("character.settle", null, token, value => { offline=value; if (version == sessionVersion) ApplyView(value); },
                    (code,message)=>{ if(version==sessionVersion) Fail(code,message); });
                if (Character == null && version == sessionVersion) yield return ReadCharacter(version);
            }
            if (version != sessionVersion) yield break;
            busy = false;
            if (!needsCharacter && Character == null) { ClearSession(); Rebuild(); yield break; }
            if (Character != null) StartRealtime();
            Rebuild();
            if (Page == "home" && offline != null && offline.Value<double>("elapsedSec") > 60 && !HasArgument("-qingyunCapture"))
                StartCoroutine(ShowOfflineLater(offline,version));
        }
        IEnumerator ShowOfflineLater(JObject summary,int version)
        {
            yield return null;
            if(version==sessionVersion && LoggedIn && Page=="home") ui.ShowOfflineReturn(summary);
        }

        public void CreateCharacter(string name, string avatar, string gender)
        {
            if (!NeedsCharacter || busy) return;
            Command("character.create", new JObject { ["name"] = name, ["avatarArt"] = avatar, ["gender"] = gender }, _ =>
            {
                needsCharacter = false;
                StartRealtime();
            });
        }
        void StartRealtime()
        {
            if (!LoggedIn || Character == null) return;
            connection.Connect(ServerUrl, token);
            // Explicit QA navigation may choose a map; ordinary login remains in the home page.
            if (Page == "world")
            {
                wantsZone = true;
                desiredZone = HasArgument("-qingyunDemo") ? Argument("-qingyunZone") ?? "map-qingyun-mountain" : null;
            }
        }
        public void Logout()
        {
            string oldToken = token;
            string oldServer = ServerUrl;
            ClearSession();
            Error = "";
            Page = "home";
            Rebuild();
            if (!string.IsNullOrEmpty(oldToken))
                StartCoroutine(connection.Rest(oldServer, "POST", "/api/auth/logout", new JObject(), oldToken, _ => { },
                    _ => Notice("本机已退出；服务器注销未确认，请重新登录后检查会话。")));
        }
        void ClearSession()
        {
            sessionVersion++;
            token = null; busy = false; needsCharacter = false;
            CharacterView = null; characterLoading = false; characterDirty = false;
            reads.Clear(); OnlineCount = 0;
            wantsZone = false; joined = false; retreatPending = false; enterQueued = false; enterPending = false; desiredZone = null;
            ActiveZoneId = null; SelfSlot = -1; enteredAt = 0;
            connection?.Disconnect(); zone.Reset(); world?.ClearActors(); world?.SetVisible(false);
            ZoneLoot = new JObject { ["exp"] = 0L, ["spiritStones"] = 0L, ["kills"] = 0, ["bossKills"] = 0 };
            zoneJournal.Clear();
        }

        JObject Route(string id) => Catalog.Json["routes"]?[id] as JObject;
        static string CacheKey(string route, JObject query) => route + ":" +
            new JObject((query ?? new JObject()).Properties().OrderBy(p => p.Name, StringComparer.Ordinal)
                .Select(p => new JProperty(p.Name, p.Value.DeepClone()))).ToString(Formatting.None);
        public JObject Data(string routeId, JObject query = null)
        {
            if (!LoggedIn) return null;
            string key = CacheKey(routeId, query);
            if (reads.TryGetValue(key, out var cached)) return cached.Value;
            var entry = new CachedRead { Route = routeId };
            reads[key] = entry;
            if (Route(routeId)?.Value<string>("method") != "GET")
            { Fail("INVALID_REQUEST", "该入口不是读取接口：" + routeId); return null; } // A failed read stays cached until an explicit refresh; no render/request loop.
            StartCoroutine(ReadData(key, entry, query == null ? null : (JObject)query.DeepClone(), sessionVersion));
            return null;
        }
        IEnumerator ReadData(string key, CachedRead entry, JObject query, int version)
        {
            yield return Request(entry.Route, query, token, value =>
            {
                if (version != sessionVersion || !reads.TryGetValue(key, out var current) || current != entry) return;
                entry.Value = value;
                ApplyView(value);
                Rebuild();
            }, (code, message) =>
            {
                if (version == sessionVersion && reads.TryGetValue(key, out var current) && current == entry) Fail(code, message);
            });
        }
        public void Refresh(params string[] routeIds)
        {
            if (routeIds == null || routeIds.Length == 0) reads.Clear();
            else foreach (string key in reads.Where(pair => Array.IndexOf(routeIds, pair.Value.Route) >= 0).Select(pair => pair.Key).ToArray()) reads.Remove(key);
            Rebuild();
        }
        public void Command(string routeId, JObject input = null, Action<JObject> done = null, Action<string> failed = null)
        {
            if (busy) return;
            if (!LoggedIn) { Fail("UNAUTHORIZED", "请先登录", failed); return; }
            busy = true; Error = ""; Rebuild();
            StartCoroutine(CommandRoutine(routeId, input == null ? null : (JObject)input.DeepClone(), done, failed, sessionVersion));
        }
        IEnumerator CommandRoutine(string route, JObject input, Action<JObject> done, Action<string> failed, int version)
        {
            JObject result = null;
            string code = null, message = null;
            yield return Request(route, input, token, value => result = value, (c, m) => { code = c; message = m; });
            if (version != sessionVersion) yield break;
            if (result == null)
            {
                busy = false;
                Fail(code ?? "NETWORK_ERROR", message, failed);
                yield break;
            }
            ApplyView(result);
            reads.Clear();
            if (route == "character.create") needsCharacter = false;
            if (!needsCharacter) yield return ReadCharacter(version);
            if (version != sessionVersion) yield break;
            busy = false;
            done?.Invoke(result);
            Rebuild();
        }
        void ApplyView(JObject result)
        {
            var view = result?["view"] as JObject;
            if (view == null && result?["character"] is JObject && result?["stats"] is JObject) view = result;
            if (view != null) CharacterView = (JObject)view.DeepClone();
        }
        public void RefreshCharacter()
        {
            if (!LoggedIn || needsCharacter) return;
            characterDirty = true;
        }
        IEnumerator ReadCharacter(int version)
        {
            // Writes await a fresh read even if an earlier read is in flight, preventing stale response overwrite.
            while (characterLoading && version == sessionVersion) yield return null;
            if (version != sessionVersion) yield break;
            characterLoading = true; characterDirty = false;
            yield return Request("character.get", null, token, value =>
            {
                if (version == sessionVersion) { ApplyView(value); Error = ""; }
            }, (code, message) =>
            {
                if (version != sessionVersion) return;
                if (code == "CHARACTER_NOT_FOUND") { needsCharacter = true; CharacterView = null; }
                else Fail(code, message);
            });
            if (version == sessionVersion) { characterLoading = false; nextCharacterRead = Time.unscaledTime + 2; Rebuild(); }
        }
        IEnumerator Request(string routeId, JObject input, string requestToken, Action<JObject> success, Action<string, string> failed)
        {
            var route = Route(routeId);
            if (route == null) { failed("INVALID_REQUEST", "未知接口：" + routeId); yield break; }
            string method = route.Value<string>("method"), path;
            JObject remaining;
            try { path = BuildPath(route.Value<string>("path"), method, input, out remaining); }
            catch (ArgumentException ex) { failed("INVALID_REQUEST", ex.Message); yield break; }
            yield return connection.Rest(ServerUrl, method, path, method == "GET" ? null : remaining,
                requestToken, success, null, failed);
        }
        static string BuildPath(string path, string method, JObject input, out JObject remaining)
        {
            remaining = input == null ? new JObject() : (JObject)input.DeepClone();
            foreach (var property in remaining.Properties().ToArray())
            {
                string marker = ":" + property.Name;
                if (path.Split('/').Contains(marker))
                {
                    if (property.Value.Type == JTokenType.Null) throw new ArgumentException("缺少路径参数：" + property.Name);
                    path = path.Replace(marker, Uri.EscapeDataString(property.Value.ToString()));
                    property.Remove();
                }
            }
            if (path.Split('/').Any(part => part.StartsWith(":", StringComparison.Ordinal)))
                throw new ArgumentException("缺少接口路径参数");
            if (method == "GET" && remaining.Count > 0)
                path += "?" + string.Join("&", remaining.Properties().Where(p => p.Value.Type != JTokenType.Null).Select(p =>
                    Uri.EscapeDataString(p.Name) + "=" + Uri.EscapeDataString(p.Value.Type == JTokenType.String ? p.Value.Value<string>() : p.Value.ToString(Formatting.None))));
            return path;
        }
#if UNITY_EDITOR
        [ContextMenu("Verify REST routing")]
        void VerifyRestRouting()
        {
            var query = new JObject { ["id"] = "name/with space", ["onlyOnline"] = true };
            string path = BuildPath("/api/cultivators/:id", "GET", query, out var remaining);
            Debug.Assert(path == "/api/cultivators/name%2Fwith%20space?onlyOnline=true");
            Debug.Assert(query.Count == 2 && remaining.Count == 1, "Caller input must remain unchanged");
            Debug.Assert(CacheKey("x", new JObject { ["b"] = 2, ["a"] = 1 }) == CacheKey("x", new JObject { ["a"] = 1, ["b"] = 2 }));
            bool rejected = false;
            try { BuildPath("/api/shop/:shopId", "GET", new JObject(), out _); }
            catch (ArgumentException) { rejected = true; }
            Debug.Assert(rejected, "Missing path parameter must not issue a server request");
            Debug.Log("REST routing checks passed");
        }
#endif

        public void Navigate(string page)
        {
            if (Page == "world" && page != "world")
            {
                wantsZone = false; joined = false; enterQueued = false;
                if (Connected) connection.Emit("zone:leave", null);
                zone.Reset(); world.ClearActors();
            }
            Page = page ?? "home";
            world.SetVisible(false);
            if (Page == "world" && LoggedIn && Character != null && !retreatPending)
            {
                wantsZone = true; desiredZone = null;
                QueueEnter();
            }
            Rebuild();
        }
        public void EnterZone(string id)
        {
            if (!LoggedIn || Character == null) return;
            if (retreatPending) { Notice("请等撤离确认后再进入秘境。"); return; }
            if (Catalog.Find("zones", id) == null) { Fail("NOT_FOUND", "未知秘境"); return; }
            Page = "world"; wantsZone = true; retreatPending = false; joined = false; desiredZone = id;
            zone.Reset(); world.ClearActors(); world.SetVisible(false);
            QueueEnter();
            if (!Connected) Notice("实时连接恢复后将进入所选秘境。");
            Rebuild();
        }
        public void Retreat()
        {
            if (!LoggedIn) return;
            wantsZone = false; joined = false; retreatPending = true; enterQueued = false;
            world.SetVisible(false);
            if (Connected) connection.Emit("zone:retreat", null);
            else Notice("正在恢复连接，随后撤离。确认前角色仍可能在秘境挂机。");
            Rebuild();
        }
        public void Emit(string eventName, object payload = null) => connection.Emit(eventName, payload);
        public void FocusSelf() => world.FocusSelf();
        public void FocusBoss() => world.FocusBoss();
        void OnConnection(bool online)
        {
            enterPending = false; enterQueued = false;
            joined = false; zone.Reset(); world.ClearActors(); world.SetVisible(false);
            if (online)
            {
                nextPresence = Time.unscaledTime;
                if (retreatPending) connection.Emit("zone:retreat", null);
                else QueueEnter(); // A hidden resume restores only the existing membership and its offline receipt.
                RefreshCharacter();
            }
            Rebuild();
        }
        void OnEvent(string name, JToken data)
        {
            if (!LoggedIn) return;
            try
            {
                switch (name)
                {
                    case "character:update":
                        if (Character != null && data.Value<string>("id") == Character.Value<string>("id"))
                        {
                            Character.Merge(data, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace, MergeNullValueHandling = MergeNullValueHandling.Merge });
                            RefreshCharacter();
                            ui.RefreshHeader();
                        }
                        break;
                    case "presence:update": OnlineCount = data.Value<int>("onlineCount"); ui.RefreshHeader(); break;
                    case "party:update": Refresh("party.get", "social.chatHistory"); break;
                    case "friend:request": Refresh("social.friends"); break;
                    case "chat:message": break; // Social UI merges the pushed message without destroying the active input.
                    case "dungeon:result": Refresh(); RefreshCharacter(); break;
                    case "arena:challenged": Refresh("arena.records", "arena.opponents", "character.rankings"); RefreshCharacter(); break;
                    case "raid:update": Refresh("raid.targets"); break;
                    case "zone:joined":
                        enterPending = false;
                        string map = data.Value<string>("zoneId");
                        if (Catalog.Find("zones", map) == null) throw new FormatException("未知地图快照");
                        if (retreatPending) break;
                        if (!wantsZone || Page != "world")
                        {
                            enterQueued = false;
                            RecordZoneVisit(map, data.Value<long>("enteredAt"));
                            connection.Emit("zone:leave", null); // Stop watching; the cultivator keeps farming.
                            Rebuild();
                            break;
                        }
                        if (desiredZone != null && desiredZone != map) { QueueEnter(); break; }
                        bool firstJoin = !joined || ActiveZoneId != map;
                        if (firstJoin) { zone.SetZone(map); world.SetZone(map, Catalog); }
                        RecordZoneVisit(map, data.Value<long>("enteredAt"));
                        desiredZone = map; SelfSlot = data.Value<int>("self"); enterQueued = false;
                        joined = true; Error = "";
                        ApplyFrame(data["frame"] as JObject);
                        world.SetVisible(true);
                        if (firstJoin) world.FocusSelf();
                        Rebuild();
                        break;
                    case "zone:frame":
                        if (WatchingZone && data.Value<string>("zoneId") == ActiveZoneId) ApplyFrame(data as JObject);
                        break;
                    case "zone:loot":
                        foreach (string key in new[] { "exp", "spiritStones", "kills", "bossKills" }) ZoneLoot[key] = ZoneLoot.Value<long>(key) + data.Value<long>(key);
                        var lootItems = ZoneLoot["items"] as JArray ?? new JArray();
                        if (data["items"] is JArray additions)
                            foreach (JObject item in additions)
                            {
                                var owned = lootItems.OfType<JObject>().FirstOrDefault(v => v.Value<string>("itemId") == item.Value<string>("itemId"));
                                if (owned == null) lootItems.Add(item.DeepClone());
                                else owned["qty"] = owned.Value<long>("qty") + item.Value<long>("qty");
                            }
                        ZoneLoot["items"] = lootItems;
                        RefreshCharacter(); Refresh("inventory.list", "progression.get");
                        break;
                    case "zone:left":
                        enterPending = false;
                        // An older resume may report no membership after the user has already selected a field.
                        bool keepSelection = data.Value<string>("reason") == "none" && wantsZone && Page == "world" && desiredZone != null && !retreatPending;
                        if (keepSelection) QueueEnter();
                        else { wantsZone = false; retreatPending = false; desiredZone = null; enterQueued = false; }
                        joined = false; ActiveZoneId = null; SelfSlot = -1;
                        zone.Reset(); world.ClearActors(); world.SetVisible(false); RefreshCharacter(); Rebuild();
                        break;
                    case "zone:error":
                        enterPending = false;
                        Error = data.Value<string>("message") ?? "无法进入秘境"; latestError = Error;
                        if (data.Value<string>("code") == "RATE_LIMITED" && !retreatPending)
                        { nextSync = Time.unscaledTime + 1.5f; QueueEnter(); }
                        else if (!enterQueued) { wantsZone = false; joined = false; world.SetVisible(false); }
                        Rebuild();
                        break;
                }
                // UI owns the visible notification/replay for every server event, including social events.
                ui.OnRealtime(name, data);
            }
            catch (Exception ex) when (ex is FormatException || ex is InvalidCastException || ex is ArgumentException || ex is NullReferenceException || ex is JsonException || ex is OverflowException)
            { Error = "实时数据暂时无法读取，正在恢复。"; latestError = Error; Notice(Error); RequestSync(); }
        }
        void ApplyFrame(JObject frame)
        {
            if (frame == null) { RequestSync(); return; }
            bool applied = zone.Apply(frame);
            if (zone.NeedsSync) RequestSync();
            if (!applied) return;
            lastFrameAt = Time.unscaledTime;
            foreach (int slot in zone.Removed) world.Remove(slot);
            foreach (int slot in zone.Updated)
            {
                var actor = zone.Actors[slot];
                world.Upsert(slot, actor.Name, actor.Kind, actor.Stage, actor.X, actor.Z,
                    Mathf.Clamp01((float)actor.Hp / actor.MaxHp), slot == SelfSlot, actor.Flags, actor.Target, actor.Art);
            }
            if (frame["events"] is JArray events)
                foreach (JToken entry in events)
                {
                    zoneJournal.Add(entry.DeepClone());
                    while (zoneJournal.Count > 30) zoneJournal.RemoveAt(0);
                }
        }
        void RecordZoneVisit(string map, long visit)
        {
            if (enteredAt != visit || ActiveZoneId != map)
            { ZoneLoot = new JObject { ["exp"] = 0L, ["spiritStones"] = 0L, ["kills"] = 0, ["bossKills"] = 0 }; zoneJournal.Clear(); }
            ActiveZoneId = map; enteredAt = visit;
        }
        void QueueEnter() { if (!retreatPending) enterQueued = true; }
        void RequestSync()
        {
            if (!wantsZone || Page != "world" || !Connected || Time.unscaledTime < nextSync) return;
            if (enterPending && Time.unscaledTime - lastFrameAt <= 6) return;
            enterPending = false;
            QueueEnter();
        }
        void Update()
        {
            if (Connected && Time.unscaledTime >= nextPresence)
            { nextPresence = Time.unscaledTime + 25; connection.Emit("presence:ping", null); }
            if (wantsZone && Page == "world" && Connected && Time.unscaledTime - lastFrameAt > 6) RequestSync();
            // Coalesce navigation while a resume is in flight; the server accepts one enter per second.
            if (Connected && enterQueued && !enterPending && !retreatPending && Time.unscaledTime >= nextSync)
            {
                enterQueued = false; enterPending = true;
                lastFrameAt = Time.unscaledTime; nextSync = Time.unscaledTime + 1.2f;
                connection.Emit("zone:enter", new { zoneId = wantsZone && Page == "world" ? desiredZone : null });
            }
            if (characterDirty && !characterLoading && !busy && Time.unscaledTime >= nextCharacterRead)
                StartCoroutine(ReadCharacter(sessionVersion));
            if (rebuildPending) { rebuildPending = false; ui?.Rebuild(); }
        }
        bool PointerBlocked(Vector2 point)
        {
            return !WatchingZone || (ui?.BlocksPointer(point) ?? false);
        }
        static bool HasArgument(string flag) => Array.IndexOf(Environment.GetCommandLineArgs(), flag) >= 0;
        static string Argument(string flag)
        {
            string[] args = Environment.GetCommandLineArgs(); int index = Array.IndexOf(args, flag);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }
        IEnumerator Capture()
        {
            yield return new WaitForSecondsRealtime(24);
            if (WatchingZone) world.FocusSelf();
            yield return new WaitForSecondsRealtime(2);
            string path = Argument("-qingyunCapture");
            string folder = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(folder)) Directory.CreateDirectory(folder);
            yield return new WaitForEndOfFrame();
            ScreenCapture.CaptureScreenshot(path);
            var report = new JObject { ["unity"] = Application.unityVersion, ["page"] = Page,
                ["loggedIn"] = LoggedIn, ["needsCharacter"] = NeedsCharacter, ["busy"] = Busy,
                ["latestError"] = latestError, ["currentError"] = Error, ["connected"] = Connected, ["watchingZone"] = WatchingZone,
                ["zone"] = ActiveZoneId, ["actors"] = world.ActorCount, ["serverFrame"] = zone.Sequence,
                ["width"] = Screen.width, ["height"] = Screen.height, ["zoneLoot"] = ZoneLoot.DeepClone(),
                ["zoneEvents"] = zoneJournal.DeepClone(), ["characterId"] = Character?.Value<string>("id"),
                ["note"] = "Desktop client capture; not a mobile performance benchmark." };
            File.WriteAllText(Path.ChangeExtension(path, ".json"), report.ToString());
            yield return new WaitForSecondsRealtime(2);
            if (HasArgument("-qingyunExitAfterCapture")) Application.Quit();
        }
        void OnDestroy()
        {
            sessionVersion++;
            if (connection == null) return;
            connection.EventReceived -= OnEvent; connection.Error -= OnConnectionError;
            connection.ConnectionChanged -= OnConnection; connection.Disconnect();
        }
    }
}
