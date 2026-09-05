import { buildApp, pendingEndpointsBanner } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { attachSocketIo } from './socket.js';

/**
 * Entry point.
 *
 * Boots the HTTP server, attaches Socket.IO once it is listening, and prints
 * what is and is not implemented so an operator can see the surface at a
 * glance.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[启动失败] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const { app, ctx, routes } = buildApp({ config });

  await app.listen({ port: config.port, host: config.host });
  await app.ready();
  attachSocketIo(app, ctx);

  const world = ctx.settings.get();
  app.log.info(
    `修仙世界已开启：机器人目标 ${world.botCount} 名，tick ${world.botTickSeconds} 秒，` +
      `修炼倍率 ${world.cultivationMultiplier}x，邀请码${world.inviteRequired ? '必填' : '免填'}`,
  );
  app.log.info(`数据库：${config.dbFile}`);
  app.log.info(
    config.clientDist === null
      ? '未配置 CLIENT_DIST，仅提供 API'
      : `客户端目录：${config.clientDist}`,
  );
  app.log.info(pendingEndpointsBanner(routes));

  const shutdown = (signal: string): void => {
    app.log.info(`收到 ${signal}，正在关闭……`);
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main().catch((error: unknown) => {
  console.error('[启动失败]', error);
  process.exit(1);
});
