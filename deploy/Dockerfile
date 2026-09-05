# 修仙挂机 —— 生产镜像
#
# 从仓库根目录构建（构建上下文是仓库根，不是 deploy/）：
#   docker build -f deploy/Dockerfile -t xianxia .
# 或者交给 compose：
#   docker compose -f deploy/docker-compose.yml build
#
# 分三段：
#   build   —— 装全量依赖、编译 shared / server / client
#   prune   —— 用 `pnpm deploy` 摘出「只含生产依赖」的一棵树
#   runtime —— 干净的 node:24-alpine，只放跑起来必需的东西
#
# Node 24 自带 node:sqlite，所以整条链路没有任何原生模块要编译，
# 最终镜像里也就不需要 python / make / g++。

# 版本集中在这里，改一处即可。
ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=11.18.0

# ---------------------------------------------------------------- 1. 编译
FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# 先只放清单文件：只要依赖没变，下面这层 install 就能命中缓存，
# 改一行业务代码不会重新下载几百个包。
#
# 六个清单一个都不能少：`--frozen-lockfile` 会拿锁文件里的每个 importer
# 跟磁盘上的 package.json 对账，缺一个就报 ERR_PNPM_OUTDATED_LOCKFILE。
# 以后往 workspace 里加新包，记得在这里补一行。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY tools/art/package.json tools/art/
COPY e2e/package.json e2e/

# `--filter <pkg>...` 连同依赖一起装。工具链（tools/art 的 sharp、e2e 的
# Playwright）与镜像无关，过滤掉能省下可观的时间和空间。
RUN pnpm install --frozen-lockfile \
    --filter "@xianxia/server..." \
    --filter "@xianxia/client..."

# 再放源码。这一层变了也只会重跑构建，不会重跑 install。
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/client apps/client

# shared 必须最先构建：server 走它的 dist，client 的 vite build 也走 dist。
RUN pnpm --filter @xianxia/shared build \
 && pnpm --filter @xianxia/server build \
 && pnpm --filter @xianxia/client build

# 迁移文件是 .sql，tsc 不会搬运它们；copy-migrations 已在 server 的 build 里跑过，
# 这里只是确认一下——缺了的话服务端启动即报错，不如在构建期就红。
RUN test -d apps/server/dist/db/migrations \
 && test -n "$(ls apps/server/dist/db/migrations/*.sql)" \
 && test -f apps/client/dist/index.html \
 && test -f apps/client/dist/manifest.webmanifest

# ------------------------------------------------------- 2. 摘生产依赖树
# `pnpm deploy` 把 server 的生产依赖（含 workspace 包 @xianxia/shared）
# 拷成一棵普通的、无软链的 node_modules，可以整个搬进运行镜像。
FROM build AS prune
WORKDIR /repo
#
# `--legacy`：pnpm 10 起，非 legacy 的 deploy 要求 workspace 开
# `inject-workspace-packages`，而本仓库没开（开了会影响所有 agent 的日常开发）。
# legacy 模式做的正是我们要的：把依赖树摊平拷过去。
RUN pnpm --filter @xianxia/server --prod --legacy deploy /prod \
 && test -f /prod/node_modules/@xianxia/shared/dist/index.js

# ---------------------------------------------------------------- 3. 运行
FROM node:${NODE_VERSION} AS runtime

# sqlite CLI 只为备份用：docs/DEPLOY.md 里的 `.backup` 命令要它。
# 一个多 MB，换来一条能对着 WAL 库热备份的命令，值。
RUN apk add --no-cache sqlite

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    CLIENT_DIST=./client \
    LOG_LEVEL=info

WORKDIR /app

# 生产依赖 + 包清单。`pnpm deploy` 的产物已经是扁平可用的形态
# （node_modules/@xianxia/shared 里是编译好的 dist，不是软链）。
COPY --from=prune --chown=node:node /prod/node_modules ./node_modules
COPY --from=prune --chown=node:node /prod/package.json ./package.json

# 服务端产物。/prod 里其实也有一份 dist，但同时还捎带着 src/、test/、
# tsconfig 和 vitest.config —— 运行时一样都用不上，所以只挑 dist 过来。
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist

# 前端产物。CLIENT_DIST 相对 server 包根解析，包根就是 /app。
COPY --from=build --chown=node:node /repo/apps/client/dist ./client

# 数据目录先在镜像里建好并归属 node，这样首次创建的具名卷会继承这个属主，
# 非 root 进程才写得进去。
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# 没装 curl / wget，直接用 Node 自带的 fetch。未登录时 /api/auth/me 回 401，
# 能拿到 401 就说明路由、数据库、进程都活着。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/me').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
