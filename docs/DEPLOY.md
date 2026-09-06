# 部署手册

> 目标：在一台你自己的 Linux 服务器上把这个游戏跑起来，你和朋友用手机或电脑
> 打开一个网址就能一起玩。
>
> **这篇假设你完全没用过 Docker。** 每一步都能照抄。全程大约二十分钟，
> 其中十五分钟在等下载。

需要准备的东西只有两样：

1. 一台 Linux 云服务器（阿里云 / 腾讯云 / 搬瓦工 / Hetzner 都行）。
   **跑起来** 1 核 1G 绰绰有余——数据库就是一个 SQLite 文件，
   两百个机器人修士每三十秒算一轮，实测二十来毫秒。
   但**第一次现场编译**比较吃内存，1G 的机器建议先加 1G swap：
   ```bash
   fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
2. 一个域名，能改它的 DNS 解析。

没有域名也能玩，只是装不了「添加到主屏幕」，见文末
[没有域名怎么办](#没有域名怎么办)。

---

## 目录

- [一、一分钟看懂这套东西长什么样](#一一分钟看懂这套东西长什么样)
- [二、把域名指到服务器](#二把域名指到服务器)
- [三、在服务器上装 Docker](#三在服务器上装-docker)
- [四、放行 80 和 443 端口](#四放行-80-和-443-端口)
- [五、把代码放上服务器](#五把代码放上服务器)
- [六、填 .env](#六填-env)
- [七、启动](#七启动)
- [八、开张：注册第一个号](#八开张注册第一个号)
- [九、安卓手机：装到桌面上](#九安卓手机装到桌面上)
- [十、日常维护](#十日常维护)
  - [看日志](#看日志)
  - [更新到新版本](#更新到新版本)
  - [备份存档](#备份存档)
  - [恢复存档](#恢复存档)
  - [停机与重启](#停机与重启)
- [十一、常见问题](#十一常见问题)
- [没有域名怎么办](#没有域名怎么办)

---

## 一、一分钟看懂这套东西长什么样

启动之后，服务器上会跑两个容器：

```
        公网
          │  https://你的域名
          ▼
   ┌─────────────┐   80 / 443
   │    caddy    │   自动申请 HTTPS 证书，自动续期
   └──────┬──────┘
          │  内部网络，不对外
          ▼
   ┌─────────────┐   3000
   │    game     │   游戏服务端 + 前端页面 + Socket.IO
   └──────┬──────┘
          │
          ▼
     /data/game.db      SQLite 存档，放在 docker 卷里
```

- **caddy** 是门房。它负责 HTTPS：第一次启动时自己去 Let's Encrypt
  申请证书，之后每两个月自动续期，你一次都不用管。
- **game** 是游戏本体。前端页面也由它发出去，所以不需要额外的 nginx。
- 存档是 `/data/game.db` 这一个文件（外加 WAL 的两个附属文件）。
  它存在一个叫 `xianxia_game-data` 的 docker 卷里，**删容器不会删它**，
  更新版本也不会动它。

---

## 二、把域名指到服务器

先做这一步，因为 DNS 生效要几分钟到几十分钟，早点做完就不用干等。

去你买域名的地方（阿里云、Cloudflare、Namecheap……）加一条 **A 记录**：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `xianxia`（或 `@` 表示裸域名） | 你服务器的公网 IP |

用 `xianxia` 的话，最终地址就是 `xianxia.你的域名.com`。

> **用 Cloudflare 的注意**：那个橙色云朵先关掉（改成「仅 DNS / DNS only」）。
> 开着代理的话，Caddy 申请证书时拿到的是 Cloudflare 的 IP，会一直申请失败。
> 等游戏跑起来了再决定要不要开回去。

在自己电脑上验证一下解析生效了：

```bash
ping xianxia.你的域名.com
```

回显里的 IP 是你服务器的 IP，就对了。

---

## 三、在服务器上装 Docker

用 SSH 登上服务器（Windows 用户可以用 PowerShell 里的 `ssh`）：

```bash
ssh root@你服务器的IP
```

装 Docker，官方脚本一条命令：

```bash
curl -fsSL https://get.docker.com | sh
```

装完验证：

```bash
docker --version
docker compose version
```

两条都能打印版本号就成了。需要 **Docker Engine 24 以上**，
官方脚本装的一定够新。

> 如果你不是用 root 登录的，后面所有 `docker` 命令前面都要加 `sudo`，
> 或者执行 `sudo usermod -aG docker $USER` 然后重新登录一次。

---

## 四、放行 80 和 443 端口

两个地方都要放行，少一个都不行：

**1. 云服务商的安全组 / 防火墙**（在网页控制台里）

阿里云叫「安全组规则」，腾讯云叫「防火墙」，AWS 叫「Security Group」。
加入站规则：

| 协议 | 端口 | 来源 |
|---|---|---|
| TCP | 80 | 0.0.0.0/0 |
| TCP | 443 | 0.0.0.0/0 |
| UDP | 443 | 0.0.0.0/0（可选，HTTP/3 用，不开也能玩） |

**2. 服务器自己的防火墙**

Ubuntu / Debian：

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
```

