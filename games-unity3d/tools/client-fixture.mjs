import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { project, runWorker, startIsolated, sourceDirectory } from './dev-server.mjs';

// This fixture owns a newly-created DB only. No existing dev server or production URL is accepted.
const credentials = { username: 'ui_smoke_main', password: 'UiSmokeMain2026' };
const peerCredentials = { username: 'ui_smoke_peer', password: 'UiSmokePeer2026' };

async function main() {
  if (!process.argv.includes('--worker')) { runWorker(fileURLToPath(import.meta.url)); return; }
  const evidenceDir = resolve(process.env.QINGYUN_SMOKE_DIR || join(project, '.local/verification', `client-${Date.now()}`));
  const port = Number(process.env.QINGYUN_SMOKE_PORT || 3191);
  const connectionMode = process.env.QINGYUN_SMOKE_MODE === 'connection';
  const commerceMode = process.env.QINGYUN_SMOKE_MODE === 'commerce';
  assert.ok(!commerceMode || port !== 3191, 'Commerce requires a fresh port other than 3100/3191');
  const resumeDelayMs = Number(process.env.QINGYUN_SMOKE_RESUME_DELAY_MS || 6000);
  assert.ok(!connectionMode || Number.isInteger(resumeDelayMs) && resumeDelayMs >= 1500 && resumeDelayMs <= 15000, 'Connection delay must be 1500–15000ms');
  assert.ok(Number.isInteger(port) && port >= 0 && port < 65536 && port !== 3100, 'Use a new isolated port; 3100 is forbidden');
  assert.ok(!existsSync(evidenceDir) || readdirSync(evidenceDir).length === 0, 'Evidence directory must be new or empty; existing data is never reused');
  mkdirSync(evidenceDir, { recursive: true });
  const dataDir = join(evidenceDir, 'fixture-db');
  mkdirSync(dataDir);
  const source = sourceDirectory();
  const shared = await import(pathToFileURL(join(source, 'packages/shared/src/index.ts')));
  const { withFreshPower, resolveEquipment } = await import(pathToFileURL(join(source, 'apps/server/src/game/character.ts')));
  const { generateBots } = await import(pathToFileURL(join(source, 'apps/server/src/engine/bots/generate.ts')));
  const { CHAT_MIN_INTERVAL_MS } = await import(pathToFileURL(join(source, 'apps/server/src/modules/social/service.ts')));
  const require = createRequire(join(source, 'apps/client/package.json'));
  const { io } = await import(pathToFileURL(require.resolve('socket.io-client')));
  let server, peerSocket, interval, connectionInterval, polling = false, closing = false;
  const connectionTimers = new Set();
  const log = (kind, value) => appendFileSync(join(evidenceDir, 'peer-events.jsonl'), JSON.stringify({ at: Date.now(), kind, value }) + '\n');
  const close = async () => {
    if (closing) return;
    closing = true; clearInterval(interval); clearInterval(connectionInterval);
    for (const timer of connectionTimers) clearTimeout(timer);
    peerSocket?.disconnect(); await server?.close();
  };
  try {
    const commercePassword = commerceMode ? randomBytes(32).toString('hex') : undefined;
    server = await startIsolated({ dataDir, port, adminPassword: commercePassword });
    const mainPlayer = await server.preparePlayer(credentials, '验收主修');
    const peer = await server.preparePlayer(peerCredentials, '验收同道');
    if (connectionMode) {
      // Test-only transport perturbation. The production handler computes `none` normally;
      // only delivery of its first reply is held, never zone membership or a business result.
      const observed = { resumeNoneHeldAt: null, resumeNoneDeliveredAt: null, latestJoined: null, latestLeft: null, disconnectCount: 0, handledControl: null };
      const snapshot = () => {
        const value = { ...observed, at: Date.now(), mainZoneId: server.ctx.zones.zoneOf(mainPlayer.characterId),
          mainSocketIds: [...server.io.sockets.sockets.values()].filter(socket => socket.data.characterId === mainPlayer.characterId).map(socket => socket.id),
          mainWatchingZones: [...server.io.sockets.sockets.values()].filter(socket => socket.data.characterId === mainPlayer.characterId).map(socket => socket.data.zoneId) };
        const file = join(evidenceDir, 'connection-state.json');
        writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file);
      };
      server.io.on('connection', socket => {
        if (socket.data.characterId !== mainPlayer.characterId) return;
        log('connection-open', { socketId: socket.id });
        const originalEmit = socket.emit.bind(socket);
        socket.emit = (event, ...args) => {
          if (event === 'zone:left' && args[0]?.reason === 'none' && observed.resumeNoneHeldAt === null) {
            observed.resumeNoneHeldAt = Date.now(); log('resume-none-held', { socketId: socket.id, delayMs: resumeDelayMs }); snapshot();
            const timer = setTimeout(() => {
              connectionTimers.delete(timer);
              observed.resumeNoneDeliveredAt = Date.now(); originalEmit(event, ...args);
              log('resume-none-delivered', { socketId: socket.id }); snapshot();
            }, resumeDelayMs);
            connectionTimers.add(timer);
            return socket;
          }
          return originalEmit(event, ...args);
        };
        socket.onAnyOutgoing((event, payload) => {
          if (!['zone:joined', 'zone:left', 'zone:error'].includes(event)) return;
          if (event === 'zone:joined') observed.latestJoined = { zoneId: payload.zoneId, enteredAt: payload.enteredAt, self: payload.self };
          if (event === 'zone:left') observed.latestLeft = payload;
          log('connection-outgoing', { socketId: socket.id, event, payload: event === 'zone:joined' ? observed.latestJoined : payload }); snapshot();
        });
        socket.on('disconnect', reason => { observed.disconnectCount++; log('connection-closed', { socketId: socket.id, reason }); snapshot(); });
        snapshot();
      });
      connectionInterval = setInterval(() => {
        const signal = join(evidenceDir, 'connection-control.json');
        if (existsSync(signal)) {
          let request;
          try { request = JSON.parse(readFileSync(signal, 'utf8')); } catch { return; }
          if (typeof request.id === 'string' && request.id !== observed.handledControl && request.action === 'disconnect') {
            observed.handledControl = request.id;
            const sockets = [...server.io.sockets.sockets.values()].filter(socket => socket.data.characterId === mainPlayer.characterId);
            log('connection-control', { id: request.id, action: request.action, socketIds: sockets.map(socket => socket.id) });
            for (const socket of sockets) socket.conn.close();
          }
        }
        snapshot();
      }, 100);
      snapshot();
    }
    for (const player of [mainPlayer, peer]) {
      const state = server.ctx.characters.byId(player.characterId);
      state.stageIndex = 7;
      state.exp = shared.getStage(7).expRequired;
      state.spiritStones = commerceMode && player === mainPlayer ? 50 : 100000;
      state.hpPercent = 0.7;
      state.learnedSkillIds = ['skill-metal-1'];
      state.skillSlots = ['skill-metal-1', null, null, null];
      state.learnedTechniqueIds = ['tech-qingyun'];
      state.techniqueId = 'tech-qingyun';
      state.equipment = { treasure: null, robe: null, accessory: null, pet: null };
      state.buffs = [];
      state.lastSettledAt = server.ctx.now();
      state.progression = shared.getProgression(undefined, server.ctx.now());
      state.progression.materials = { jade: 10000, stardust: 10000, starStones: 10000, breakthroughWood: 100 };
      server.ctx.inventory.removeAllFor(player.characterId);
      for (const [itemId, qty] of [['pill-breakthrough', 12], ['pill-qi', 10], ['pill-heal', 10], ['pill-power', 3], ['robe-daoist', 1]]) {
        assert.ok(shared.ITEM_BY_ID.has(itemId), `Missing fixture item ${itemId}`);
        server.ctx.inventory.add(player.characterId, itemId, qty);
      }
      server.ctx.characters.save(withFreshPower(state, resolveEquipment(state, server.ctx.inventory)));
    }
    if (commerceMode) {
      const admin = await server.api('admin/login', { username: 'unity_local_admin', password: commercePassword });
      let handled = false;
      const snapshot = async extra => {
        const view = await server.api('character', undefined, mainPlayer.token);
        const value = { ...extra, at: Date.now(), mainZoneId: server.ctx.zones.zoneOf(mainPlayer.characterId), view };
        const path = join(evidenceDir, 'commerce-state.json');
        writeFileSync(path + '.tmp', JSON.stringify(value, null, 2)); renameSync(path + '.tmp', path);
        return value;
      };
      const initial = await snapshot({ granted: false });
      assert.equal(initial.view.character.spiritStones, 50);
      assert.equal(initial.mainZoneId, null);
      const shop = await server.api('shop/shop-yaowang', undefined, mainPlayer.token);
      assert.equal(shop.entries.find(entry => entry.itemId === 'pill-qi').price, 60);
      writeFileSync(join(evidenceDir, 'fixture.json'), JSON.stringify({
        smokeFixtureVersion: 1, serverUrl: server.url, dbFile: server.dbFile,
        main: { ...credentials, characterId: mainPlayer.characterId, name: '验收主修' },
        commerce: { enabled: true, initialStones: 50, grantStones: 100 },
      }, null, 2));
      interval = setInterval(async () => {
        if (handled || polling || closing) return;
        const path = join(evidenceDir, 'commerce-control.json');
        if (!existsSync(path)) return;
        let request;
        try { request = JSON.parse(readFileSync(path, 'utf8')); } catch { return; }
        if (request.action !== 'grant-100' || request.id !== 'commerce-grant-100') return;
        polling = true; handled = true; // Exactly one grant, including after a response error.
        try {
          assert.equal(server.ctx.zones.zoneOf(mainPlayer.characterId), null);
          const before = await server.api('character', undefined, mainPlayer.token);
          assert.equal(before.character.spiritStones, 50);
          await server.api('admin/players/grant', { characterId: mainPlayer.characterId, spiritStones: 100 }, admin.token, true);
          const after = await snapshot({ granted: true, id: request.id });
          assert.equal(after.view.character.spiritStones, 150);
          assert.equal(after.mainZoneId, null);
          log('commerce-grant', { id: request.id, before: 50, after: 150, via: 'admin/players/grant' });
        } catch (error) { await snapshot({ granted: false, error: error.message }); }
        finally { polling = false; }
      }, 100);
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close());
      console.log(`Commerce fixture ready: ${server.url}`);
      console.log(`Player arguments: -qingyunServer ${server.url} -qingyunSmoke ${evidenceDir} -qingyunSmokeMode commerce`);
      if (process.env.QINGYUN_FIXTURE_CHECK === '1') {
        writeFileSync(join(evidenceDir, 'commerce-control.json'), JSON.stringify({ id: 'commerce-grant-100', action: 'grant-100' }));
        const end = Date.now() + 20000;
        while (!handled || polling) { assert.ok(Date.now() < end, 'Commerce grant timed out'); await sleep(20); }
        const result = JSON.parse(readFileSync(join(evidenceDir, 'commerce-state.json'), 'utf8'));
        assert.equal(result.granted, true); assert.equal(result.view.character.spiritStones, 150);
        await sleep(200);
        assert.equal((await server.api('character', undefined, mainPlayer.token)).character.spiritStones, 150, 'Repeated signal must not grant again');
        log('commerce-fixture-self-check', { passed: true, uiExecuted: false });
        await close();
      }
      return;
    }
    const bots = generateBots(server.ctx, { count: 1, minStageIndex: 8, maxStageIndex: 8, seed: 3191 }, server.ctx.now());
    for (const bot of bots) {
      bot.hpPercent = 0.1; // Initial wounded raid fixture; no writes occur during outcome assertions.
      server.ctx.characters.save(bot);
    }
    let peerSends = Promise.resolve(), peerLastSend = 0;
    const peerSnapshot = async () => {
      const view = await server.api('character', undefined, peer.token);
      writeFileSync(join(evidenceDir, 'peer-state.json'), JSON.stringify({ at: Date.now(), view }, null, 2));
      return view;
    };
    await peerSnapshot();
    peerSocket = io(server.url, { auth: { token: peer.token }, transports: ['polling'], reconnection: false });
    await new Promise((accept, reject) => { peerSocket.once('connect', accept); peerSocket.once('connect_error', reject); });
    peerSocket.onAny((event, payload) => {
      if (['chat:message', 'friend:request', 'party:update', 'dungeon:result', 'arena:challenged'].includes(event)) log(event, payload);
      if (event === 'chat:message' && payload.senderId === mainPlayer.characterId && payload.text.startsWith('验收传音:'))
        peerSends = peerSends.then(async () => {
          await sleep(Math.max(0, peerLastSend + CHAT_MIN_INTERVAL_MS - Date.now()));
          peerLastSend = Date.now();
          peerSocket.emit('chat:send', { channel: payload.channel, text: '同道已收到:' + payload.text.slice('验收传音:'.length) });
        }).catch(error => log('peer-error', { message: error.message }));
      if (event === 'dungeon:result')
        void peerSnapshot().then(view => log('peer-dungeon-state', { dungeonId: payload.dungeonId, view })).catch(error => log('peer-error', { message: error.message }));
    });
    await server.api('friends/request', { characterId: mainPlayer.characterId }, peer.token);
    const manifest = { smokeFixtureVersion: 1, createdAt: new Date().toISOString(), serverUrl: server.url, dbFile: server.dbFile,
      main: { ...credentials, characterId: mainPlayer.characterId, name: '验收主修' },
      peer: { ...peerCredentials, characterId: peer.characterId, name: '验收同道' },
      newAccount: { username: 'ui_smoke_new', password: 'UiSmokeNew2026', name: '验收新修' },
      raidBots: bots.map(bot => ({ id: bot.id, name: bot.name, stageIndex: bot.stageIndex, initialHpPercent: bot.hpPercent })),
      connection: { enabled: connectionMode, resumeDelayMs: connectionMode ? resumeDelayMs : 0 },
      scope: 'Fresh isolated DB fixture only; UI acceptance is performed by the Unity player, not this script',
      fixtures: { stageIndex: 7, fullCultivation: true, starterClaimed: false, fundedMaterials: true, peerFriendRequest: true },
    };
    writeFileSync(join(evidenceDir, 'fixture.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(evidenceDir, 'fixture-initial-state.json'), JSON.stringify({
      main: await server.api('character', undefined, mainPlayer.token),
      peer: await server.api('character', undefined, peer.token),
    }, null, 2));
    log('fixture-ready', { characterId: mainPlayer.characterId, peerId: peer.characterId });
    // The peer is a genuine second authenticated client. It joins only after the UI establishes a party.
    interval = setInterval(async () => {
      if (polling || closing) return;
      polling = true;
      try {
        const [mainParty, peerParty] = await Promise.all([server.api('party', undefined, mainPlayer.token), server.api('party', undefined, peer.token)]);
        if (mainParty.party && !peerParty.party) {
          const joined = await server.api('party/join', { code: mainParty.party.code }, peer.token);
          log('peer-joined', { partyId: joined.id, members: joined.members.map(member => member.characterId) });
        }
        const friends = await server.api('friends', undefined, peer.token);
        if (friends.friends.some(friend => friend.characterId === mainPlayer.characterId && friend.state === 'accepted') && !manifest.peerFriendAccepted) {
          manifest.peerFriendAccepted = true;
          log('peer-friend-accepted', { characterId: mainPlayer.characterId });
        }
        await peerSnapshot();
      } catch (error) { log('peer-error', { message: error.message }); }
      finally { polling = false; }
    }, 1000);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close());
    console.log(`Client fixture ready: ${server.url}`);
    console.log(`Evidence: ${evidenceDir}`);
    console.log(`Player arguments: -qingyunServer ${server.url} -qingyunSmoke ${evidenceDir}${connectionMode ? ' -qingyunSmokeMode connection' : ''}`);
    if (process.env.QINGYUN_FIXTURE_CHECK === '1') {
      const view = await server.api('character', undefined, mainPlayer.token);
      assert.equal(view.character.stageIndex, 7); assert.equal(view.character.progression.starterClaimed, false);
      assert.equal(view.inventory.find(item => item.itemId === 'pill-breakthrough').qty, 12);
      const friends = await server.api('friends', undefined, mainPlayer.token);
      assert.equal(friends.friends.find(friend => friend.characterId === peer.characterId).state, 'pending_in');
      const [targets, quests, maps, dungeons, shop] = await Promise.all([
        server.api('raid/targets', undefined, mainPlayer.token), server.api('quests', undefined, mainPlayer.token),
        server.api('explore/maps', undefined, mainPlayer.token), server.api('dungeon', undefined, mainPlayer.token),
        server.api('shop/shop-yaowang', undefined, mainPlayer.token),
      ]);
      assert.equal(targets.targets.find(target => target.id === bots[0].id).hpPercent, 0.1);
      assert.ok(quests.available.some(entry => entry.quest.id === 'quest-c1-01'));
      assert.ok(maps.maps.some(map => map.id === 'map-luoshui-city' && map.unlocked));
      assert.ok(dungeons.dungeons.some(dungeon => dungeon.unlocked && dungeon.runsToday < dungeon.dailyLimit));
      assert.ok(shop.entries.some(entry => entry.itemId === 'pill-qi' && entry.available));
      if (connectionMode) {
        const probe = io(server.url, { auth: { token: mainPlayer.token }, transports: ['polling'], reconnection: false });
        const left = [];
        probe.on('zone:left', value => left.push(value));
        const until = async predicate => {
          const end = Date.now() + resumeDelayMs + 5000;
          while (!predicate()) { assert.ok(Date.now() < end, 'Connection fixture self-check timed out'); await sleep(10); }
        };
        try {
          await new Promise((accept, reject) => { probe.once('connect', accept); probe.once('connect_error', reject); });
          probe.emit('zone:enter', { zoneId: null });
          await until(() => JSON.parse(readFileSync(join(evidenceDir, 'connection-state.json'), 'utf8')).resumeNoneHeldAt !== null);
          await sleep(100); assert.equal(left.length, 0, 'Original none reply must actually be withheld');
          await until(() => left.length > 0); assert.equal(left[0].reason, 'none');
          assert.equal(server.ctx.zones.zoneOf(mainPlayer.characterId), null, 'Transport delay must not fabricate membership');
          const observedDisconnect = new Promise(accept => probe.once('disconnect', accept));
          writeFileSync(join(evidenceDir, 'connection-control.json'), JSON.stringify({ id: 'fixture-check-cut', action: 'disconnect' }));
          await observedDisconnect;
          assert.equal(server.ctx.zones.zoneOf(mainPlayer.characterId), null);
          log('connection-fixture-self-check', { passed: true, uiExecuted: false, realDelayedNone: true, realTransportDisconnected: true });
        } finally { probe.disconnect(); }
      }
      log('fixture-self-check', { passed: true, uiExecuted: false, ready: ['peer-friend', 'raid-bot', 'first-quest', 'second-map', 'dungeon', 'shop'] });
      await close();
    }
  } catch (error) { await close(); throw error; }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
