Shader "Qingyun/InkSprite"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite Texture", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)
        _Circle ("Circular portrait", Range(0,1)) = 0
        _BorderColor ("Portrait ink rim", Color) = (0.19,0.27,0.24,1)
        [PerRendererData] _Flash ("Hit flash", Range(0,1)) = 0
        [MaterialToggle] PixelSnap ("Pixel snap", Float) = 0
        [HideInInspector] _RendererColor ("RendererColor", Color) = (1,1,1,1)
        [HideInInspector] _Flip ("Flip", Vector) = (1,1,1,1)
        [PerRendererData] _AlphaTex ("External Alpha", 2D) = "white" {}
        [PerRendererData] _EnableExternalAlpha ("Enable External Alpha", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" "PreviewType"="Plane" "CanUseSpriteAtlas"="True" }
        Cull Off Lighting Off ZWrite Off
        Blend One OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex SpriteVert
            #pragma fragment InkFrag
            #pragma target 2.0
            #pragma multi_compile _ PIXELSNAP_ON
            #pragma multi_compile _ ETC1_EXTERNAL_ALPHA
            #include "UnitySprites.cginc"
            float _Flash, _Circle;
            fixed4 _BorderColor;
            fixed4 InkFrag(v2f IN) : SV_Target
            {
                fixed4 texel = SampleSpriteTexture(IN.texcoord);
                fixed4 color = texel * IN.color;
                // Sprite.Create uses the whole square texture; no CPU-readable pixels are needed.
                float2 centeredUv = IN.texcoord * 2 - 1;
                float radius = length(centeredUv);
                fixed3 paper = fixed3(0.92,0.94,0.87);
                fixed3 portrait = lerp(paper,texel.rgb,texel.a) * IN.color.rgb;
                float rim = smoothstep(0.93,0.96,radius);
                portrait = lerp(portrait,_BorderColor.rgb,rim);
                float highlight = (1-smoothstep(0.008,0.032,abs(radius-0.905))) * saturate(centeredUv.y) * 0.26;
                portrait = lerp(portrait,fixed3(1,0.99,0.88),highlight);
                color.rgb = lerp(color.rgb,portrait,_Circle);
                color.a = lerp(color.a,(1-smoothstep(0.98,1.0,radius))*IN.color.a,_Circle);
                color.rgb = lerp(color.rgb, fixed3(1,1,1), _Flash);
                color.rgb *= color.a;
                return color;
            }
            ENDCG
        }
    }
}