CentOS / Rocky：

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

**80 端口是必须的**：Let's Encrypt 就是通过 80 端口来验证「这个域名确实是你的」。
关了 80 就申请不到证书。

---

## 五、把代码放上服务器

如果代码在 Git 仓库里：

```bash
cd /opt
git clone <你的仓库地址> xianxia
cd xianxia
```

如果只是本地一个目录，在**你自己的电脑上**执行：

```bash
rsync -av --exclude node_modules --exclude dist \
  ./ root@你服务器的IP:/opt/xianxia/
```

然后到服务器上 `cd /opt/xianxia`。

---

## 六、填 .env

```bash
cd /opt/xianxia/deploy
cp .env.example .env
nano .env
```

（`nano` 里改完按 `Ctrl+O`、回车保存，`Ctrl+X` 退出。）

**必须改的三项：**

```ini
# 你的域名，和第二步里加的 A 记录一致
DOMAIN=xianxia.你的域名.com

# 后台密码。换成一串你自己的长密码，别用示例。
# 后台地址是 https://你的域名/admin
ADMIN_PASSWORD=换成一串很长的随机密码

# 邀请码。发给朋友，他们注册时填这个。
INVITE_CODE=qingyun
```

想要一串随机密码的话：

```bash
openssl rand -base64 24
```

其余的项都有合理默认值，看不懂就别动。

> **关于邀请码**：世界设置默认「注册必须填邀请码」，这是为了不让陌生人涌进来。
> `INVITE_CODE` 会在**第一次启动**时写进数据库，是一张可以无限次使用的邀请码。
> 之后想改、想发一次性的、想关掉邀请制，都去后台里操作。

---

## 七、启动

```bash
cd /opt/xianxia/deploy
docker compose up -d
```

第一次要现场编译，大约 3-10 分钟（取决于服务器性能）。屏幕会滚一大堆日志，
最后看到两行 `Started` 就成了。

看看两个容器都活着：

```bash
docker compose ps
```

期望看到 `game` 和 `caddy` 两行，状态是 `Up`（game 还会显示 `healthy`）。

证书申请要几秒到半分钟。看一眼 Caddy 的日志确认：

```bash
docker compose logs caddy | tail -20
```

出现 `certificate obtained successfully` 就说明 HTTPS 好了。

现在用浏览器打开 **https://你的域名** ——应该能看到登录页。

---

## 八、开张：注册第一个号

1. 打开 `https://你的域名`
2. 点「注册」
3. 道号（账号名）填 3-20 位字母数字，密钥填 6 位以上
4. **邀请码填你在 `.env` 里写的 `INVITE_CODE`**
5. 录名入册 → 测灵根 → 入山门

