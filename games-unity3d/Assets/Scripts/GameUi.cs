using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    // Historical official composition: news/3.html (2020-12), news/273.html (2023-03-16, in development).
    // Six destinations, narrow resources, calm ink backgrounds; project social replaces the unavailable sect.
    // Original project art only. Replay timing is a presentation choice, never an official combat period.
    public sealed partial class GameUi : MonoBehaviour
    {
        Bootstrap app;
        VisualElement content;
        UIDocument uiDocument;
        PanelSettings uiPanel;
        VisualElement uiRoot, uiFrame, uiBackground, uiHeader, uiNav, uiOverlay, uiSheet, uiNotifications;
        ScrollView uiScroll, uiSheetScroll;
        Label uiIdentity, uiResources, uiConnection, uiError, uiToast;
        Font uiFont, uiBrushFont;
        readonly Dictionary<string, string> uiInputs = new Dictionary<string, string>();
        readonly Dictionary<string, Vector2> uiScrollPositions = new Dictionary<string, Vector2>();
        readonly HashSet<string> uiSecretKeys = new HashSet<string>();
        readonly Dictionary<string, UnityEngine.UIElements.Button> uiNavButtons = new Dictionary<string, UnityEngine.UIElements.Button>();
        Action<VisualElement> uiSheetBuilder;
        string uiSheetTitle, uiBuiltPage, uiBuiltSession, uiLastError;
        bool uiBuilding, uiDeferred, uiForce, uiRegister;
        string uiGender = "male", uiAvatar = "avatar/m01";
        int uiToastVersion, uiSheetVersion;
        float uiLastLootNotice;
        JObject uiBattleWrapper;
        readonly List<JObject> uiBattles = new List<JObject>();
        int uiBattleIndex, uiBattleCursor;
        bool uiBattlePaused, uiBattleFinished;
        string uiBattleTitle;
        float uiBattleNext;
        readonly Dictionary<string, double> uiBattleHp = new Dictionary<string, double>();
        readonly Dictionary<string, string> uiBattleNames = new Dictionary<string, string>();
        readonly Dictionary<string, string> uiBattleArt = new Dictionary<string, string>();
        readonly List<string> uiBattleFeed = new List<string>();
        VisualElement uiBattleFighters, uiBattleLog, uiBattleVerdict;
        Label uiBattleProgress, uiBattleFooterStatus;
        UnityEngine.UIElements.Button uiBattlePauseButton, uiBattleNextButton;

        public void Initialize(Bootstrap bootstrap)
        {
            app = bootstrap;
            uiFont = Resources.Load<Font>("Fonts/NotoSansSC-Regular");
            uiBrushFont = Resources.Load<Font>("Fonts/MaShanZheng-Regular");
            uiDocument = GetComponent<UIDocument>() ?? gameObject.AddComponent<UIDocument>();
            var saved = Resources.Load<PanelSettings>("UI/GamePanel");
            uiPanel = saved != null ? Instantiate(saved) : ScriptableObject.CreateInstance<PanelSettings>();
            uiPanel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            uiPanel.screenMatchMode = PanelScreenMatchMode.Expand;
            uiPanel.referenceResolution = new Vector2Int(390, 844);
            var theme = Resources.Load<ThemeStyleSheet>("UI/GameTheme");
            if (theme != null) uiPanel.themeStyleSheet = theme;
            uiDocument.panelSettings = uiPanel;
            uiRoot = uiDocument.rootVisualElement;
            uiRoot.Clear();
            uiRoot.name = "qingyun-ui";
            uiRoot.AddToClassList("game-root");
            uiRoot.pickingMode = PickingMode.Ignore;
            if (uiFont != null) uiRoot.style.unityFontDefinition = FontDefinition.FromFont(uiFont);
            var sheet = Resources.Load<StyleSheet>("UI/Game");
            if (sheet != null) uiRoot.styleSheets.Add(sheet);
            uiFrame = new VisualElement { name = "game-frame", pickingMode = PickingMode.Ignore };
            uiFrame.AddToClassList("game-frame"); uiRoot.Add(uiFrame);
            uiBackground = new VisualElement { pickingMode = PickingMode.Ignore };
            uiBackground.AddToClassList("page-background"); uiFrame.Add(uiBackground);
            uiHeader = new VisualElement(); uiHeader.AddToClassList("game-header"); uiHeader.AddToClassList("ui-interactive"); uiFrame.Add(uiHeader);
            var headerRow = Row(uiHeader, "header-name-row");
            uiIdentity = Text(headerRow, "青云问道", "header-identity");
            uiIdentity.style.flexGrow = 1;
            Button(uiHeader, "设置", OpenSettings, true, "header-menu");
            var headerMeta = Row(uiHeader, "header-meta");
            uiResources = Text(headerMeta, "一念山水间", "header-resources");
            uiResources.style.flexGrow = 1;
            uiConnection = Text(headerMeta, "", "header-connection");
            uiError = Text(uiFrame, "", "error-banner");
            uiError.pickingMode = PickingMode.Position;
            uiError.AddToClassList("ui-interactive");
            uiScroll = new ScrollView(ScrollViewMode.Vertical) { name = "main-scroll", pickingMode = PickingMode.Ignore };
            uiScroll.AddToClassList("main-scroll"); uiScroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
            uiScroll.contentViewport.pickingMode = PickingMode.Ignore;
            uiScroll.contentContainer.pickingMode = PickingMode.Ignore;
            uiFrame.Add(uiScroll);
            content = new VisualElement { name = "page-content", pickingMode = PickingMode.Ignore };
            content.AddToClassList("page-content"); uiScroll.Add(content);
            uiNotifications = new VisualElement { pickingMode = PickingMode.Ignore };
            uiNotifications.AddToClassList("notifications"); uiFrame.Add(uiNotifications);
            uiNav = new VisualElement(); uiNav.AddToClassList("bottom-nav"); uiNav.AddToClassList("ui-interactive"); uiFrame.Add(uiNav);
            foreach (var entry in new[] { new[] { "character", "人物" }, new[] { "world", "秘境" }, new[] { "town", "城镇" }, new[] { "social", "道友" }, new[] { "home", "洞府" }, new[] { "bag", "行囊" } })
            {
                string page = entry[0];
                var nav = Button(uiNav, entry[1], () => { CloseSheet(); uiForce = true; app.Navigate(page); }, true, "nav-button");
                if (uiBrushFont != null) nav.style.unityFontDefinition = FontDefinition.FromFont(uiBrushFont);
                uiNavButtons[page] = nav;
            }
            uiOverlay = new VisualElement { name = "sheet-overlay" }; uiOverlay.AddToClassList("sheet-overlay"); uiOverlay.AddToClassList("ui-interactive"); uiRoot.Add(uiOverlay);
            uiOverlay.style.display = DisplayStyle.None;
            uiOverlay.RegisterCallback<PointerDownEvent>(evt => { if (evt.target == uiOverlay) CloseSheet(); });
            uiToast = Text(uiFrame, "", "game-toast"); uiToast.style.display = DisplayStyle.None; PlaceToast();
            uiRoot.RegisterCallback<FocusOutEvent>(_ => uiRoot.schedule.Execute(() => { if (uiDeferred && FocusedField() == null) { uiDeferred = false; Rebuild(); } }).StartingIn(1));
            Rebuild();
        }

        string UiSession() => !app.LoggedIn ? "login" : app.NeedsCharacter ? "create" : app.Character?.Value<string>("id") ?? "loading";
        TextField FocusedField()
        {
            var focused = uiRoot?.focusController?.focusedElement as VisualElement;
            return focused as TextField ?? focused?.GetFirstAncestorOfType<TextField>();
        }
        public void Rebuild()
        {
            if (app == null || uiRoot == null || uiBuilding) return;
            string page = app.Page, session = UiSession();
            bool same = page == uiBuiltPage && session == uiBuiltSession;
            if(!same) ClearToast();
            RefreshHeader();
            if (!uiForce && same && FocusedField() != null) { uiDeferred = true; return; }
            uiForce = false; uiDeferred = false; uiBuilding = true;
            try
            {
                if (uiBuiltPage != null) uiScrollPositions[uiBuiltPage] = uiScroll.scrollOffset;
                if (uiBuiltSession != null && session != uiBuiltSession)
                {
                    foreach (string key in uiSecretKeys) uiInputs.Remove(key);
                    foreach (string key in uiInputs.Keys.Where(k => !k.StartsWith("auth-", StringComparison.Ordinal)).ToArray()) uiInputs.Remove(key);
                    uiScrollPositions.Clear(); CloseSheet();
                }
                uiBuiltPage = page; uiBuiltSession = session;
                content.Clear(); uiNotifications.Clear();
                bool world = session != "login" && session != "create" && app.WatchingZone;
                uiRoot.EnableInClassList("world-root", world);
                uiFrame.EnableInClassList("world-frame", world);
                uiFrame.EnableInClassList("home-frame", page == "home" && app.Character != null);
                content.EnableInClassList("world-content", world);
                content.EnableInClassList("home-content", page == "home");
                content.EnableInClassList("town-content", page == "town");
                content.EnableInClassList("progression-content", new[] { "treasures", "relics", "gacha", "daily" }.Contains(page));
                uiScroll.verticalScrollerVisibility = world ? ScrollerVisibility.Hidden : ScrollerVisibility.Auto;
                uiBackground.style.display = world ? DisplayStyle.None : DisplayStyle.Flex;
                string art = !app.LoggedIn ? "bg/login" : page == "town" ? "bg/town-qingyun" : "bg/cultivation-day";
                var background = app.Catalog.Art(art);
                if (background != null) uiBackground.style.backgroundImage = new StyleBackground(background);
                uiNav.style.display = app.Character != null ? DisplayStyle.Flex : DisplayStyle.None;
                if (!app.LoggedIn) RenderAuth();
                else if (app.NeedsCharacter) RenderCreateCharacter();
                else if (app.Character == null)
                {
                    Heading("正在接引入山"); Text(content, "等待仙府资料同步…", "muted");
                    Button(content, "重新同步", app.RefreshCharacter, !app.Busy);
                }
                else
                {
                    switch (page)
                    {
                        case "home": RenderHome(); break;
                        case "world": RenderWorld(); break;
                        case "character": RenderCharacter(); break;
                        case "bag": RenderBag(); break;
                        case "town": RenderTown(); break;
                        case "treasures": case "relics": case "gacha": case "daily": RenderProgression(); break;
                        case "social": case "party": case "friends": case "directory": case "dungeons": case "arena": case "raid": case "rankings": RenderSocial(); break;
                        default: Heading("此处尚未开放"); Button(content, "返回洞府", () => app.Navigate("home")); break;
                    }
                    if (!IsSocialPage(page)) RenderSocialNotifications(uiNotifications);
                }
                string selected = IsSocialPage(page) ? "social" : new[] { "treasures", "relics", "gacha", "daily" }.Contains(page) ? "home" : page;
                foreach (var nav in uiNavButtons) nav.Value.EnableInClassList("nav-selected", nav.Key == selected);
                Vector2 offset = uiScrollPositions.TryGetValue(page, out var remembered) ? remembered : Vector2.zero;
                uiScroll.schedule.Execute(() => { if (uiBuiltPage == page) uiScroll.scrollOffset = offset; }).StartingIn(1);
                if (uiSheetBuilder != null) BuildSheet(true);
            }
            finally { uiBuilding = false; }
        }
        static bool IsSocialPage(string page) => new[] { "social", "party", "friends", "directory", "dungeons", "arena", "raid", "rankings" }.Contains(page);
        public void RefreshHeader()
        {
            if (uiIdentity == null || app == null) return;
            string name = app.Character?.Value<string>("name");
            uiIdentity.text = string.IsNullOrEmpty(name) ? "青云问道" : name + " · " + (app.CharacterView?.Value<string>("stageName") ?? "修行中");
            uiResources.text = app.Character == null ? "一念山水间 · 悠然见青云" : $"灵石 {app.Character.Value<double>("spiritStones"):N0}  ·  修为 {app.Character.Value<double>("exp"):N0}";
            uiConnection.text = app.LoggedIn ? (app.Connected ? "● " : "○ ") + (app.Busy ? "同步中" : app.Connected ? $"在线 {app.OnlineCount}" : "连接中") : "水墨修行";
            uiError.text = app.Error ?? "";
            uiError.style.display = string.IsNullOrEmpty(app.Error) ? DisplayStyle.None : DisplayStyle.Flex;
            if (!string.IsNullOrEmpty(app.Error) && uiLastError != app.Error) { uiLastError = app.Error; Notice(app.Error); }
            else if (string.IsNullOrEmpty(app.Error)) uiLastError = null;
        }
        public bool BlocksPointer(Vector2 screenPoint)
        {
            if (app == null || !app.WatchingZone) return true;
            if (uiRoot?.panel == null) return false;
            if (uiSheetBuilder != null) return true;
            Vector2 point = RuntimePanelUtils.ScreenToPanel(uiRoot.panel, new Vector2(screenPoint.x, Screen.height - screenPoint.y));
            var picked = uiRoot.panel.Pick(point);
            for (var element = picked; element != null; element = element.parent)
                if (element.ClassListContains("ui-interactive") || element is TextField || element is UnityEngine.UIElements.Button || element is Scroller) return true;
            return false;
        }

        VisualElement Row(VisualElement parent, string className = "row")
        {
            var element = new VisualElement { pickingMode = PickingMode.Ignore }; element.AddToClassList(className); parent.Add(element); return element;
        }
        VisualElement Card(VisualElement parent, string title = null)
        {
            var element = new VisualElement(); element.AddToClassList("card"); element.AddToClassList("ui-interactive"); parent.Add(element);
            if (!string.IsNullOrEmpty(title)) Text(element, title, "section-title");
            return element;
        }
        Label Text(VisualElement parent, string value, string className = "body")
        {
            var label = new Label(value ?? "") { pickingMode = PickingMode.Ignore }; label.AddToClassList(className); parent.Add(label); return label;
        }
        UnityEngine.UIElements.Button Button(VisualElement parent, string label, Action action, bool enabled = true, string className = "secondary")
        {
            var button = new UnityEngine.UIElements.Button(() => action?.Invoke()) { text = label ?? "" };
            button.AddToClassList("game-button"); button.AddToClassList(className); button.AddToClassList("ui-interactive"); button.SetEnabled(enabled); parent.Add(button); return button;
        }
        TextField Field(VisualElement parent, string key, string label, bool secret = false, string initial = "")
        {
            if (!uiInputs.ContainsKey(key)) uiInputs[key] = initial ?? "";
            if (secret) uiSecretKeys.Add(key);
            var field = new TextField(label) { name = key, userData = key, isPasswordField = secret, value = uiInputs[key] };
            field.AddToClassList("game-field"); field.AddToClassList("ui-interactive");
            field.RegisterValueChangedCallback(evt => uiInputs[key] = evt.newValue);
            parent.Add(field); return field;
        }
        Image Art(VisualElement parent, string artId, float size = 56) => Picture(parent, app.Catalog.Art(artId), size);
        Image Picture(VisualElement parent, Texture2D texture, float size = 72)
        {
            var image = new Image { image = texture, scaleMode = ScaleMode.ScaleToFit, pickingMode = PickingMode.Ignore };
            image.AddToClassList("game-picture"); image.style.width = size; image.style.height = size;
            if (texture == null) image.AddToClassList("picture-missing");
            parent.Add(image); return image;
        }
        void Meter(VisualElement parent, float fraction, string caption)
        {
            var box = new VisualElement { pickingMode = PickingMode.Ignore }; box.AddToClassList("meter"); parent.Add(box);
            var fill = new VisualElement { pickingMode = PickingMode.Ignore }; fill.AddToClassList("meter-fill");
            fill.style.width = Length.Percent(float.IsNaN(fraction) || float.IsInfinity(fraction) ? 0 : Mathf.Clamp01(fraction) * 100); box.Add(fill);
            Text(box, caption, "meter-caption");
        }
        void Heading(string title, string subtitle = null)
        {
            var label = Text(content, title, "heading"); if (uiBrushFont != null) label.style.unityFontDefinition = FontDefinition.FromFont(uiBrushFont);
            if (!string.IsNullOrEmpty(subtitle)) Text(content, subtitle, "heading-note");
        }
        void ShowSheet(string title, Action<VisualElement> build)
        {
            bool same = uiSheetBuilder == build && uiSheetTitle == title;
            if(!same) ClearToast();
            uiSheetBuilder = build; uiSheetTitle = title; uiSheetVersion++;
            if (build != (Action<VisualElement>)RenderBattleSheet) { uiBattleFighters = null; uiBattleLog = null; uiBattlePaused = true; }
            BuildSheet(same);
        }
        void BuildSheet(bool preserve)
        {
            if (uiOverlay == null || uiSheetBuilder == null) return;
            Vector2 offset = preserve && uiSheetScroll != null ? uiSheetScroll.scrollOffset : Vector2.zero;
            uiOverlay.Clear(); uiOverlay.style.display = DisplayStyle.Flex;
            uiSheet = new VisualElement(); uiSheet.AddToClassList("sheet"); uiOverlay.Add(uiSheet);
            var top = Row(uiSheet, "sheet-header");
            var title = Text(top, uiSheetTitle, "sheet-title"); title.style.flexGrow = 1;
            if (uiBrushFont != null) title.style.unityFontDefinition = FontDefinition.FromFont(uiBrushFont);
            Button(top, "关闭", CloseSheet, true, "sheet-close");
            uiSheetScroll = new ScrollView(ScrollViewMode.Vertical); uiSheetScroll.AddToClassList("sheet-scroll"); uiSheetScroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden; uiSheet.Add(uiSheetScroll);
            uiSheetBuilder(uiSheetScroll.contentContainer);
            PlaceToast();
            var scroll = uiSheetScroll; int version = uiSheetVersion;
            scroll.schedule.Execute(() => { if (uiSheetVersion == version) scroll.scrollOffset = offset; }).StartingIn(1);
        }
        void CloseSheet()
        {
            uiSheetVersion++; uiSheetBuilder = null;
            uiBattleFighters = null; uiBattleLog = null; uiBattlePaused = true;
            if (uiOverlay != null) { uiOverlay.Clear(); uiOverlay.style.display = DisplayStyle.None; }
            uiSheet=null; ClearToast(); PlaceToast();
        }
        void ClearToast()
        {
            uiToastVersion++;
            if(uiToast!=null) { uiToast.text=""; uiToast.style.display=DisplayStyle.None; }
        }
        void PlaceToast()
        {
            if(uiToast==null || uiFrame==null) return;
            uiToast.RemoveFromHierarchy();
            if(uiSheetBuilder!=null && uiSheet!=null) uiSheet.Insert(1,uiToast);
            else uiFrame.Insert(uiFrame.IndexOf(uiNav),uiToast);
        }
        public void Notice(string message)
        {
            if (uiToast == null || string.IsNullOrWhiteSpace(message)) return;
            int version = ++uiToastVersion; uiToast.text = message; PlaceToast(); uiToast.style.display = DisplayStyle.Flex;
            uiToast.schedule.Execute(() => { if (uiToastVersion == version) uiToast.style.display = DisplayStyle.None; }).StartingIn(5200);
        }
        public void OnRealtime(string eventName, JToken data)
        {
            HandleSocialRealtime(eventName, data);
            switch (eventName)
            {
                case "system:notice": Notice(data?.Value<string>("text")); break;
                case "zone:death": Notice($"遭 {data?["killerName"]} 击败 · 灵石损失 {data?["stonesLost"]}，等待重返秘境。"); break;
                case "zone:loot":
                    if (!app.WatchingZone || uiSheetBuilder != null) break;
                    if (Time.unscaledTime - uiLastLootNotice > 12 || (data?.Value<int?>("bossKills") ?? 0) > 0)
                    { uiLastLootNotice = Time.unscaledTime; Notice($"历练所得 · 修为 +{data?["exp"]} · 灵石 +{data?["spiritStones"]}"); }
                    break;
            }
            RefreshHeader();
        }

        void RenderAuth()
        {
            Heading("青云问道", "山门初启，静候仙来");
            var card = Card(content, uiRegister ? "结缘青云" : "重返仙途");
            var tabs = Row(card);
            Button(tabs, "登录", () => { uiRegister = false; uiForce = true; Rebuild(); }, !app.Busy, !uiRegister ? "primary" : "secondary");
            Button(tabs, "注册", () => { uiRegister = true; uiForce = true; Rebuild(); }, !app.Busy, uiRegister ? "primary" : "secondary");
            var user = Field(card, "auth-user", "账号（3–20位字母/数字/_/-）"); user.maxLength = 20;
            var password = Field(card, "auth-pass", "密码（6–72位）", true); password.maxLength = 72;
            TextField invite = uiRegister ? Field(card, "auth-invite", "邀请码（若仙府要求）") : null;
            if (invite != null) invite.maxLength = 64;
            Button(card, app.Busy ? "正在接引…" : uiRegister ? "注册入门" : "进入仙府", () =>
            {
                string username = user.value.Trim(), pass = password.value;
                if (!Regex.IsMatch(username, "^[A-Za-z0-9_-]{3,20}$") || pass.Length < 6 || pass.Length > 72) { Notice("请检查账号格式与密码长度。"); return; }
                string url = uiInputs.TryGetValue("auth-server", out var address) ? address.Trim() : app.ServerUrl;
                if (!ValidServer(url)) { Notice("请输入完整的 HTTP 或 HTTPS 仙府地址。"); return; }
                app.Login(url, username, pass, uiRegister, invite?.value);
            }, !app.Busy, "primary");
            Button(card, "仙府地址设置", OpenSettings, !app.Busy);
            Text(content, "轻触入山，修行自在。", "heading-note");
        }
        static bool ValidServer(string address) => Uri.TryCreate(address, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https") && !string.IsNullOrWhiteSpace(uri.Host) && string.IsNullOrEmpty(uri.UserInfo);
        void RenderCreateCharacter()
        {
            Heading("落笔成仙", "留下道号，踏上你的修行路");
            var name = Field(content, "create-name", "道号（2–12字）"); name.maxLength = 12;
            var genders = Row(content);
            Button(genders, "男修", () => { uiGender = "male"; uiForce = true; Rebuild(); }, !app.Busy, uiGender == "male" ? "primary" : "secondary");
            Button(genders, "女修", () => { uiGender = "female"; uiForce = true; Rebuild(); }, !app.Busy, uiGender == "female" ? "primary" : "secondary");
            Text(content, "选择容貌", "section-title");
            var avatars = app.Catalog.Table("avatars");
            var grid = Row(content, "avatar-grid");
            foreach (string avatar in avatars.Values<string>())
            {
                string selected = avatar;
                var button = Button(grid, "", () => { uiAvatar = selected; uiForce = true; Rebuild(); }, !app.Busy, "avatar-choice");
                button.tooltip = "选择头像 " + avatar;
                button.EnableInClassList("avatar-selected", selected == uiAvatar);
                Picture(button, app.Catalog.Art(avatar), 62);
            }
            Button(content, app.Busy ? "正在入山…" : "立道号 · 入青云", () =>
            {
                string value = name.value.Trim();
                if (value.Length < 2 || value.Length > 12) { Notice("道号需为2–12字，可用汉字、字母、数字和下划线。"); return; }
                if (!avatars.Values<string>().Contains(uiAvatar)) { Notice("请选择一幅容貌。"); return; }
                app.CreateCharacter(value, uiAvatar, uiGender);
            }, !app.Busy, "primary");
        }
        void OpenSettings()
        {
            ShowSheet("仙府设置", parent =>
            {
                var address = Field(parent, "auth-server", "仙府地址", false, app.ServerUrl);
                Text(parent, "地址在下一次登录时使用。", "muted");
                Button(parent, "保存地址", () => { if (!ValidServer(address.value.Trim())) { Notice("请输入完整的HTTP或HTTPS地址。"); return; } CloseSheet(); Notice("地址已保留，下次登录时使用。"); });
                Text(parent, "本作尚无宗门系统，底部“道友”承载现有社交与组队。", "muted");
                if (app.LoggedIn) Button(parent, "退出当前账号", () => { CloseSheet(); foreach (string key in uiSecretKeys) uiInputs.Remove(key); app.Logout(); }, !app.Busy, "danger");
            });
        }

        public void ShowBattle(JObject result, string title)
        {
            uiBattles.Clear();
            if (result == null) { Notice("战报尚未返回。"); return; }
            uiBattleWrapper = (JObject)result.DeepClone();
            foreach (var battle in BattlePackets(uiBattleWrapper)) uiBattles.Add(battle);
            if (uiBattles.Count == 0) { Notice("这份记录未包含可回放战报。"); return; }
            uiBattleTitle = title ?? "斗法战报"; uiBattleIndex = 0;
            uiBattleNames.Clear(); uiBattleArt.Clear();
            string self = app.Character?.Value<string>("id");
            if (self != null) { uiBattleNames[self] = app.Character.Value<string>("name"); uiBattleArt[self] = app.AvatarId; }
            foreach (string field in new[] { "opponent", "target" })
                if (result[field] is JObject person)
                {
                    string id = person.Value<string>("id") ?? person.Value<string>("characterId");
                    if (id != null) { uiBattleNames[id] = person.Value<string>("name"); uiBattleArt[id] = person.Value<string>("avatarArt"); }
                }
            if (result.Value<string>("attackerId") is string attacker)
            { uiBattleNames[attacker] = result.Value<string>("attackerName"); uiBattleArt[attacker] = result.Value<string>("attackerAvatarArt"); }
            foreach (var wave in (result["waves"] as JArray ?? new JArray()).OfType<JObject>())
                foreach (var enemy in (wave["enemies"] as JArray ?? new JArray()).OfType<JObject>())
                { string id = enemy.Value<string>("id"); if (id != null) { uiBattleNames[id] = enemy.Value<string>("name"); uiBattleArt[id] = enemy.Value<string>("art"); } }
            BeginBattleWave();
            ShowSheet(uiBattleTitle, RenderBattleSheet);
        }
        static IEnumerable<JObject> BattlePackets(JObject result)
        {
            if (result["log"] is JArray) return new[] { result };
            if (result["battle"] is JObject battle && battle["log"] is JArray) return new[] { battle };
            return (result["battles"] as JArray ?? result["replay"] as JArray ?? result["waves"] as JArray ?? new JArray()).OfType<JObject>().SelectMany(BattlePackets);
        }
        void BeginBattleWave()
        {
            uiBattleCursor = 0; uiBattlePaused = false; uiBattleFinished = false; uiBattleNext = Time.unscaledTime + .4f;
            uiBattleHp.Clear(); uiBattleFeed.Clear();
            // Carry only actual prior-wave values; standalone results do not disclose every fighter's starting wound.
            if (uiBattleIndex > 0 && uiBattles[uiBattleIndex - 1]["finalHp"] is JObject previous)
                foreach (var hp in previous.Properties())
                    if (uiBattles[uiBattleIndex]["maxHp"]?[hp.Name] != null) uiBattleHp[hp.Name] = hp.Value.Value<double>();
            foreach (var hp in (uiBattles[uiBattleIndex]["maxHp"] as JObject ?? new JObject()).Properties())
            {
                string id = hp.Name;
                if (uiBattleNames.ContainsKey(id)) continue;
                string baseId = id.Split('#')[0];
                var monster = app.Catalog.Find("monsters", baseId);
                if (monster != null) { uiBattleNames[id] = monster.Value<string>("name"); uiBattleArt[id] = monster.Value<string>("art"); }
            }
        }
        void RenderBattleSheet(VisualElement parent)
        {
            var battle = uiBattles[uiBattleIndex];
            if (uiBattleWrapper["participantIds"] is JArray participants && participants.Count > 1)
            {
                var party = app.Data("party.get")?["party"] as JObject;
                foreach (var member in (party?["members"] as JArray ?? new JArray()).OfType<JObject>())
                {
                    string memberId = member.Value<string>("characterId");
                    if (memberId != null) { uiBattleNames[memberId] = member.Value<string>("name"); uiBattleArt[memberId] = member.Value<string>("avatarArt"); }
                }
            }
            string wave = (uiBattleWrapper["waves"] as JArray)?.ElementAtOrDefault(uiBattleIndex)?.Value<string>("name");
            uiBattleProgress = Text(parent, $"{wave ?? "斗法"} · 第{uiBattleIndex + 1}/{uiBattles.Count}阵", "section-title");
            var controls = Row(parent);
            uiBattlePauseButton = Button(controls, uiBattlePaused ? "继续" : "暂停", () => { uiBattlePaused = !uiBattlePaused; uiBattlePauseButton.text = uiBattlePaused ? "继续" : "暂停"; }, !uiBattleFinished);
            Button(controls, "跳过本阵", () => { uiBattleCursor = (battle["log"] as JArray)?.Count ?? 0; FinishBattleWave(); });
            Button(controls, "重看本阵", () => { BeginBattleWave(); BuildSheet(false); });
            uiBattleVerdict = new VisualElement { pickingMode = PickingMode.Ignore }; parent.Add(uiBattleVerdict);
            uiBattleFighters = Row(parent, "battle-fighters");
            uiBattleLog = new VisualElement { pickingMode = PickingMode.Ignore }; uiBattleLog.AddToClassList("battle-log"); parent.Add(uiBattleLog);
            // The onward action stays outside the scrolling roster/log, including after skipping a wave.
            var footer=new VisualElement(); footer.AddToClassList("battle-footer"); uiSheet.Add(footer);
            uiBattleFooterStatus=Text(footer,"","small");
            uiBattleNextButton = Button(footer, uiBattleIndex + 1 < uiBattles.Count ? "进入下一阵" : "收功", () =>
            {
                if (uiBattleIndex + 1 < uiBattles.Count) { uiBattleIndex++; BeginBattleWave(); BuildSheet(false); }
                else CloseSheet();
            }, uiBattleFinished, "primary");
            PaintBattle();
        }
        void Update()
        {
            if (uiSheetBuilder != (Action<VisualElement>)RenderBattleSheet || uiBattlePaused || uiBattleFinished || uiBattleFighters?.panel == null || Time.unscaledTime < uiBattleNext) return;
            var log = uiBattles[uiBattleIndex]["log"] as JArray;
            if (log == null || uiBattleCursor >= log.Count) { FinishBattleWave(); return; }
            var evt = log[uiBattleCursor++] as JObject;
            if (evt == null) return;
            string type = evt.Value<string>("type"), target = evt.Value<string>("targetId");
            if ((type == "damage" || type == "heal") && target != null && evt["targetHp"] != null) uiBattleHp[target] = evt.Value<double>("targetHp");
            if (type == "death" && target != null) uiBattleHp[target] = 0;
            string line = BattleLine(evt);
            if (!string.IsNullOrEmpty(line)) { uiBattleFeed.Add(line); if (uiBattleFeed.Count > 9) uiBattleFeed.RemoveAt(0); }
            uiBattleNext = Time.unscaledTime + (type == "round_start" || type == "death" ? .46f : .32f);
            if (type == "battle_end" || uiBattleCursor >= log.Count) FinishBattleWave();
            else PaintBattle();
        }
        string BattleName(string id) => id != null && uiBattleNames.TryGetValue(id, out var name) && !string.IsNullOrEmpty(name) ? name : "未署名修士";
        string BattleLine(JObject e)
        {
            string actor = BattleName(e.Value<string>("actorId")), target = BattleName(e.Value<string>("targetId"));
            switch (e.Value<string>("type"))
            {
                case "round_start": return $"— 第{e["round"]}回合 —";
                case "skill_cast": return actor + "施展「" + e["skillName"] + "」";
                case "damage": return e.Value<bool>("dodged") ? target + "闪避了攻击" : target + $"受到 {e.Value<double>("amount"):N0} 点伤害" + (e.Value<bool>("crit") ? " · 暴击" : "");
                case "heal": return target + $"回复 {e.Value<double>("amount"):N0} 气血";
                case "buff": case "debuff": return target + " · " + BattleStat(e.Value<string>("stat")) + $" {e.Value<double>("amount"):+0.##;-0.##;0}，持续{e["durationRounds"]}回合";
                case "death": return target + "力竭倒下";
                case "battle_end": return "本阵已分 · " + BattleWinner(e.Value<string>("winner"));
                default: return null;
            }
        }
        static string BattleWinner(string winner) => winner == "A" ? "挑战方获胜" : winner == "B" ? "对阵方获胜" : "未分胜负";
        static string BattleStat(string key) => key == "hp" ? "气血" : key == "atk" ? "攻击" : key == "def" ? "防御" : key == "spd" ? "速度" : key == "crit" ? "暴击" : key == "critResist" ? "抗暴" : key == "acc" ? "命中" : key == "eva" ? "闪避" : key;
        void FinishBattleWave()
        {
            uiBattleFinished = true;
            if (uiBattles[uiBattleIndex]["finalHp"] is JObject final)
                foreach (var hp in final.Properties()) uiBattleHp[hp.Name] = hp.Value.Value<double>();
            PaintBattle();
        }
        void PaintBattle()
        {
            if (uiBattleFighters == null || uiBattleLog == null) return;
            var battle = uiBattles[uiBattleIndex];
            uiBattleFighters.Clear();
            foreach (var stat in (battle["maxHp"] as JObject ?? new JObject()).Properties())
            {
                string id = stat.Name; double maximum = stat.Value.Value<double>();
                var fighter = Card(uiBattleFighters); fighter.AddToClassList("battle-fighter");
                var row=Row(fighter,"battle-fighter-row");
                if (uiBattleArt.TryGetValue(id, out var art) && !string.IsNullOrEmpty(art))
                { var avatar = Picture(row, app.Catalog.Art(art), 40); avatar.AddToClassList("battle-avatar"); }
                var details=new VisualElement { pickingMode=PickingMode.Ignore }; details.AddToClassList("battle-fighter-details"); row.Add(details);
                Text(details, BattleName(id), "small");
                if (uiBattleHp.TryGetValue(id, out double current)) Meter(details, maximum > 0 ? (float)(current / maximum) : 0, $"{current:N0}/{maximum:N0}");
                else Text(details, $"气血待记录 / {maximum:N0}", "small");
                if (uiBattleFinished) Text(details, "总伤害 " + (battle["damageDealt"]?.Value<double?>(id) ?? 0).ToString("N0"), "small");
            }
            uiBattleLog.Clear();
            if (uiBattleFeed.Count == 0) Text(uiBattleLog, uiBattleFinished ? "已跳至战斗结算。" : "凝神候战…", "muted");
            foreach (string line in uiBattleFeed) Text(uiBattleLog, line, "small");
            uiBattleVerdict.Clear();
            uiBattlePauseButton?.SetEnabled(!uiBattleFinished); uiBattleNextButton?.SetEnabled(uiBattleFinished);
            if(uiBattleFooterStatus!=null) uiBattleFooterStatus.text=$"第{uiBattleIndex+1}/{uiBattles.Count}阵 · "+(uiBattleFinished?BattleWinner(battle.Value<string>("winner")):$"已阅 {uiBattleCursor}/{(battle["log"] as JArray)?.Count??0} 条记录");
            if (!uiBattleFinished) return;
            Text(uiBattleVerdict, BattleWinner(battle.Value<string>("winner")) + $" · {battle["rounds"]}回合", "section-title");
            Text(uiBattleVerdict, battle.Value<string>("reason") == "team_wiped" ? "一方力竭" : "达到回合上限", "muted");
            if (uiBattleIndex != uiBattles.Count - 1) return;
            string verdict = uiBattleWrapper.Value<bool?>("cleared") is bool clear ? clear ? "秘境通关" : "未能通关" : uiBattleWrapper.Value<bool?>("won") is bool won ? won ? "此战告捷" : "此战未胜" : uiBattleWrapper.Value<bool?>("defeated") is bool defeated ? defeated ? "围攻目标已击破" : "围攻目标尚未击破" : uiBattleWrapper.Value<bool?>("defenderLost") is bool lost ? lost ? "此战未能守住" : "此战守住了" : null;
            if (verdict != null) Text(uiBattleVerdict, verdict, "section-title");
            if (uiBattleWrapper["remainingHpPercent"] != null) Text(uiBattleVerdict, "目标剩余气血 " + uiBattleWrapper.Value<double>("remainingHpPercent").ToString("P1"));
            if (uiBattleWrapper["ratingAfter"] != null) Text(uiBattleVerdict, $"天梯 {uiBattleWrapper["ratingBefore"]} → {uiBattleWrapper["ratingAfter"]}");
            if (uiBattleWrapper["ratingDelta"] != null) Text(uiBattleVerdict, "天梯变动 " + uiBattleWrapper["ratingDelta"]);
            if (uiBattleWrapper["reward"] is JObject reward)
            {
                var parts = new List<string>();
                foreach (string key in new[] { "exp", "spiritStones" }) if ((reward.Value<double?>(key) ?? 0) != 0) parts.Add((key == "exp" ? "修为 +" : "灵石 +") + reward.Value<double>(key).ToString("N0"));
                var names = reward["itemNames"] as JArray;
                if (names != null && names.Count > 0) parts.AddRange(names.Values<string>());
                else foreach (var item in (reward["items"] as JArray ?? new JArray()).OfType<JObject>()) parts.Add((item.Value<string>("name") ?? app.Catalog.Name("items", item.Value<string>("itemId"))) + " ×" + item["qty"]);
                Text(uiBattleVerdict, parts.Count == 0 ? "本场无额外奖励。" : "所得：" + string.Join(" · ", parts));
            }
            Button(uiBattleVerdict, "查看本阵完整记录", () => ShowSheet("完整战报", parent => { foreach (var evt in (battle["log"] as JArray ?? new JArray()).OfType<JObject>()) { string line = BattleLine(evt); if (line != null) Text(parent, line, "small"); } }));
        }
        [ContextMenu("Verify battle response wrappers")]
        void UiVerifyBattleWrappers()
        {
            var b = new JObject { ["log"] = new JArray(), ["winner"] = "draw" };
            Debug.Assert(BattlePackets(b).Count() == 1 && BattlePackets(new JObject { ["battle"] = b.DeepClone() }).Count() == 1);
            Debug.Assert(BattlePackets(new JObject { ["battles"] = new JArray(b.DeepClone(), b.DeepClone()) }).Count() == 2 && BattlePackets(new JObject { ["replay"] = new JArray(b.DeepClone()) }).Count() == 1);
            Debug.Assert(!BattlePackets(new JObject()).Any() && !ValidServer("javascript:alert(1)") && ValidServer("http://127.0.0.1:3100"));
        }
        void OnDestroy()
        {
            if (uiPanel != null) Destroy(uiPanel);
            foreach (string key in uiSecretKeys) uiInputs.Remove(key);
        }
    }
}
