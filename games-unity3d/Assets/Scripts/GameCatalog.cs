using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Qingyun
{
    /// <summary>Content exported from the authoritative shared package; not another set of game rules.</summary>
    public sealed class GameCatalog
    {
        public JObject Json { get; }
        readonly Dictionary<string, Dictionary<string, JObject>> indices = new Dictionary<string, Dictionary<string, JObject>>();
        readonly Dictionary<string, Texture2D> textures = new Dictionary<string, Texture2D>();
        readonly JArray empty = new JArray();

        public GameCatalog()
        {
            var resource = Resources.Load<TextAsset>("Content/catalog");
            if (resource == null) throw new InvalidOperationException("缺少同源内容目录，请运行 npm run content。");
            Json = JObject.Parse(resource.text);
            if (!(Json["routes"] is JObject) || !(Json["art"] is JObject) || Table("stages").Count != 36)
                throw new FormatException("同源内容目录不完整，请重新导出。");
        }

        public JArray Table(string name) => Json[name] as JArray ?? empty;
        public JObject Find(string table, string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            if (!indices.TryGetValue(table, out var index))
            {
                index = new Dictionary<string, JObject>(StringComparer.Ordinal);
                foreach (var token in Table(table))
                {
                    if (!(token is JObject item)) continue;
                    string key = item.Value<string>("id") ?? item["index"]?.ToString();
                    if (!string.IsNullOrEmpty(key)) index[key] = item;
                }
                indices[table] = index;
            }
            index.TryGetValue(id, out var found);
            return found;
        }
        public string Name(string table, string id) => Find(table, id)?.Value<string>("name") ?? id ?? "无";
        public Texture2D Art(string id) => Load(Json["art"]?[id ?? ""]?.Value<string>());
        public Texture2D ProgressionArt(string id)
        {
            var texture = Load(Json["progressionArt"]?[id ?? ""]?.Value<string>());
            if (texture != null) return texture;
            var definition = Find("treasures", id) ?? Find("relics", id);
            return Art(definition?.Value<string>("art"));
        }
        public Texture2D Scene(string id) => Load(Json["sceneArt"]?[id ?? ""]?.Value<string>());
        Texture2D Load(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (!textures.TryGetValue(path, out var texture))
            { texture = Resources.Load<Texture2D>(path); textures[path] = texture; }
            return texture;
        }
    }
}
