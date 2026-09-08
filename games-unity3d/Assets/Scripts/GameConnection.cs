using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Qingyun
{
    // ponytail: text packets in the default namespace only; use a full Socket.IO
    // client if binary attachments, acknowledgements or other namespaces are added.
    public sealed class GameConnection : MonoBehaviour
    {
        public event Action<string, JToken> EventReceived;
        public event Action<string> Error;
        public event Action<bool> ConnectionChanged;
        public bool Connected { get; private set; }

        private sealed class Session
        {
            public int Generation;
            public string Url;
            public string Failure;
            public bool Terminal;
            public float HeartbeatSeconds = 45;
            public double Deadline;
            public double ConnectDeadline;
            public readonly Queue<string> Outbox = new Queue<string>();
            public UnityWebRequest Get;
            public UnityWebRequest Post;

            public void Abort()
            {
                Get?.Abort();
                Post?.Abort();
                Outbox.Clear();
            }
        }

        private int generation;
        private Session session;

        public void Connect(string baseUrl, string token)
        {
            Disconnect();
            if (!TryBaseUrl(baseUrl, out string url) || string.IsNullOrWhiteSpace(token))
            {
                Error?.Invoke("服务器地址或登录凭证无效");
                return;
            }
            StartCoroutine(Run(url, token, generation));
        }

        public void Emit(string eventName, object payload)
        {
            if (!Connected || session == null || !Alive(session))
            {
                Error?.Invoke("连接尚未就绪");
                return;
            }
            if (string.IsNullOrWhiteSpace(eventName)) return;
            string packet;
            try
            {
                var args = new JArray(eventName);
                if (payload != null) args.Add(JToken.FromObject(payload));
                packet = "42" + args.ToString(Formatting.None);
            }
            catch (Exception)
            {
                Error?.Invoke("事件参数无法编码");
                return;
            }
            if (session.Outbox.Count >= 128)
            {
                Fail(session, "发送队列已满，正在重新连接");
                return;
            }
            session.Outbox.Enqueue(packet);
        }

        public void Disconnect()
        {
            generation++;
            session?.Abort();
            session = null;
            SetConnected(false);
        }

        private void OnDisable() => Disconnect();

        private bool Alive(Session s) => s.Generation == generation && s.Failure == null;

        private void SetConnected(bool value)
        {
            if (Connected == value) return;
            Connected = value;
            ConnectionChanged?.Invoke(value);
        }

        private static bool TryBaseUrl(string raw, out string result)
        {
            result = null;
            if (!Uri.TryCreate(raw, UriKind.Absolute, out Uri uri) ||
                (uri.Scheme != "http" && uri.Scheme != "https") ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment)) return false;
            result = uri.AbsoluteUri.TrimEnd('/');
            return true;
        }

        private static UnityWebRequest Request(string url, string method, string body, int timeout)
        {
            var request = new UnityWebRequest(url, method);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = timeout;
            if (body != null)
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                request.SetRequestHeader("Content-Type", "text/plain;charset=UTF-8");
            }
            return request;
        }

        private IEnumerator Run(string baseUrl, string token, int version)
        {
            int retries = 0;
            while (version == generation)
            {
                var s = new Session { Generation = version };
                session = s;
                string endpoint = baseUrl + "/socket.io/?EIO=4&transport=polling";
                using (var request = Request(endpoint, "GET", null, 15))
                {
                    s.Get = request;
                    yield return request.SendWebRequest();
                    s.Get = null;
                    if (version != generation) yield break;
                    if (request.result != UnityWebRequest.Result.Success)
                        Fail(s, "实时连接握手失败（HTTP " + request.responseCode + "）");
                    else
                    {
                        try
                        {
                            string raw = request.downloadHandler.text;
                            if (string.IsNullOrEmpty(raw) || raw[0] != '0')
                                throw new FormatException();
                            var handshake = JObject.Parse(raw.Substring(1));
                            string sid = handshake.Value<string>("sid");
                            int interval = handshake.Value<int>("pingInterval");
                            int timeout = handshake.Value<int>("pingTimeout");
                            if (string.IsNullOrEmpty(sid) || interval <= 0 || timeout <= 0)
                                throw new FormatException();
                            s.HeartbeatSeconds = (interval / 1000f) + (timeout / 1000f);
                            s.Deadline = Time.realtimeSinceStartupAsDouble + s.HeartbeatSeconds;
                            s.ConnectDeadline = Time.realtimeSinceStartupAsDouble + 15;
                            s.Url = endpoint + "&sid=" + Uri.EscapeDataString(sid);
                            s.Outbox.Enqueue("40" + new JObject { ["token"] = token }.ToString(Formatting.None));
                        }
                        catch (Exception)
                        {
                            Fail(s, "服务器返回了无效的实时握手");
                        }
                    }
                }
                if (Alive(s))
                {
                    StartCoroutine(Send(s));
                    yield return Poll(s);
                }
                s.Abort();
                if (version != generation) yield break;
                bool wasConnected = Connected;
                SetConnected(false);
                // A connection callback can start a different connection.
                if (version != generation) yield break;
                if (s.Failure != null) Error?.Invoke(s.Failure);
                if (version != generation || s.Terminal) yield break;
                retries = wasConnected ? 0 : Math.Min(retries + 1, 4);
                double until = Time.realtimeSinceStartupAsDouble + Math.Min(8, Math.Pow(2, retries));
                while (version == generation && Time.realtimeSinceStartupAsDouble < until)
                    yield return null;
            }
        }

        private IEnumerator Send(Session s)
        {
            while (Alive(s))
            {
                if (s.Outbox.Count == 0) { yield return null; continue; }
                using (var request = Request(s.Url, "POST", s.Outbox.Dequeue(), 15))
                {
                    s.Post = request;
                    yield return request.SendWebRequest();
                    s.Post = null;
                    if (!Alive(s)) yield break;
                    if (request.result != UnityWebRequest.Result.Success || request.downloadHandler.text != "ok")
                        Fail(s, "实时消息发送失败（HTTP " + request.responseCode + "）");
                }
            }
        }

        private IEnumerator Poll(Session s)
        {
            while (Alive(s))
            {
                using (var request = Request(s.Url, "GET", null, Mathf.CeilToInt(s.HeartbeatSeconds) + 5))
                {
                    s.Get = request;
                    var operation = request.SendWebRequest();
                    while (!operation.isDone && Alive(s))
                    {
                        double now = Time.realtimeSinceStartupAsDouble;
                        if (now > s.Deadline || (!Connected && now > s.ConnectDeadline))
                            Fail(s, "实时连接超时，正在重新连接");
                        yield return null;
                    }
                    if (!Alive(s)) { request.Abort(); s.Get = null; yield break; }
                    s.Get = null;
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        Fail(s, "实时接收中断（HTTP " + request.responseCode + "）");
                        yield break;
                    }
                    foreach (string packet in request.downloadHandler.text.Split('\u001e'))
                    {
                        if (!Alive(s)) break;
                        Receive(s, packet);
                    }
                }
            }
        }

        private void Receive(Session s, string packet)
        {
            if (packet == "2")
            {
                s.Deadline = Time.realtimeSinceStartupAsDouble + s.HeartbeatSeconds;
                s.Outbox.Enqueue("3");
                return;
            }
            if (packet == "6") return;
            if (packet == "1") { Fail(s, "服务器关闭了传输连接"); return; }
            if (packet.StartsWith("41", StringComparison.Ordinal))
            {
                Fail(s, "服务器已断开会话，请重新登录", true);
                return;
            }
            if (packet.StartsWith("44", StringComparison.Ordinal))
            {
                Fail(s, "实时登录被拒绝，请确认账号已创建角色且登录未过期", true);
                return;
            }
            JToken data;
            try
            {
                if (packet.StartsWith("40", StringComparison.Ordinal))
                {
                    var ack = JObject.Parse(packet.Substring(2));
                    if (string.IsNullOrEmpty(ack.Value<string>("sid"))) throw new FormatException();
                    data = ack;
                }
                else if (packet.StartsWith("42", StringComparison.Ordinal))
                {
                    var args = JArray.Parse(packet.Substring(2));
                    if (args.Count == 0 || args[0].Type != JTokenType.String) throw new FormatException();
                    data = args;
                }
                else throw new FormatException();
            }
            catch (Exception)
            {
                Fail(s, "收到了不支持或损坏的实时数据");
                return;
            }
            if (data is JObject) SetConnected(true);
            else if (Connected)
            {
                var args = (JArray)data;
                EventReceived?.Invoke(args[0].Value<string>(), args.Count > 1 ? args[1] : JValue.CreateNull());
            }
        }

        private static void Fail(Session s, string message, bool terminal = false)
        {
            if (s.Failure != null) return;
            s.Failure = message;
            s.Terminal = terminal;
            s.Abort();
        }

        public IEnumerator Rest(string baseUrl, string method, string path, JObject body,
            string token, Action<JObject> onSuccess, Action<string> onError, Action<string, string> onDetailedError = null)
        {
            method = method?.ToUpperInvariant();
            if (!TryBaseUrl(baseUrl, out string url) || string.IsNullOrEmpty(path) ||
                !path.StartsWith("/api/", StringComparison.Ordinal) ||
                (method != "GET" && method != "POST" && method != "PUT" && method != "DELETE"))
            {
                if (onDetailedError != null) onDetailedError("INVALID_REQUEST", "HTTP 请求参数无效");
                else onError?.Invoke("HTTP 请求参数无效");
                yield break;
            }
            using (var request = Request(url + path, method,
                method == "GET" ? null : (body ?? new JObject()).ToString(Formatting.None), 20))
            {
                request.SetRequestHeader("Accept", "application/json");
                if (method != "GET") request.SetRequestHeader("Content-Type", "application/json");
                if (!string.IsNullOrEmpty(token)) request.SetRequestHeader("Authorization", "Bearer " + token);
                yield return request.SendWebRequest();
                JObject data = null;
                string failure = null;
                string failureCode = "NETWORK_ERROR";
                try
                {
                    var envelope = JObject.Parse(request.downloadHandler.text);
                    if (request.result != UnityWebRequest.Result.Success || envelope.Value<bool?>("ok") != true)
                    {
                        failureCode = envelope["error"]?["code"]?.Value<string>() ?? "NETWORK_ERROR";
                        failure = envelope["error"]?["message"]?.Value<string>() ??
                            ("HTTP 请求失败（" + request.responseCode + "）");
                    }
                    else if (!(envelope["data"] is JObject payload))
                        failure = "服务器响应缺少数据对象";
                    else data = payload;
                }
                catch (Exception)
                {
                    failure = request.result != UnityWebRequest.Result.Success
                        ? "无法连接服务器（HTTP " + request.responseCode + "）"
                        : "服务器返回了无效 JSON";
                }
                if (failure != null)
                {
                    if (onDetailedError != null) onDetailedError(failureCode, failure);
                    else onError?.Invoke(failure);
                }
                else onSuccess?.Invoke(data);
            }
        }

#if UNITY_EDITOR
        [ContextMenu("Verify packet encoding")]
        private void VerifyPacketEncoding()
        {
            var args = new JArray("zone:enter", new JObject { ["zoneId"] = "map-qingyun-mountain" });
            string encoded = "42" + args.ToString(Formatting.None);
            Debug.Assert(encoded == "42[\"zone:enter\",{\"zoneId\":\"map-qingyun-mountain\"}]");
            Debug.Assert((encoded + "\u001e2").Split('\u001e').Length == 2);
            Debug.Assert(TryBaseUrl("http://127.0.0.1:3010/", out string url) && url == "http://127.0.0.1:3010");
            Debug.Assert(!TryBaseUrl("file:///tmp/game", out _));
            Debug.Log("GameConnection packet checks passed");
        }
#endif
    }
}