把网址和邀请码发给朋友，他们照样注册就能一起玩了。

后台在 `https://你的域名/admin`，用 `.env` 里的 `ADMIN_USERNAME` 和
`ADMIN_PASSWORD` 登录。能调修炼倍率、掉落倍率、机器人数量，能发邀请码、
封号、查在线。

---

## 九、安卓手机：装到桌面上

这个游戏是 PWA——装到桌面之后没有浏览器地址栏，和原生 App 看起来一样，
还能离线打开壳子。**前提是 HTTPS**，所以第二步的域名不能省。

**安卓 Chrome：**

1. 用 Chrome 打开 `https://你的域名`
2. 等两三秒，底部通常会自己弹出「添加到主屏幕」的横幅 —— 点它
3. 没弹的话：右上角 `⋮` → **「添加到主屏幕」**（有的版本叫「安装应用」）
4. 确认 → 桌面上出现图标

**iPhone Safari：**

1. Safari 打开 `https://你的域名`
2. 底部中间的分享按钮 → **「添加到主屏幕」**

装完之后：

- 竖屏全屏，没有地址栏
- 后台挂着也在涨修为（修为是服务端按时间算的，关掉 App 照样涨，
  下次打开会弹「闭关归来」结算）
- 更新版本后再打开会自动拉最新的（Service Worker 是 `autoUpdate` 模式），
  偶尔要多开一次才生效

> **弹不出「添加到主屏幕」？** 九成是因为你在用 `http://` 而不是 `https://`。
> 浏览器只给 HTTPS 站点这个待遇。

---

## 十、日常维护

以下命令都在 `/opt/xianxia/deploy` 目录里执行。

### 看日志

```bash
# 游戏服务端最近 100 行
docker compose logs --tail=100 game

# 实时跟着看（Ctrl+C 退出）
docker compose logs -f game

# 门房（证书、访问记录）
docker compose logs --tail=100 caddy
```

服务端启动时会打印数据库路径、机器人配置、已实现的接口数量，
排查问题先看这几行。

### 更新到新版本

```bash
cd /opt/xianxia
git pull
cd deploy
docker compose up -d --build
```

`--build` 会重新编译镜像，`up -d` 只重建变了的容器。
**存档不受影响**——它在独立的 docker 卷里，跟容器没关系。

数据库迁移是自动的：服务端启动时会把 `dist/db/migrations/` 下还没执行过的
`.sql` 按编号跑一遍，跑失败会回滚并且拒绝启动，不会留下半吊子状态。

顺手清掉旧镜像省点磁盘：

```bash
docker image prune -f
```

### 备份存档

**这一步请设个定时任务，别等出事才想起来。**

数据库开着 WAL，不能直接 `cp`（会拷到一半的状态）。用 SQLite 自己的热备份命令
——镜像里已经装好 `sqlite3` 了：

```bash
cd /opt/xianxia/deploy

# 在容器内做一份一致性快照
docker compose exec -T game \
  sqlite3 /data/game.db ".backup /data/backup-$(date +%F).db"

# 拷到宿主机
docker compose cp game:/data/backup-$(date +%F).db ./backup-$(date +%F).db
```

每天凌晨四点自动备份，并且只保留最近 14 份：

```bash
crontab -e
```

加上这一行（注意 `%` 在 crontab 里要转义成 `\%`）：

```cron
0 4 * * * cd /opt/xianxia/deploy && D=$(date +\%F) && docker compose exec -T game sqlite3 /data/game.db ".backup /data/backup-$D.db" && docker compose cp game:/data/backup-$D.db /opt/xianxia/backups/game-$D.db && docker compose exec -T game rm -f /data/backup-$D.db && find /opt/xianxia/backups -name 'game-*.db' -mtime +14 -delete
```

先把目录建出来：`mkdir -p /opt/xianxia/backups`。

