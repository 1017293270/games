using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Qingyun
{
    /// <summary>Server-authoritative frame cache. Unity never calculates combat or loot.</summary>
    public sealed class ZoneState
    {
        public sealed class Actor
        {
            public int Slot, Stage, MaxHp, Hp, Flags, Target;
            public string Name, Kind, Art;
            public float X, Z;
        }

        public readonly Dictionary<int, Actor> Actors = new Dictionary<int, Actor>();
        public readonly List<int> Updated = new List<int>();
        public readonly List<int> Removed = new List<int>();
        public long Sequence { get; private set; } = -1;
        public long ServerTime { get; private set; }
        public bool NeedsSync { get; private set; }
        public bool BossAlive { get; private set; }
        public long NextBossAt { get; private set; }
        public string ZoneId { get; private set; } = "map-qingyun-mountain";

        public void SetZone(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("地图不能为空。", nameof(id));
            ZoneId = id;
            Reset();
        }

        public void Reset()
        {
            Actors.Clear(); Updated.Clear(); Removed.Clear();
            Sequence = -1; ServerTime = 0; NeedsSync = false;
            BossAlive = false; NextBossAt = 0;
        }

        public bool Apply(JObject frame)
        {
            Updated.Clear(); Removed.Clear();
            if ((string)frame["zoneId"] != ZoneId)
                throw new FormatException("收到其他地图的数据。");
            long seq = frame.Value<long>("seq");
            bool full = frame.Value<bool>("full");
            if (seq <= Sequence) return false;
            if (!full && (Sequence < 0 || seq != Sequence + 1 || NeedsSync))
            { NeedsSync = true; return false; }

            var additions = frame["add"] as JArray;
            var removals = frame["remove"] as JArray;
            var tuples = frame["ents"] as JArray;
            var boss = frame["boss"] as JObject;
            if (additions == null || removals == null || tuples == null || boss == null ||
                additions.Count > 2000 || tuples.Count > 2000)
                throw new FormatException("战场数据不完整。");

            // Validate the entire frame before touching the accepted state.
            var next = full ? new Dictionary<int, Actor>() : new Dictionary<int, Actor>(Actors);
            foreach (JToken item in removals) next.Remove(item.Value<int>());
            foreach (JObject item in additions)
            {
                int slot = item.Value<int>("i"), maxHp = item.Value<int>("maxHp");
                string kind = item.Value<string>("kind");
                if (slot < 0 || maxHp < 1 ||
                    (kind != "player" && kind != "bot" && kind != "monster" && kind != "boss"))
                    throw new FormatException("战场角色数据无效。");
                next[slot] = new Actor { Slot = slot, Name = item.Value<string>("name") ?? "无名修士",
                    Kind = kind, Art = item.Value<string>("art"), Stage = item.Value<int>("stageIndex"), MaxHp = maxHp, Target = -1 };
            }
            foreach (JToken token in tuples)
            {
                var tuple = token as JArray;
                if (tuple == null || tuple.Count != 7) throw new FormatException("战场坐标格式无效。");
                int slot = tuple[0].Value<int>();
                if (!next.TryGetValue(slot, out Actor old)) { NeedsSync = true; return false; }
                int x = tuple[1].Value<int>(), y = tuple[2].Value<int>();
                int hp = tuple[3].Value<int>(), flags = tuple[4].Value<int>();
                if (x < -10 || x > 610 || y < -10 || y > 910 || hp < 0 || flags < 0)
                    throw new FormatException("战场坐标超出边界。");
                next[slot] = new Actor { Slot = slot, Name = old.Name, Kind = old.Kind, Art = old.Art,
                    Stage = old.Stage, MaxHp = old.MaxHp, Hp = hp, Flags = flags,
                    Target = tuple[5].Value<int>(), X = x / 10f - 30f, Z = 45f - y / 10f };
                Updated.Add(slot);
            }
            foreach (var pair in Actors)
                if (!next.TryGetValue(pair.Key, out Actor replacement) || replacement.Kind != pair.Value.Kind ||
                    replacement.Name != pair.Value.Name || replacement.Stage != pair.Value.Stage || replacement.Art != pair.Value.Art) Removed.Add(pair.Key);
            // A recycled slot needs a new view even when the frame also adds its replacement.
            foreach (JToken slot in removals)
                if (!Removed.Contains(slot.Value<int>())) Removed.Add(slot.Value<int>());
            Actors.Clear();
            foreach (var entry in next) Actors.Add(entry.Key, entry.Value);
            Sequence = seq; ServerTime = frame.Value<long>("at"); NeedsSync = false;
            BossAlive = boss.Value<bool>("alive");
            NextBossAt = boss["nextAt"]?.Type == JTokenType.Integer ? boss.Value<long>("nextAt") : 0;
            return true;
        }
    }
}
