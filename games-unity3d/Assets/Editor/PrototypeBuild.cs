using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace Qingyun
{
    public static class PrototypeBuild
    {
        const string Scene = "Assets/Scenes/QingyunMountain.unity";

        [InitializeOnLoadMethod]
        static void FirstOpen()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                Configure();
                if (!Application.isBatchMode && string.IsNullOrEmpty(SceneManager.GetActiveScene().path) &&
                    !SceneManager.GetActiveScene().isDirty)
                    EditorSceneManager.OpenScene(Scene);
            };
        }

        static void Configure()
        {
            PlayerSettings.companyName = "Qingyun";
            PlayerSettings.productName = "青云问道 · 水墨试玩";
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.defaultScreenWidth = 2400;
            PlayerSettings.defaultScreenHeight = 1500;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.runInBackground = true;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
            PlayerSettings.SetArchitecture(NamedBuildTarget.Standalone, 1);
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.template = "PROJECT:Ink";
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(Scene, true) };

            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>("Assets/Resources/UI/GamePanel.asset");
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panel, "Assets/Resources/UI/GamePanel.asset");
            }
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.screenMatchMode = PanelScreenMatchMode.Expand;
            panel.referenceResolution = new Vector2Int(390,844);
            panel.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>("Assets/Resources/UI/GameTheme.tss");
            panel.sortingOrder = 100;
            panel.clearColor = false;
            EditorUtility.SetDirty(panel);

            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
            var input = settings.FindProperty("activeInputHandler");
            if (input != null && input.intValue != 0) { input.intValue = 0; settings.ApplyModifiedPropertiesWithoutUndo(); }

            var inkShader = Shader.Find("Qingyun/InkSprite");
            if (inkShader == null) throw new InvalidOperationException("Ink sprite shader missing");
            var template = AssetDatabase.LoadAssetAtPath<Material>("Assets/Resources/WorldTemplate.mat");
            if (template == null)
            {
                template = new Material(inkShader);
                AssetDatabase.CreateAsset(template, "Assets/Resources/WorldTemplate.mat");
            }
            else if (template.shader != inkShader) { template.shader = inkShader; template.shaderKeywords = Array.Empty<string>(); EditorUtility.SetDirty(template); }
            template.color = Color.white;
            AssetDatabase.SaveAssets();
        }

        [MenuItem("Qingyun/Verify prototype")]
        public static void Verify()
        {
            Configure();
            Require(Shader.Find("Qingyun/InkSprite") != null, "Ink shader is missing");
            Require(!ShaderUtil.ShaderHasError(Shader.Find("Qingyun/InkSprite")), "Ink shader has compilation errors");
            Require(Resources.Load<Font>("Fonts/NotoSansSC-Regular") != null, "Chinese font is missing");
            var catalog = new GameCatalog();
            Require(((JObject)catalog.Json["routes"]).Count >= 72, "Incomplete migration route catalog");
            Require(Resources.Load<PanelSettings>("UI/GamePanel")?.themeStyleSheet != null, "UI Toolkit theme is missing");
            Require(Resources.Load<StyleSheet>("UI/Game") != null, "UI styles are missing");
            foreach (string name in new[] { "zone-qingyun", "avatar-m01", "portrait-qingyun-wolf", "portrait-qingyun-tiger-king", "portrait-spirit-ape" })
                Require(Resources.Load<Texture2D>("Art/" + name) != null, "Missing painted art: " + name);
            EditorSceneManager.OpenScene(Scene);
            Require(UnityEngine.Object.FindFirstObjectByType<Bootstrap>() != null, "Scene bootstrap is missing");
            var state = new ZoneState();
            var first = Frame(10,true);
            first["add"] = new JArray(Roster(1,"player"));
            first["add"][0]["art"] = "avatar/m03";
            first["ents"] = new JArray { new JArray(1,300,840,90,128,-1,-1) };
            Require(state.Apply(first), "Initial full frame rejected");
            Require(state.Actors[1].X == 0 && state.Actors[1].Z == -39, "Wire coordinates were not converted correctly");
            Require(state.Actors[1].Art == "avatar/m03", "Server portrait identity was lost");
            Require(!state.Apply(first) && state.Updated.Count == 0, "Duplicate frame replayed a pulse");
            var gap = Frame(12,false);
            Require(!state.Apply(gap) && state.NeedsSync && state.Sequence == 10, "Lost delta was silently accepted");
            var recovered = Frame(13,true);
            recovered["add"] = new JArray(Roster(1,"boss"));
            recovered["ents"] = new JArray { new JArray(1,300,120,100,8,-1,0) };
            Require(state.Apply(recovered) && !state.NeedsSync && state.Removed.Contains(1), "Full recovery failed to replace a recycled slot");
            var hit = Frame(14,false);
            hit["ents"] = new JArray { new JArray(1,300,120,80,1,-1,-1) };
            Require(state.Apply(hit) && state.Actors[1].Hp == 80, "Health delta was lost");
            var invalid = Frame(15,false);
            invalid["ents"] = new JArray { new JArray(1,300,99999,50,1,-1,-1) };
            bool rejected=false;
            try { state.Apply(invalid); } catch (FormatException) { rejected=true; }
            Require(rejected && state.Actors[1].Hp == 80 && state.Sequence == 14, "Invalid frame mutated accepted state");
            var removed = Frame(15,false); removed["remove"] = new JArray(1);
            Require(state.Apply(removed) && state.Actors.Count == 0, "Removed actor survived in the cache");
            state.Reset(); Require(state.Sequence == -1 && state.Actors.Count == 0, "Reconnect did not reset the cache");
            Directory.CreateDirectory(".local/verification");
            File.WriteAllText(".local/verification/unity.json", new JObject {
                ["passed"] = true, ["unity"] = Application.unityVersion,
                ["checks"] = "Scene, font, shader, coordinate mapping, duplicate pulses, gap recovery, slot reuse, health, invalid frame atomicity, remove, reset",
                ["at"] = DateTime.UtcNow.ToString("O") }.ToString());
            Debug.Log("QINGYUN VERIFY PASSED");
        }

        static JObject Roster(int slot,string kind) => new JObject { ["i"]=slot,["name"]="修士",["kind"]=kind,["stageIndex"]=4,["maxHp"]=100 };
        static JObject Frame(int seq,bool full) => new JObject { ["zoneId"]="map-qingyun-mountain",["seq"]=seq,["at"]=1000L+seq,
            ["full"]=full,["add"]=new JArray(),["remove"]=new JArray(),["ents"]=new JArray(),["events"]=new JArray(),
            ["boss"]=new JObject { ["alive"]=false,["nextAt"]=60000 } };
        static void Require(bool test,string message) { if (!test) throw new InvalidOperationException(message); }

        [MenuItem("Qingyun/Build macOS prototype")]
        public static void Mac() => Build(BuildTarget.StandaloneOSX,"Builds/macOS/Qingyun.app");
        [MenuItem("Qingyun/Build Web prototype")]
        public static void Web() => Build(BuildTarget.WebGL,"Builds/Web");
        static void Build(BuildTarget target,string location)
        {
            Verify();
            Directory.CreateDirectory(Path.GetDirectoryName(location));
            var result = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes=new[]{Scene},target=target,
                locationPathName=location,options=BuildOptions.Development });
            if (result.summary.result != BuildResult.Succeeded) throw new InvalidOperationException("Unity build failed: "+result.summary.result);
            Require(!ShaderUtil.ShaderHasError(Shader.Find("Qingyun/InkSprite")), "Player shader compilation failed");
            Debug.Log("QINGYUN BUILD SUCCEEDED: "+location);
        }
    }
}