> 也可以**停机整目录拷**，更简单但要停服几秒：
> ```bash
> docker compose stop game
> docker compose cp game:/data ./data-backup
> docker compose start game
> ```
> 这种方式要连 `game.db`、`game.db-wal`、`game.db-shm` 一起拷，缺一不可。

### 恢复存档

```bash
cd /opt/xianxia/deploy

# 1. 停掉游戏（Caddy 可以继续跑）
docker compose stop game

# 2. 把备份塞回卷里，覆盖掉现有的库
docker compose cp ./backup-2026-09-05.db game:/data/game.db

# 3. WAL 的两个附属文件要删掉，不然它们会覆盖你刚恢复的内容
docker compose run --rm --entrypoint sh game -c 'rm -f /data/game.db-wal /data/game.db-shm'

# 4. 起来
docker compose start game
docker compose logs --tail=30 game
```

### 停机与重启

```bash
docker compose restart game   # 只重启游戏，几秒钟
docker compose restart        # 两个都重启
docker compose stop           # 停服，存档还在
docker compose up -d          # 起服
docker compose down           # 删掉容器，存档还在（卷不会删）
```

> ⚠️ **`docker compose down -v` 会连数据卷一起删掉，也就是删档。**
> 除非你真的想重开一个世界，否则永远不要加 `-v`。

---

## 十一、常见问题

**Q：浏览器打不开，转圈或者「无法访问此网站」。**

按顺序排查：

```bash
# 1. 容器活着吗
docker compose ps

# 2. 域名解析对了吗（在你自己电脑上跑）
ping 你的域名

# 3. 端口通吗（在你自己电脑上跑）
curl -I http://你的域名
```

