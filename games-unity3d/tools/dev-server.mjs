import { existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const demo = { username: 'unity_demo', password: 'UnityDemo2026' };

export function sourceDirectory() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required');
  const candidates = process.env.GAMES_SOURCE_DIR
    ? [resolve(process.env.GAMES_SOURCE_DIR)]
    : [resolve(project, '..'), resolve(project, '../games')];
  const required = ['apps/server/src/app.ts', 'apps/server/src/socket.ts', 'packages/shared/src/index.ts'];
  const source = candidates.find(candidate => required.every(file => existsSync(join(candidate, file))));
  if (!source) throw new Error('Games server not found beside or above this project; set GAMES_SOURCE_DIR to its root');
  return realpathSync(source);
}

export function runWorker(script) {
  const source = sourceDirectory();
  const require = createRequire(join(source, 'apps/server/package.json'));
  const loader = require.resolve('tsx/esm');
  const child = spawn(process.execPath, ['--conditions=development', '--import', loader, script, '--worker'], {
    stdio: 'inherit', env: { ...process.env, GAMES_SOURCE_DIR: source },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Could not start the isolated server worker'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}

async function checkPort(port) {
  if (!port) return;
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`127.0.0.1:${port} is occupied; no existing server was touched`)));
    probe.listen(port, '127.0.0.1', () => probe.close(accept));
  });
}

export async function startIsolated({ dataDir, port = 0, now, timers = true, clientDist = null, adminPassword: configuredAdminPassword }) {
  if (configuredAdminPassword !== undefined && (configuredAdminPassword.length < 6 || configuredAdminPassword.length > 72))
    throw new Error('QINGYUN_ADMIN_PASSWORD must contain 6–72 characters');
  await checkPort(port);
  const source = sourceDirectory();
  const { buildApp } = await import(pathToFileURL(join(source, 'apps/server/src/app.ts')));
  const { attachSocketIo } = await import(pathToFileURL(join(source, 'apps/server/src/socket.ts')));
  const adminPassword = configuredAdminPassword ?? randomBytes(32).toString('hex');
  const config = {
    port, host: '127.0.0.1', dataDir, dbFile: join(dataDir, 'game.db'),
    adminUsername: 'unity_local_admin', adminPassword, inviteCode: 'unity-local-demo',
    sessionTtlDays: 30, clientDist, logLevel: 'silent',
  };
  const built = buildApp({ config, now, startBots: false, startZones: false });
  let io;
  try {
    await built.app.listen({ port, host: '127.0.0.1' });
    await built.app.ready();
    io = attachSocketIo(built.app, built.ctx);
    const url = `http://127.0.0.1:${built.app.server.address().port}`;
    const api = async (path, body, token, admin = false, method = body === undefined ? 'GET' : 'POST') => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers[admin ? 'x-admin-token' : 'Authorization'] = admin ? token : `Bearer ${token}`;
      const response = await fetch(url + '/api/' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const error = new Error(`${path}: ${result.error?.code || response.status}`);
        error.code = result.error?.code;
        throw error;
      }
      return result.data;
    };
    const admin = await api('admin/login', { username: config.adminUsername, password: adminPassword });
    await api('admin/settings', {
      botCount: 0, bossIntervalMinutes: 1, monsterDensity: 0.2, respawnMultiplier: 5,
      mapPvp: false, inviteRequired: false, registrationOpen: true,
    }, admin.token, true, 'PUT');
    const preparePlayer = async (credentials = demo, name = '青云剑客') => {
      try { await api('auth/register', credentials); }
      catch (error) { if (error.code !== 'USERNAME_TAKEN') throw error; }
      const auth = await api('auth/login', credentials);
      let view;
      try { view = await api('character', undefined, auth.token); }
      catch (error) {
        if (error.code !== 'CHARACTER_NOT_FOUND') throw error;
        view = await api('character', { name, avatarArt: 'avatar/m01', gender: 'male' }, auth.token);
      }
      await api('admin/players/grant', { characterId: view.character.id, stageIndex: 20 }, admin.token, true);
      return { token: auth.token, characterId: view.character.id };
    };
    if (timers) built.ctx.zones.start();
    return { ...built, io, url, api, preparePlayer, dbFile: config.dbFile,
      close: async () => { io.disconnectSockets(true); io.engine.close(); await built.app.close(); },
    };
  } catch (error) {
    io?.engine.close();
    await built.app.close();
    throw error;
  }
}

async function main() {
  if (!process.argv.includes('--worker')) { runWorker(fileURLToPath(import.meta.url)); return; }
  const webDist = join(sourceDirectory(), 'apps/client/dist');
  const clientDist = existsSync(join(webDist, 'index.html')) ? webDist : null;
  const configuredPassword = process.env.QINGYUN_ADMIN_PASSWORD;
  const server = await startIsolated({ dataDir: join(project, '.local/server-data'), port: 3100,
    clientDist, adminPassword: configuredPassword });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown());
  try {
    await server.preparePlayer();
    console.log(`Ready: ${server.url} (isolated Unity database)`);
    console.log('Local demo prepared; stage 20; Boss interval 1 minute. Credentials are not logged.');
    if (clientDist) console.log(`Operator page: ${server.url}/admin (username: unity_local_admin)`);
    else console.log('Operator page unavailable: build the source apps/client without VITE_MOCK, then restart.');
    if (!configuredPassword) console.log('To sign into the operator page, set QINGYUN_ADMIN_PASSWORD privately before restarting.');
  } catch (error) { await shutdown(); throw error; }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
