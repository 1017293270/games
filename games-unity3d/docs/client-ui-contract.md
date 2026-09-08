# Unity 全客户端实现契约

本契约供当前全面迁移分工使用；UI 采用 Unity 原生 UI Toolkit，服务端继续拥有数值和结果权威。玩法/布局依据见 full-migration-official-reference.md，功能全量清单见 migration-inventory.md。目标没有缩减成当前已实现子集。

## Bootstrap（主 agent 负责）

- `public JObject CharacterView { get; }`：完整服务器 CharacterView。
- `public JObject Character { get; }`：CharacterView.character。
- `public GameCatalog Catalog { get; }`：同源静态内容。
- `public string Page { get; }`、`public bool Busy { get; }`。
- `public JObject Data(string routeId, JObject query = null)`：按 catalog.routes 的 group.key 读取并缓存 GET 数据。未完成返回 null 并启动请求，成功后自动触发 UI 重绘；不请求不存在的 content API。
- `public void Refresh(params string[] routeIds)`：让指定 GET 路线缓存失效并重绘；空数组清所有 GET 缓存。
- `public void Command(string routeId, JObject input = null, Action<JObject> done = null)`：发送真实 REST 动作，统一防重复点击、错误展示，完成后刷新 CharacterView 并触发 UI 重绘。不会自动重试扣款类请求。
- `public void Emit(string eventName, object payload = null)`：发送真实 Socket 事件。
- `public void Navigate(string page)`：切换页面。
- `public void Notice(string text)`：用户可见提示。
- `public void RefreshCharacter()`：重新读取完整 CharacterView。

页面 ID：home、character、bag、town、world、social、treasures、relics、gacha、daily。组队/副本/榜单等可作为相应页面的子页或 sheet，但必须全部覆盖。

## GameCatalog（主 agent 负责）

- `public JObject Json { get; }`。
- `public JArray Table(string name)`。
- `public JObject Find(string table, string id)`；无记录返回 null。
- `public string Name(string table, string id)`；找不到返回 id。
- `public Texture2D Art(string artId)`；按 catalog.art 加载，找不到返回 null。
- `public Texture2D ProgressionArt(string definitionId)`；先查 progressionArt。

catalog 顶层表、routes/额外规则以生成的 Resources/Content/catalog.json 为准。

## GameUi（partial，各 feature 文件只写自己的部分）

namespace Qingyun；`public sealed partial class GameUi : MonoBehaviour`。

共享字段：`Bootstrap app`、`VisualElement content`。各 feature 的私有字段加功能前缀以免重名。

主 agent 提供这些 helper，返回的元素均已加入 parent：

- `VisualElement Row(VisualElement parent, string className = "row")`
- `VisualElement Card(VisualElement parent, string title = null)`
- `Label Text(VisualElement parent, string value, string className = "body")`
- `Button Button(VisualElement parent, string label, Action action, bool enabled = true, string className = "secondary")`
- `TextField Field(VisualElement parent, string key, string label, bool secret = false, string initial = "")`：输入按 key 跨重绘保留。
- `Image Art(VisualElement parent, string artId, float size = 56)`
- `Image Picture(VisualElement parent, Texture2D texture, float size = 72)`
- `void Meter(VisualElement parent, float fraction, string caption)`
- `void Heading(string title, string subtitle = null)`：当前页面标题。
- `void ShowSheet(string title, Action<VisualElement> build)`：可滚动弹层，GET 返回后也重绘；CloseSheet() 关闭。
- `void Rebuild()`：重绘当前页与 sheet，保持输入与滚动状态。

公共 CSS 类：body、muted、small、heading、section-title、row、card、primary、secondary、danger、grid、rarity-common/uncommon/rare/epic/legendary/mythic。可给 style 设置 width/flexGrow 等原生属性，不新增 UI 包。

各 feature entry：`void RenderCharacter()`、`void RenderBag()`、`void RenderProgression()`、`void RenderTown()`、`void RenderSocial()`。主 agent 负责 RenderHome/RenderWorld/Auth/导航/主框架。

不要添加假的已完成入口或本地模拟数值。依赖官方未公开规则时列入差异清单；先完整迁移真实既有机制，并继续补齐高还原所需的证据和功能。
