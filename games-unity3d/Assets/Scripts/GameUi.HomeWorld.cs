using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Qingyun
{
    public sealed partial class GameUi
    {
        // Official composition: news/3 (2020-12-03) and news/273 (2023-03-16 development preview).
        // Public controls guide the layout; cultivation and breakthrough numbers remain the exported project rules.
        int homeBreakPills;
        JObject homeEncounter;
        string homeEncounterToken;

        void RenderHome()
        {
            if (app.CharacterView == null) { Text(content,"正在接引仙府…","muted"); return; }
            // Historical official scene seals + 2023 focused cultivation layout; original artwork and existing actions.
            var scene = new VisualElement { name="cultivation-scene", pickingMode=PickingMode.Ignore };
            scene.AddToClassList("home-scene"); content.Add(scene);
            var title = Text(scene,"洞府","home-scene-title");
            if(uiBrushFont!=null) title.style.unityFontDefinition=FontDefinition.FromFont(uiBrushFont);
            Text(scene,"观山听雨，静候一念生","home-scene-note");
            var ring = new VisualElement { pickingMode=PickingMode.Ignore };
            ring.AddToClassList("home-qi-ring"); scene.Add(ring);
            var figure=Picture(scene,app.Catalog.Art(app.Character.Value<string>("gender")=="female" ? "char/meditate-f" : "char/meditate-m"),280);
            figure.AddToClassList("home-meditator"); figure.style.width=Length.Percent(76); figure.style.height=290; figure.scaleMode=ScaleMode.ScaleToFit; figure.pickingMode=PickingMode.Ignore;
            scene.schedule.Execute(()=>{
                float t=Time.unscaledTime;
                ring.style.opacity=.55f+Mathf.Sin(t*1.4f)*.18f;
                figure.style.translate=new Translate(0,Mathf.Sin(t*.8f)*1.5f,0);
            }).Every(40);
            int sealIndex=0;
            foreach(var entry in new[]{new[]{"法宝","treasures","器室"},new[]{"古宝","relics","藏珍"},new[]{"寻宝","gacha","机缘"},new[]{"日课","daily","修行"},new[]{"功法神通","character","己身"},new[]{"青云镇","town","入世"}})
            {
                string page=entry[1];
                var seal=new VisualElement { pickingMode=PickingMode.Ignore };
                seal.AddToClassList("home-seal");
                seal.style.top=68+(sealIndex%3)*106;
                if(sealIndex<3) seal.style.left=0; else seal.style.right=0;
                scene.Add(seal);
                var entrance=Button(seal,entry[0],()=>app.Navigate(page));
                if(uiBrushFont!=null) entrance.style.unityFontDefinition=FontDefinition.FromFont(uiBrushFont);
                Text(seal,entry[2],"home-seal-caption");
                sealIndex++;
            }
            var practice=new VisualElement(); practice.AddToClassList("home-practice"); content.Add(practice);
            var stage=Text(practice,"","section-title");
            var progress=new ProgressBar { lowValue=0,highValue=100 }; progress.AddToClassList("home-progress"); practice.Add(progress);
            var timing=Text(practice,"","muted");
            Action update=()=>{
                var view=app.CharacterView; var ch=app.Character; if(view==null||ch==null)return;
                double required=Math.Max(1,view.Value<double>("expRequired"));
                double elapsed=Math.Max(0,(app.ServerTime-ch.Value<long>("lastSettledAt"))/1000d);
                double rate=view.Value<double>("ratePerSec");
                double displayed=Math.Min(required,ch.Value<double>("exp")+rate*elapsed);
                stage.text=view.Value<string>("stageName"); progress.value=(float)(displayed/required*100);
                progress.title=$"修为 {displayed:N0} / {required:N0}";
                timing.text=view.Value<bool>("atPerfection") ? "修为圆满，可以尝试突破" : $"修炼 {rate:N1}/秒 · 约 {HomeDuration((required-displayed)/Math.Max(rate,.01))} 至下一阶段";
                if(displayed>=required && !view.Value<bool>("atPerfection")) app.RefreshCharacter();
                if((ch["buffs"] as JArray)?.Any(v=>(long?)v["expiresAt"]<=app.ServerTime)==true) app.RefreshCharacter();
            };
            update(); practice.schedule.Execute(update).Every(500);
            var acts=Row(practice,"home-actions");
            Button(acts,"服用丹药",HomePills,!app.Busy);
            Button(acts,"收功结算",()=>app.Command("character.settle",null,ShowOfflineReturn),!app.Busy);
            Button(acts,"运功破境",()=>ShowSheet("运功破境",HomeBreakthrough),app.CharacterView.Value<bool>("atPerfection") && app.Character.Value<int>("stageIndex")<35 && !app.Busy,"primary");

            if(!string.IsNullOrEmpty(app.ActiveZoneId))
            {
                var away=Card(content,"分神历练");
                Text(away,"仍在 "+app.Catalog.Name("maps",app.ActiveZoneId)+" 挂机");
                Button(away,"查看秘境",()=>app.Navigate("world"));
            }
        }

        public void ShowOfflineReturn(JObject summary)
        {
            if(summary==null)return;
            ShowSheet("闭关归来",parent=>{
                Text(parent,"静水流深，修行未辍。","section-title");
                Text(parent,$"入账修为 +{summary.Value<double>("gainedExp"):N0}");
                Text(parent,"计入时长 "+HomeDuration(summary.Value<double>("creditedSec")));
                if(summary.Value<double>("forfeitedSec")>1) Text(parent,"逾期散去 "+HomeDuration(summary.Value<double>("forfeitedSec")),"muted");
                if(summary.Value<int>("stageUps")>0) Text(parent,"境界进益："+string.Join(" · ",(summary["stagesPassed"] as JArray ?? new JArray()).Values<string>()));
                if((app.ZoneLoot.Value<long?>("kills")??0)>0)
                    Text(parent,$"秘境收获 · 斩妖 {app.ZoneLoot["kills"]} · 妖王 {app.ZoneLoot["bossKills"]}\n修为 +{app.ZoneLoot["exp"]} · 灵石 +{app.ZoneLoot["spiritStones"]}");
                Button(parent,"继续修行",CloseSheet,true,"primary");
            });
        }

        void HomePills()
        {
            ShowSheet("丹房 · 服用",parent=>{
                var pills=(app.CharacterView?["inventory"] as JArray ?? new JArray()).OfType<JObject>()
                    .Where(v=>app.Catalog.Find("items",v.Value<string>("itemId"))?.Value<string>("kind")=="pill" && v.Value<int>("qty")>0).ToArray();
                if(pills.Length==0) { Text(parent,"囊中无丹，可去青云镇坊市寻购。","muted"); Button(parent,"前往青云镇",()=>{CloseSheet();app.Navigate("town");}); }
                foreach(var row in pills)
                {
                    var item=app.Catalog.Find("items",row.Value<string>("itemId")); string uid=row.Value<string>("uid");
                    var card=Card(parent,$"{item["name"]} ×{row["qty"]}");
                    var line=Row(card); Art(line,item.Value<string>("art")); Text(line,item.Value<string>("description"),"muted");
                    if(item["effect"]?.Value<string>("type")=="breakthrough_aid") Button(card,"前往突破",()=>ShowSheet("运功破境",HomeBreakthrough));
                    else Button(card,"服用一颗",()=>app.Command("inventory.use",new JObject{["uid"]=uid,["qty"]=1},r=>Notice(r.Value<string>("message")??"药效已入经脉。")),!app.Busy,"primary");
                }
            });
        }

        void HomeBreakthrough(VisualElement parent)
        {
            var ch=app.Character; var view=app.CharacterView; if(ch==null||view==null)return;
            int stage=ch.Value<int>("stageIndex");
            var definition=app.Catalog.Find("stages",stage.ToString());
            var rules=app.Catalog.Json["breakthroughRules"] as JObject;
            string pill=rules?.Value<string>("pillId")??"pill-breakthrough";
            int owned=(view["inventory"] as JArray ?? new JArray()).Where(x=>(string)x["itemId"]==pill).Sum(x=>(int?)x["qty"]??0);
            int max=Math.Min(owned,rules?.Value<int>("maxPills")??4);
            homeBreakPills=Mathf.Clamp(homeBreakPills,0,max);
            Text(parent,view.Value<string>("stageName"),"section-title");
            Text(parent,definition?.Value<bool>("requiresTribulation")==true ? "须先渡过天劫，再问下一重天地。" : "成则进境，败则散去部分修为。","muted");
            var chance=definition?["breakthroughChances"] as JArray;
            if(chance!=null && chance.Count>homeBreakPills) Text(parent,$"基础成算 {(double)chance[homeBreakPills]:P0}","heading");
            Text(parent,"世界修行倍率由仙府结算，最终成算以本次结果为准。","small");
            Text(parent,$"破境丹 · 囊中 {owned}");
            var choices=Row(parent);
            for(int i=0;i<=(rules?.Value<int>("maxPills")??4);i++)
            { int n=i; Button(choices,n+" 颗",()=>{homeBreakPills=n;Rebuild();},n<=max,homeBreakPills==n?"primary":"secondary"); }
            bool ready=view.Value<bool>("atPerfection")&&stage<35;
            if(!ready) Text(parent,stage>=35?"此方天地已至最高境界。":"须先将当前圆满境界修为修满。","muted");
            Button(parent,app.Busy?"运功中…":"起念破境",()=>app.Command("character.breakthrough",new JObject{["pills"]=homeBreakPills},result=>{
                ShowSheet(result.Value<bool>("success")?"突破成功":"此次未能破境",body=>{
                    Text(body,result.Value<bool>("success")?result.Value<string>("fromStageName")+" → "+result.Value<string>("toStageName"):$"散去修为 {result.Value<double>("expLost"):N0}","section-title");
                    Text(body,$"本次实际成算 {result.Value<double>("chance"):P0}");
                    if(result["tribulation"] is JObject battle) Button(body,"回看天劫",()=>ShowBattle(battle,"天劫"));
                    Button(body,"收功",CloseSheet,true,"primary");
                });
            }),ready&&!app.Busy,"primary");
        }

        void RenderWorld()
        {
            Heading("秘境",app.WatchingZone ? app.Catalog.Name("maps",app.ActiveZoneId)+" · 自动历练" : "山河有界，机缘无尽");
            var shortcuts=Row(content);
            Button(shortcuts,"秘境副本",()=>app.Navigate("dungeons"));
            Button(shortcuts,"论道",()=>app.Navigate("arena"));
            Button(shortcuts,"围攻妖修",()=>app.Navigate("raid"));
            if(app.WatchingZone)
            {
                // Official 2023-12 combat information priority; only this project's server HP is displayed.
                var status=Row(content,"world-status");
                var showSelf=WorldActorStatus(status,"己身");
                var showTarget=WorldActorStatus(status,"锁定");
                Action refreshStatus=()=>{
                    app.Zone.Actors.TryGetValue(app.SelfSlot,out var self);
                    ZoneState.Actor target=null;
                    if(self!=null && self.Target>=0) app.Zone.Actors.TryGetValue(self.Target,out target);
                    showSelf(self); showTarget(target);
                };
                refreshStatus(); status.schedule.Execute(refreshStatus).Every(100);
                var hud=Card(content);
                var counts=Text(hud,"","small");
                hud.schedule.Execute(()=>counts.text=$"斩妖 {app.ZoneLoot["kills"]} · 妖王 {app.ZoneLoot["bossKills"]} · 灵石 {app.ZoneLoot["spiritStones"]} · 修为 {app.ZoneLoot["exp"]}").Every(500);
                var actions=Row(hud);
                Button(actions,"跟随己身",app.FocusSelf); Button(actions,"前往妖王",app.FocusBoss);
                Button(actions,"撤离秘境",app.Retreat,!app.Busy,"danger");
                Button(actions,"更换秘境",()=>ShowSheet("山河图",WorldMaps));
                var space=new VisualElement{pickingMode=PickingMode.Ignore};space.style.minHeight=450;content.Add(space);
            }
            else WorldMaps(content);
        }

        Action<ZoneState.Actor> WorldActorStatus(VisualElement parent,string role)
        {
            var pane=Row(parent,"world-status-actor");
            var portrait=new VisualElement { pickingMode=PickingMode.Ignore }; portrait.AddToClassList("world-status-portrait"); pane.Add(portrait);
            var picture=Picture(portrait,null,40); picture.style.marginLeft=0; picture.style.marginRight=0; picture.style.marginTop=0; picture.style.marginBottom=0; picture.scaleMode=ScaleMode.ScaleAndCrop;
            var details=new VisualElement { pickingMode=PickingMode.Ignore }; details.AddToClassList("world-status-details"); pane.Add(details);
            var name=Text(details,role,"world-status-name");
            var bar=new VisualElement { pickingMode=PickingMode.Ignore }; bar.AddToClassList("meter"); details.Add(bar);
            var fill=new VisualElement { pickingMode=PickingMode.Ignore }; fill.AddToClassList("meter-fill"); bar.Add(fill);
            var hp=Text(bar,"—","meter-caption");
            string lastArt=null;
            return actor=>{
                name.text=role+" · "+(actor?.Name ?? (role=="己身" ? "同步中" : "尚未锁定"));
                string art=actor?.Art;
                if(actor!=null && role=="己身" && string.IsNullOrEmpty(art)) art=app.AvatarId;
                if(lastArt!=art || actor==null) { picture.image=string.IsNullOrEmpty(art)?null:app.Catalog.Art(art); lastArt=art; }
                fill.style.width=Length.Percent(actor==null||actor.MaxHp<=0?0:Mathf.Clamp01((float)actor.Hp/actor.MaxHp)*100);
                hp.text=actor==null?"—":$"{actor.Hp:N0}/{actor.MaxHp:N0}";
            };
        }

        void WorldMaps(VisualElement parent)
        {
            var data=app.Data("explore.maps");
            if(data==null){Text(parent,"正在铺展山河图…","muted");Button(parent,"重新读取",()=>app.Refresh("explore.maps"));return;}
            foreach(var map in (data["maps"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string id=map.Value<string>("id"); bool unlocked=map.Value<bool>("unlocked");
                var card=Card(parent,map.Value<string>("name"));
                Picture(card,app.Catalog.Art(map.Value<string>("art")),112);
                Text(card,map.Value<string>("description"),"muted");
                Text(card,"推荐 "+app.Catalog.Name("stages",map.Value<int>("recommendedStage").ToString()),"small");
                if(!unlocked) Text(card,"需达到 "+app.Catalog.Name("stages",map.Value<int>("unlockStage").ToString()),"muted");
                var buttons=Row(card);
                Button(buttons,"入境挂机",()=>{CloseSheet();app.EnterZone(id);},unlocked&&!app.Busy,"primary");
                Button(buttons,"探索机缘",()=>app.Command("explore.battle",new JObject{["mapId"]=id},WorldExploration),unlocked&&!app.Busy);
                long readyAt=map.Value<long>("gatherReadyAt");
                var gather=Button(buttons,"采药",()=>app.Command("explore.gather",new JObject{["mapId"]=id},result=>Notice(HomeReward(result["reward"]))),unlocked&&!app.Busy&&readyAt<=app.ServerTime);
                card.schedule.Execute(()=>{
                    long remain=Math.Max(0,readyAt-app.ServerTime);
                    gather.text=remain>0?"采药 · "+HomeDuration(remain/1000d):"采药";
                    gather.SetEnabled(unlocked&&!app.Busy&&remain==0);
                }).Every(1000);
            }
        }

        void WorldExploration(JObject result)
        {
            if(result.Value<string>("kind")=="battle") { ShowBattle(result,result.Value<string>("monsterName")??"秘境斗法"); return; }
            homeEncounter=result["encounter"] as JObject;homeEncounterToken=result.Value<string>("encounterToken");
            if(homeEncounter==null||string.IsNullOrEmpty(homeEncounterToken)){Notice("机缘记录不完整，请重新探索。");return;}
            ShowSheet(homeEncounter.Value<string>("name"),WorldEncounter);
        }
        void WorldEncounter(VisualElement parent)
        {
            if(homeEncounter==null)return;
            Picture(parent,app.Catalog.Art(homeEncounter.Value<string>("art")),180);
            Text(parent,homeEncounter.Value<string>("text"));
            foreach(var option in (homeEncounter["options"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string id=option.Value<string>("id"); string gate=WorldCondition(option["conditions"] as JArray);
                Text(parent,gate??"","small");
                Button(parent,option.Value<string>("text"),()=>app.Command("explore.chooseEvent",new JObject{["encounterToken"]=homeEncounterToken,["optionId"]=id},result=>{
                    homeEncounterToken=null;
                    ShowSheet("机缘既成",body=>{Text(body,result.Value<string>("outcomeText"));Text(body,HomeReward(result["reward"]),"section-title");Button(body,"继续前行",CloseSheet,true,"primary");});
                }),gate==null&&!app.Busy&&homeEncounterToken!=null);
            }
        }
        string WorldCondition(JArray conditions)
        {
            foreach(var c in conditions??new JArray())
            {
                string type=c.Value<string>("type");
                if(type=="spirit_stones_at_least" && (app.Character.Value<long?>("spiritStones")??0)<c.Value<long>("amount"))return "需灵石 "+c["amount"];
                if(type=="stage_at_least" && app.Character.Value<int>("stageIndex")<c.Value<int>("stageIndex"))return "需达到 "+app.Catalog.Name("stages",c["stageIndex"].ToString());
                if(type=="stage_below" && app.Character.Value<int>("stageIndex")>=c.Value<int>("stageIndex"))return "当前境界不符此机缘。";
                if(type=="has_item")
                {int owned=(app.CharacterView["inventory"] as JArray??new JArray()).Where(v=>(string)v["itemId"]==(string)c["itemId"]).Sum(v=>(int?)v["qty"]??0);if(owned<((int?)c["qty"]??1))return "需 "+app.Catalog.Name("items",(string)c["itemId"])+" ×"+c["qty"];}
            }
            return null; // The server evaluates every condition again, including story flags.
        }
        string HomeReward(JToken reward)
        {
            if(reward==null)return "已同步仙府记录。";
            var parts=new System.Collections.Generic.List<string>();
            if((double?)reward["exp"]>0)parts.Add($"修为 +{(double)reward["exp"]:N0}");
            if((double?)reward["spiritStones"]>0)parts.Add($"灵石 +{(double)reward["spiritStones"]:N0}");
            foreach(var item in reward["items"] as JArray??new JArray())parts.Add(app.Catalog.Name("items",(string)item["itemId"])+" ×"+item["qty"]);
            return parts.Count>0?string.Join(" · ",parts):"机缘已记入仙府。";
        }
        static string HomeDuration(double seconds)
        {
            var span=TimeSpan.FromSeconds(Math.Max(0,Math.Min(seconds,315360000)));
            return span.TotalDays>=1?$"{(int)span.TotalDays}日{span.Hours}时":span.TotalHours>=1?$"{(int)span.TotalHours}时{span.Minutes}分":$"{span.Minutes}分{span.Seconds}秒";
        }
    }
}
