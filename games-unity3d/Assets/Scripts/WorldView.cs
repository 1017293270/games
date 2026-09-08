using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Qingyun
{
    /// <summary>Flat portrait orbs. The server owns movement, health and all combat outcomes.</summary>
    // Official visual comparison (2021-01-15 promotional composite, not current-version footage):
    // https://xian.leiting.com/news/17.html
    // https://xian.leiting.com/static/upload/editor/20210115/161069016436585503864082.jpg
    // Observed: circular player/beast portraits, rim/formation rings and cyan spell connections.
    // Project choices: muted colors, 4.4/3.8/6.5 orb diameters and subtle breathing timing.
    public sealed class WorldView : MonoBehaviour
    {
        sealed class Actor
        {
            public Transform root, body, sword, bar, fill;
            public SpriteRenderer image, aura, swordImage, targetRing;
            public SpriteRenderer[] motes;
            public LineRenderer spell;
            public Vector3 destination;
            public string kind, resource;
            public float height, phase, hp, flashUntil, castUntil, dodgeUntil;
            public int flags, target, slot;
            public bool flashing;
        }
        sealed class Cloud
        {
            public Transform transform;
            public Vector3 home;
            public float phase;
        }

        readonly Dictionary<int, Actor> actors = new Dictionary<int, Actor>();
        readonly Dictionary<string, Sprite> art = new Dictionary<string, Sprite>();
        readonly List<Sprite> createdSprites = new List<Sprite>();
        readonly List<Texture2D> createdTextures = new List<Texture2D>();
        readonly List<Cloud> clouds = new List<Cloud>();
        readonly Vector3[] arc = new Vector3[17];
        Transform sceneRoot, actorRoot;
        Camera viewCamera;
        SpriteRenderer mapBackground;
        GameCatalog catalog;
        bool visible = true;
        Material spriteMaterial, circleMaterial, bossCircleMaterial;
        MaterialPropertyBlock hitBlock;
        Sprite pixel, haze, halo, glow, blade, targetHalo;
        Vector3 focus = new Vector3(0,-31,0);
        Vector3 lastMouse;
        float zoom=22;
        int selfSlot=-1, focusSlot=-1, flashId;
        bool initialized, touchOrbit, mouseOrbit;
        public int ActorCount => actors.Count;
        /// <summary>Screen pixel coordinates with a bottom-left origin; return true over UI.</summary>
        public Func<Vector2, bool> PointerBlocked;

        public void Initialize()
        {
            if(initialized) return;
            // Unity native objects must be allocated here, never in field initializers.
            hitBlock=new MaterialPropertyBlock(); flashId=Shader.PropertyToID("_Flash");
            var shader=Shader.Find("Qingyun/InkSprite") ?? Shader.Find("Sprites/Default");
            if(shader==null) throw new InvalidOperationException("WorldView requires a built-in sprite shader");
            var template=Resources.Load<Material>("WorldTemplate");
            spriteMaterial=template!=null ? new Material(template) : new Material(shader);
            spriteMaterial.name="Shared ink sprite";
            if(!spriteMaterial.HasProperty("_Circle")) throw new InvalidOperationException("Qingyun/InkSprite with _Circle must be included for circular portraits");
            spriteMaterial.SetFloat("_Circle",0);
            circleMaterial=new Material(spriteMaterial) { name="Shared circular portrait" };
            circleMaterial.SetFloat("_Circle",1);
            bossCircleMaterial=new Material(circleMaterial) { name="Shared boss gold portrait" };
            bossCircleMaterial.SetColor("_BorderColor",new Color(.67f,.48f,.22f));
            sceneRoot=Group(transform,"Qingyun painted world",Vector3.zero);
            actorRoot=Group(sceneRoot,"Server actors",Vector3.zero);
            pixel=MakeSprite(Texture2D.whiteTexture,new Vector2(.5f,.5f));
            haze=ProceduralSprite("Soft cloud",256,128,0);
            halo=ProceduralSprite("Spirit ring",128,128,1);
            glow=ProceduralSprite("Soft light",64,64,2);
            blade=ProceduralSprite("Small spirit sword",32,128,3);
            targetHalo=ProceduralSprite("Four target brackets",128,128,4);
            var background=LoadArt("zone-qingyun",new Vector2(.5f,.5f));
            if(background!=null)
                mapBackground = Image(sceneRoot,"Painted Qingyun valley",background,Vector3.zero,new Vector2(60,90),Color.white,-1000);
            for(int i=0;i<9;i++)
            {
                Vector3 home=new Vector3((i%3-1)*21,-37+(i/3)*35,0);
                var cloud=Image(sceneRoot,"Drifting translucent mist",haze,home,new Vector2(29,11),new Color(.88f,.94f,.88f,i%2==0 ? .15f : .08f),i%2==0 ? -800 : 2400);
                clouds.Add(new Cloud { transform=cloud.transform,home=home,phase=i*1.731f });
            }
            var cameraObject=new GameObject("Qingyun orthographic camera",typeof(Camera),typeof(AudioListener));
            cameraObject.transform.SetParent(transform,false); cameraObject.tag="MainCamera";
            viewCamera=cameraObject.GetComponent<Camera>(); viewCamera.orthographic=true;
            viewCamera.nearClipPlane=.1f; viewCamera.farClipPlane=200;
            viewCamera.clearFlags=CameraClearFlags.SolidColor;
            viewCamera.backgroundColor=new Color(.9f,.92f,.85f);
            viewCamera.transparencySortMode=TransparencySortMode.CustomAxis;
            viewCamera.transparencySortAxis=Vector3.up;
            RenderSettings.fog=false;
            UpdateCamera(true);
            initialized=true;
        }

        public void SetVisible(bool value)
        {
            visible=value;
            if(sceneRoot!=null) sceneRoot.gameObject.SetActive(value);
        }

        public void SetZone(string id, GameCatalog source)
        {
            if(!initialized) Initialize();
            var zone=source.Find("zones",id);
            if(zone==null) throw new ArgumentException("未知秘境："+id);
            catalog=source;
            ClearActors();
            string artKey=id=="map-qingyun-mountain" ? "zone-qingyun" : "catalog:"+(string)zone["floorArt"];
            var sprite=LoadArt(artKey,new Vector2(.5f,.5f));
            if(sprite!=null && mapBackground!=null)
            {
                mapBackground.sprite=sprite;
                mapBackground.transform.localScale=new Vector3((float)zone["width"]/sprite.bounds.size.x,(float)zone["height"]/sprite.bounds.size.y,1);
            }
            focus=new Vector3((float)zone["entrance"]["x"]-30,45-(float)zone["entrance"]["y"],0);
            focusSlot=selfSlot=-1;
            UpdateCamera(true);
        }

        Transform Group(Transform parent,string name,Vector3 position)
        {
            var t=new GameObject(name).transform; t.SetParent(parent,false); t.localPosition=position; return t;
        }
        SpriteRenderer Image(Transform parent,string name,Sprite sprite,Vector3 position,Vector2 size,Color tint,int order)
        {
            var t=Group(parent,name,position); var renderer=t.gameObject.AddComponent<SpriteRenderer>();
            renderer.sprite=sprite; renderer.sharedMaterial=spriteMaterial; renderer.color=tint; renderer.sortingOrder=order;
            t.localScale=new Vector3(size.x/sprite.bounds.size.x,size.y/sprite.bounds.size.y,1);
            return renderer;
        }
        Sprite MakeSprite(Texture2D texture,Vector2 pivot)
        {
            var sprite=Sprite.Create(texture,new Rect(0,0,texture.width,texture.height),pivot,100,0,SpriteMeshType.FullRect);
            sprite.name=texture.name; createdSprites.Add(sprite); return sprite;
        }
        Sprite LoadArt(string name,Vector2 pivot)
        {
            if(art.TryGetValue(name,out var cached)) return cached;
            var texture=name.StartsWith("catalog:",StringComparison.Ordinal) ? catalog?.Art(name.Substring(8)) : Resources.Load<Texture2D>("Art/"+name);
            if(texture==null)
            {
                Debug.LogError("Missing painted-world art: Assets/Resources/Art/"+name+".png. Supply the art and restart Play mode; no 3D substitute is generated.");
                art[name]=null; return null;
            }
            var sprite=MakeSprite(texture,pivot); art[name]=sprite; return sprite;
        }

        Sprite ProceduralSprite(string name,int width,int height,int type)
        {
            var texture=new Texture2D(width,height,TextureFormat.RGBA32,false) { name=name,wrapMode=TextureWrapMode.Clamp,filterMode=FilterMode.Bilinear };
            var colors=new Color[width*height];
            for(int y=0;y<height;y++) for(int x=0;x<width;x++)
            {
                float u=(x+.5f)/width*2-1,v=(y+.5f)/height*2-1,r=Mathf.Sqrt(u*u+v*v);
                Color color=Color.white;
                if(type==0)
                {
                    float noise=Mathf.PerlinNoise(x*.027f+13,y*.029f+7)*.65f+Mathf.PerlinNoise(x*.071f,y*.068f)*.35f;
                    color.a=Mathf.Pow(Mathf.Clamp01(1-r),1.35f)*Mathf.SmoothStep(.1f,1,noise);
                }
                else if(type==1) color.a=Mathf.Exp(-Mathf.Pow((r-.8f)*35,2))*.8f+Mathf.Exp(-Mathf.Pow((r-.65f)*40,2))*.2f;
                else if(type==2) color.a=Mathf.Pow(Mathf.Clamp01(1-r),2.5f);
                else if(type==4)
                    color.a=Mathf.Exp(-Mathf.Pow((r-.8f)*48,2))*Mathf.SmoothStep(.35f,.65f,Mathf.Cos(Mathf.Atan2(v,u)*4));
                else
                {
                    bool edge=v>-.48f && v<.88f && Mathf.Abs(u)<.14f*Mathf.Clamp01((.88f-v)*4);
                    bool guard=v>-.55f && v<-.46f && Mathf.Abs(u)<.65f;
                    bool grip=v>-.88f && v<-.55f && Mathf.Abs(u)<.11f;
                    color=guard ? new Color(.77f,.61f,.28f) : grip ? new Color(.23f,.36f,.33f) : new Color(.7f,.86f,.83f);
                    color.a=edge||guard||grip ? 1 : 0;
                }
                colors[y*width+x]=color;
            }
            texture.SetPixels(colors); texture.Apply(false,true); createdTextures.Add(texture);
            return MakeSprite(texture,new Vector2(.5f,.5f));
        }

        public void Upsert(int slot,string actorName,string kind,int stageIndex,float x,float z,float hpRatio,bool isSelf,int flags,int targetSlot,string artId=null)
        {
            if(!initialized) Initialize();
            if(float.IsNaN(x)||float.IsInfinity(x)||float.IsNaN(z)||float.IsInfinity(z)) return;
            kind=kind??"player";
            if(actors.TryGetValue(slot,out var old)&&old.kind!=kind) Remove(slot);
            if(!actors.TryGetValue(slot,out var a))
            {
                a=BuildActor(slot,kind,actorName,isSelf,artId); actors.Add(slot,a);
                a.root.position=new Vector3(Mathf.Clamp(x,-30,30),Mathf.Clamp(z,-45,45),0);
            }
            string portrait=PortraitResource(kind,actorName,artId);
            if(a.resource!=portrait) SetPortrait(a,portrait);
            a.root.name=string.IsNullOrEmpty(actorName) ? kind+" "+slot : actorName;
            a.destination=new Vector3(Mathf.Clamp(x,-30,30),Mathf.Clamp(z,-45,45),0);
            a.hp=float.IsNaN(hpRatio) ? 0 : Mathf.Clamp01(hpRatio); a.target=targetSlot; a.flags=flags;
            // The controller calls once per accepted sequence; consecutive equal flags are distinct events.
            if((flags&3)!=0) a.flashUntil=Time.time+((flags&2)!=0 ? .32f : .18f);
            if((flags&4)!=0) a.dodgeUntil=Time.time+.3f;
            if((flags&8)!=0) a.castUntil=Time.time+.72f;
            if(isSelf&&selfSlot!=slot) { selfSlot=slot; focusSlot=slot; }
            a.fill.localScale=new Vector3(a.hp,1,1); a.fill.localPosition=new Vector3((a.hp-1)*.9f,0,0);
            a.aura.gameObject.SetActive(isSelf||kind=="boss"||(flags&32)!=0);
            a.aura.color=kind=="boss" ? new Color(.7f,.27f,.16f,.72f) : isSelf ? new Color(.51f,.64f,.4f,.68f) : new Color(.35f,.68f,.58f,.5f);
        }

        string PortraitResource(string kind,string actorName,string artId)
        {
            if(catalog!=null && artId!=null)
            {
                if(artId.StartsWith("avatar/",StringComparison.Ordinal)) return "catalog:"+artId;
                if(artId.StartsWith("sprite/",StringComparison.Ordinal))
                {
                    string suffix=artId.Substring(7);
                    var definition=catalog.Find("monsters","monster-"+suffix) ?? catalog.Find("monsters","boss-"+suffix);
                    string portrait=definition?.Value<string>("art");
                    if(portrait!=null) return "catalog:"+portrait;
                }
            }
            if(artId!=null&&artId.StartsWith("avatar/",StringComparison.Ordinal))
            {
                string id=artId.Substring(7);
                if(id.Length==3&&(id[0]=='m'||id[0]=='f')&&id[1]=='0'&&id[2]>='1'&&id[2]<='8') return "avatar-"+id;
            }
            if(artId=="sprite/qingyun-wolf") return "portrait-qingyun-wolf";
            if(artId=="sprite/spirit-ape") return "portrait-spirit-ape";
            if(artId=="sprite/qingyun-tiger-king") return "portrait-qingyun-tiger-king";
            if(kind=="boss") return "portrait-qingyun-tiger-king";
            if(kind=="monster") return actorName!=null&&actorName.Contains("猿") ? "portrait-spirit-ape" : "portrait-qingyun-wolf";
            return "avatar-m01";
        }
        void SetPortrait(Actor a,string resource)
        {
            var sprite=LoadArt(resource,new Vector2(.5f,.5f));
            if(sprite==null) sprite=LoadArt(PortraitResource(a.kind,null,null),new Vector2(.5f,.5f));
            if(sprite==null) sprite=pixel;
            a.resource=resource; a.image.sprite=sprite;
            a.image.transform.localScale=new Vector3(a.height/sprite.bounds.size.x,a.height/sprite.bounds.size.y,1);
        }
        Actor BuildActor(int slot,string kind,string actorName,bool self,string artId)
        {
            bool beast=kind=="monster"||kind=="boss";
            var a=new Actor { kind=kind,slot=slot,phase=slot*1.731f,height=kind=="boss" ? 6.5f : beast ? 3.8f : 4.4f };
            a.root=Group(actorRoot,"Actor "+slot,Vector3.zero);
            a.body=Group(a.root,"Breathing portrait orb",Vector3.zero);
            a.image=Image(a.body,"Circular portrait",pixel,Vector3.zero,new Vector2(a.height,a.height),Color.white,0);
            // Circle belongs to the shared material, so clearing a hit-flash block cannot expose a square.
            a.image.sharedMaterial=kind=="boss" ? bossCircleMaterial : circleMaterial;
            SetPortrait(a,PortraitResource(kind,actorName,artId));
            a.aura=Image(a.body,"Quiet protective seal",halo,Vector3.zero,Vector2.one*(a.height*1.36f),new Color(.7f,.58f,.31f,.5f),-1);
            a.aura.gameObject.SetActive(self||kind=="boss");
            a.targetRing=Image(a.body,"Current target brackets",targetHalo,Vector3.zero,Vector2.one*(a.height*1.54f),new Color(.76f,.3f,.16f,.9f),2);
            a.targetRing.gameObject.SetActive(false);
            if(!beast)
            {
                a.swordImage=Image(a.root,"Independent spirit sword",blade,new Vector3(a.height*.65f,0,0),new Vector2(.55f,1.8f),Color.white,1);
                a.sword=a.swordImage.transform;
            }
            a.bar=Group(a.root,"Health",new Vector3(0,a.height*.5f+.5f,0));
            Image(a.bar,"Health track",pixel,Vector3.zero,new Vector2(1.9f,.14f),new Color(.19f,.29f,.25f,.45f),2100);
            a.fill=Group(a.bar,"Server health fraction",Vector3.zero);
            Image(a.fill,"Jade health",pixel,Vector3.zero,new Vector2(1.8f,.08f),new Color(.4f,.62f,.47f,.9f),2101);
            var line=Group(a.root,"Server cast ink trace",Vector3.zero);
            a.spell=line.gameObject.AddComponent<LineRenderer>(); a.spell.sharedMaterial=spriteMaterial;
            a.spell.positionCount=arc.Length; a.spell.startWidth=.08f; a.spell.endWidth=.015f;
            a.spell.numCapVertices=3; a.spell.useWorldSpace=true; a.spell.sortingOrder=2200; a.spell.enabled=false;
            a.motes=new SpriteRenderer[5];
            for(int i=0;i<a.motes.Length;i++)
            {
                a.motes[i]=Image(a.root,"Cast ember",glow,Vector3.zero,new Vector2(.4f,.4f),new Color(.79f,.65f,.33f,.8f),2201);
                a.motes[i].enabled=false;
            }
            return a;
        }

        void Update()
        {
            if(!initialized || !visible) return;
            float now=Time.time,blend=1-Mathf.Exp(-12*Time.deltaTime);
            foreach(var cloud in clouds)
                cloud.transform.localPosition=cloud.home+new Vector3(Mathf.Sin(now*.035f+cloud.phase)*2.2f,Mathf.Cos(now*.027f+cloud.phase)*.65f,0);
            int selectedSlot=actors.TryGetValue(selfSlot,out var selfActor) ? selfActor.target : -1;
            foreach(var a in actors.Values)
            {
                Vector3 delta=a.destination-a.root.position;
                bool dead=(a.flags&16)!=0,offline=(a.flags&64)!=0;
                bool moving=!dead&&!offline&&(delta.sqrMagnitude>.015f||(a.flags&128)!=0);
                a.root.position=Vector3.Lerp(a.root.position,a.destination,blend);
                if(Mathf.Abs(delta.x)>.04f) a.image.flipX=delta.x<0;
                float breath=Mathf.Sin(now*1.7f+a.phase);
                float walk=moving ? Mathf.Sin(now*8+a.phase) : 0;
                a.body.localPosition=new Vector3(a.dodgeUntil>now ? Mathf.Sin((a.dodgeUntil-now)/.3f*Mathf.PI)*.75f : 0,dead ? 0 : .035f*breath+Mathf.Abs(walk)*.07f,0);
                float breathe=dead ? .95f : 1+breath*.007f;
                a.body.localScale=new Vector3(breathe,breathe,1);
                a.body.localRotation=Quaternion.Euler(0,0,dead ? 8 : walk*1.6f);
                var tint=a.image.color; tint.a=dead ? .3f : offline ? .5f : 1; a.image.color=tint;
                int order=1000-Mathf.RoundToInt(a.root.position.y*10);
                a.image.sortingOrder=order; a.aura.sortingOrder=order-2;
                a.targetRing.sortingOrder=order+2;
                a.targetRing.gameObject.SetActive(!dead&&a.slot==selectedSlot&&a.slot!=selfSlot);
                float ringSize=a.height*1.36f*(1+breath*.014f);
                a.aura.transform.localScale=new Vector3(ringSize/halo.bounds.size.x,ringSize/halo.bounds.size.y,1);
                a.aura.transform.localRotation=Quaternion.Euler(0,0,Mathf.Sin(now*.2f+a.phase)*3);
                if(a.sword!=null)
                {
                    a.sword.localPosition=new Vector3(Mathf.Cos(now*.55f+a.phase)*a.height*.7f,Mathf.Sin(now*.55f+a.phase)*a.height*.65f,0);
                    a.sword.localRotation=Quaternion.Euler(0,0,-18+Mathf.Sin(now*.55f+a.phase)*12);
                    a.swordImage.sortingOrder=order+1;
                    a.sword.gameObject.SetActive(!dead);
                }
                if(a.flashUntil>now)
                {
                    hitBlock.SetFloat(flashId,Mathf.Clamp01((a.flashUntil-now)*5));
                    a.image.SetPropertyBlock(hitBlock); a.flashing=true;
                }
                else if(a.flashing) { a.image.SetPropertyBlock(null); a.flashing=false; }
                a.bar.gameObject.SetActive(!dead&&a.hp<.999f);
                bool casting=!dead&&a.castUntil>now; a.spell.enabled=casting;
                for(int i=0;i<a.motes.Length;i++) a.motes[i].enabled=casting;
                if(!casting) continue;
                bool hasVictim=actors.TryGetValue(a.target,out var victim);
                Vector3 center=a.root.position;
                Vector3 aim=hasVictim ? victim.root.position : center+Vector3.right*(a.image.flipX ? -8 : 8);
                Vector3 direction=(aim-center).sqrMagnitude>.001f ? (aim-center).normalized : Vector3.up;
                float gap=Vector3.Distance(center,aim);
                Vector3 start=center+direction*Mathf.Min(a.height*.5f,gap*.45f);
                Vector3 end=aim-direction*(hasVictim ? Mathf.Min(victim.height*.5f,gap*.45f) : 0);
                float fade=Mathf.Clamp01((a.castUntil-now)*3);
                a.spell.startColor=new Color(.26f,.66f,.59f,fade*.75f); a.spell.endColor=new Color(.63f,.8f,.68f,fade*.7f);
                for(int i=0;i<arc.Length;i++) arc[i]=SpellPoint(start,end,i/(float)(arc.Length-1));
                a.spell.SetPositions(arc);
                for(int i=0;i<a.motes.Length;i++)
                {
                    float t=Mathf.Repeat((now-(a.castUntil-.72f))*1.45f+i*.12f,1);
                    a.motes[i].transform.position=SpellPoint(start,end,t)+new Vector3(0,Mathf.Sin(t*14+i)*.15f,0);
                    a.motes[i].color=new Color(.79f,.65f,.33f,fade*.75f);
                }
            }
        }
        static Vector3 SpellPoint(Vector3 start,Vector3 end,float t) => Vector3.Lerp(start,end,t)+Vector3.up*Mathf.Sin(t*Mathf.PI)*1.2f;
        void LateUpdate() { if(initialized && visible) UpdateCamera(false); }
        bool CanStartOrbit(Vector2 position) => GUIUtility.hotControl==0&&!(PointerBlocked?.Invoke(position)??false);
        void Pan(Vector2 pixels)
        {
            focusSlot=-1;
            focus-=new Vector3(pixels.x,pixels.y,0)*(zoom*2/Mathf.Max(1,Screen.height));
        }
        void UpdateCamera(bool immediate)
        {
            if(Input.touchCount>0)
            {
                var touch=Input.GetTouch(0);
                if(touch.phase==TouchPhase.Began) touchOrbit=CanStartOrbit(touch.position);
                if(touchOrbit&&Input.touchCount==1&&touch.phase==TouchPhase.Moved) Pan(touch.deltaPosition);
                if(touchOrbit&&Input.touchCount==2)
                {
                    var second=Input.GetTouch(1);
                    float previous=(touch.position-touch.deltaPosition-(second.position-second.deltaPosition)).magnitude;
                    zoom-=(Vector2.Distance(touch.position,second.position)-previous)*.035f;
                }
            }
            else
            {
                touchOrbit=false;
                if(Input.GetMouseButtonDown(1)) { mouseOrbit=CanStartOrbit(Input.mousePosition); lastMouse=Input.mousePosition; }
                if(!Input.GetMouseButton(1)) mouseOrbit=false;
                if(mouseOrbit) { Pan(Input.mousePosition-lastMouse); lastMouse=Input.mousePosition; }
                if(CanStartOrbit(Input.mousePosition)) zoom-=Input.mouseScrollDelta.y*1.5f;
            }
            zoom=Mathf.Clamp(zoom,12,45);
            if(actors.TryGetValue(focusSlot,out var followed))
            {
                Vector3 target=followed.root.position+Vector3.up*3;
                focus=immediate ? target : Vector3.Lerp(focus,target,1-Mathf.Exp(-5*Time.deltaTime));
            }
            float halfWidth=zoom*viewCamera.aspect;
            focus.x=Mathf.Clamp(focus.x,-Mathf.Max(0,30-halfWidth),Mathf.Max(0,30-halfWidth));
            focus.y=Mathf.Clamp(focus.y,-Mathf.Max(0,45-zoom),Mathf.Max(0,45-zoom));
            viewCamera.orthographicSize=zoom;
            viewCamera.transform.position=new Vector3(focus.x,focus.y,-100);
            viewCamera.transform.rotation=Quaternion.identity;
        }
        public void FocusSelf() { focusSlot=selfSlot; if(selfSlot<0) focus=new Vector3(0,-31,0); }
        public void FocusBoss()
        {
            foreach(var pair in actors) if(pair.Value.kind=="boss") { focusSlot=pair.Key; return; }
            focusSlot=-1; focus=new Vector3(0,32,0);
        }
        public void Remove(int slot)
        {
            if(!actors.TryGetValue(slot,out var a)) return;
            Destroy(a.root.gameObject); actors.Remove(slot);
            if(selfSlot==slot) selfSlot=-1;
            if(focusSlot==slot) focusSlot=-1;
        }
        public void ClearActors()
        {
            foreach(var a in actors.Values) Destroy(a.root.gameObject);
            actors.Clear(); selfSlot=focusSlot=-1;
        }
#if UNITY_EDITOR
        [ContextMenu("Run WorldView presentation check")]
        public void RunPresentationCheck()
        {
            if(!Application.isPlaying) throw new InvalidOperationException("Run this check in Play mode");
            Initialize(); const int testSlot=int.MinValue;
            if(actors.ContainsKey(testSlot)) throw new InvalidOperationException("Check slot is occupied");
            int before=ActorCount;
            try
            {
                Upsert(testSlot,"Presentation check","player",0,float.NaN,0,1,false,0,-1);
                if(ActorCount!=before) throw new InvalidOperationException("Invalid coordinates accepted");
                Upsert(testSlot,"Presentation check","player",0,999,-999,2,false,8,-1);
                var a=actors[testSlot];
                if(a.destination!=new Vector3(30,-45,0)||a.hp!=1) throw new InvalidOperationException("Flat coordinate/health bounds failed");
                a.castUntil=0; Upsert(testSlot,"Presentation check","player",0,0,0,.5f,false,8,-1);
                if(a.castUntil<=Time.time) throw new InvalidOperationException("Consecutive cast pulse lost");
                if(!viewCamera.orthographic) throw new InvalidOperationException("World camera must be orthographic");
                if(a.image.sharedMaterial.GetFloat("_Circle")!=1) throw new InvalidOperationException("Portrait must remain circular");
                if(PortraitResource("player",null,"avatar/f08")!="avatar-f08"||PortraitResource("monster",null,"sprite/spirit-ape")!="portrait-spirit-ape")
                    throw new InvalidOperationException("Roster portrait mapping failed");
            }
            finally { Remove(testSlot); }
            if(ActorCount!=before) throw new InvalidOperationException("Actor removal failed");
            Debug.Log("WorldView presentation check passed: flat coordinates, bounds, repeated events, orthographic view, removal.");
        }
#endif
        void OnDestroy()
        {
            if(sceneRoot!=null) Destroy(sceneRoot.gameObject);
            if(spriteMaterial!=null) Destroy(spriteMaterial);
            if(circleMaterial!=null) Destroy(circleMaterial);
            if(bossCircleMaterial!=null) Destroy(bossCircleMaterial);
            foreach(var sprite in createdSprites) if(sprite!=null) Destroy(sprite);
            foreach(var texture in createdTextures) if(texture!=null) Destroy(texture);
        }
    }
}