九成是安全组没放行 80/443，回到[第四步](#四放行-80-和-443-端口)。

---

**Q：`docker compose logs caddy` 里一直在报证书申请失败。**

常见原因，从上往下试：

1. DNS 还没生效 —— `ping 你的域名` 出来的 IP 不是这台服务器。等等再看。
2. 80 端口不通 —— Let's Encrypt 走 80 端口验证，安全组和 `ufw` 都要放行。
3. Cloudflare 的橙色云朵开着 —— 改成「仅 DNS」。
4. 短时间内反复重启，撞上了 Let's Encrypt 的频率限制
   （同一域名一周 5 次）。先用 `DOMAIN=:80` 把功能跑通，
   确认没别的问题了再换回域名。

---

**Q：`game` 容器起不来，日志里写「缺少环境变量 ADMIN_PASSWORD」。**

`.env` 里的 `ADMIN_PASSWORD` 是空的。填上，然后 `docker compose up -d`。

---

**Q：注册时提示需要邀请码，但我没设。**

世界设置默认要求邀请码。两个办法：

- 在 `.env` 里填 `INVITE_CODE=什么码`，然后 `docker compose down && docker compose up -d`
  ——注意这条码只在**数据库第一次创建时**写入，如果库已经建好了这样不管用；
- 已经有库了就去后台 `https://你的域名/admin` → 邀请 → 发一张，
  或者去「世界」页把「注册需要邀请码」关掉。

---

**Q：这台机器上已经跑着 nginx，80/443 被占了。**

让 nginx 继续当门房，把这套的 Caddy 让开：

1. `.env` 里改 `HTTP_PORT=8080`、`HTTPS_PORT=8443`，`DOMAIN=:80`
2. 在你已有的 nginx 里加一段反代（**WebSocket 的两行不能少**）：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # Socket.IO 要靠这两行
    proxy_set_header Connection "upgrade";       # 少了聊天和组队就不通
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

证书这时候由 nginx（certbot）管，不再由 Caddy 管。

---

**Q：世界频道不刷新、组队邀请对方收不到、秘境战报只有队长看得见。**

这是 WebSocket 没通。自查：

- 用的是自带的 Caddy → 一般不会有这问题，Caddy 默认就透传 Upgrade 头；
- 前面套了别的 nginx / 宝塔 / CDN → 十有八九是那一层没配 `Upgrade` 和
  `Connection` 头，见上一条；
- Cloudflare 橙色云朵开着 → 它默认是支持 WebSocket 的，但免费版有
  100 秒空闲超时，长时间挂机会断线重连，属于正常现象。

浏览器 F12 → Network → WS，看有没有一条 `/socket.io/` 的连接是 `101 Switching
Protocols`。是就说明通了。

---

**Q：磁盘满了。**

```bash
docker system df          # 看谁占的
docker image prune -a -f  # 删掉没在用的镜像，通常能腾出几个 G
```

存档本身很小——一万个角色也就几十 MB。

---

**Q：想改修炼速度 / 掉落率 / 机器人数量。**

全在后台里，`https://你的域名/admin` → 世界。改完立刻生效，不用重启。
别去改代码里的常量。

---

**Q：怎么彻底删掉重来？**

```bash
cd /opt/xianxia/deploy
docker compose down -v     # -v 会删掉存档卷，想清楚再敲
docker compose up -d
```

---

**构建停在 `load metadata for docker.io/library/node:24-alpine`，最后报 `DeadlineExceeded`？**
是拉取基础镜像的元数据超时，不是代码问题。先单独把基础镜像拉下来，再重新构建：

```bash
docker pull node:24-alpine
```

```bash
docker compose up -d --build
```

---

## 没有域名怎么办

**能玩，但装不了桌面图标**（PWA 要 HTTPS，这是浏览器的硬规矩）。

改 `.env` 里这一行：

```ini
DOMAIN=:80
```

`:80` 的意思是「不管什么域名来的都接，只开 HTTP，不申请证书」。
然后照常 `docker compose up -d`。

访问地址变成：

- 公网服务器：`http://你服务器的IP`
- 局域网（比如就跑在你自己的电脑或家里的小主机上）：
  `http://这台机器的内网IP`，例如 `http://192.168.1.10`
  ——同一个 WiFi 下的手机直接输这个地址就能玩。

查内网 IP：

```bash
hostname -I | awk '{print $1}'
```

局域网里想要个好记的名字，可以在**每台**要玩的设备上改 hosts 文件把
`192.168.1.10` 指到 `xianxia.local`；但这么做仍然没有 HTTPS，
还是装不了 PWA。真想要桌面图标，就买个域名——一年几十块钱，
Caddy 会把证书这件事全部办好。

**只想在自己电脑上试试**（不发布给别人）：

```bash
cd deploy
cp .env.example .env
# .env 里改成：DOMAIN=:80  HTTP_PORT=8080  ADMIN_PASSWORD=随便一个
docker compose up -d
# 浏览器打开 http://localhost:8080
```

（8080 被别的东西占了就换一个，比如 `HTTP_PORT=8099`。）

---

## 附：手动跑一个容器（不用 compose）

调试时偶尔有用，跑起来的是**没有 HTTPS 的裸服务端**：

```bash
docker build -f deploy/Dockerfile -t xianxia .
docker run --rm -p 8080:3000 \
  -e ADMIN_PASSWORD=test1234 \
  -e INVITE_CODE=qingyun \
  -v xianxia-data:/data \
  xianxia
```

然后 `http://localhost:8080`。

自动化冒烟测试也是打这个地址。它会真的注册两个号、组队打一趟秘境、
论一场道，跑完把世界设置复原：

```bash
# 第一次要下载浏览器（约 150 MB，只需一次）
pnpm --filter e2e exec playwright install chromium

E2E_BASE_URL=http://localhost:8080 \
E2E_ADMIN_PASSWORD=test1234 \
E2E_INVITE_CODE=qingyun \
pnpm e2e
```

失败时 `e2e/playwright-report/` 里有截图和可回放的 trace：

```bash
pnpm --filter e2e exec playwright show-report
```
