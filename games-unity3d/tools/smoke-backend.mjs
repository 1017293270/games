import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { project, runWorker, startIsolated } from './dev-server.mjs';

// Deliberately uses fetch polling, not socket.io-client: this exercises the
// same Engine.IO transport and framing implemented by the Unity component.
class PollingClient {
  constructor(url) {
    this.endpoint = `${url}/socket.io/?EIO=4&transport=polling`;
    this.events = [];
    this.pings = 0;
    this.pongs = 0;
    this.connected = false;
    this.abort = new AbortController();
    this.posts = Promise.resolve();
    this.failure = null;
  }
  async request(method, body) {
    const response = await fetch(this.endpoint, {
      method, body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(50000)]),
    });
    assert.equal(response.status, 200, `Engine.IO ${method} HTTP ${response.status}`);
    return response.text();
  }
  send(packet) {
    this.posts = this.posts.then(async () => assert.equal(await this.request('POST', packet), 'ok'));
    return this.posts;
  }
  emit(name, payload) { return this.send('42' + JSON.stringify(payload === undefined ? [name] : [name, payload])); }
  async connect(token) {
    const open = await this.request('GET');
    assert.equal(open[0], '0');
    const handshake = JSON.parse(open.slice(1));
    assert.ok(handshake.sid && handshake.pingInterval > 0 && handshake.pingTimeout > 0);
    this.endpoint += '&sid=' + encodeURIComponent(handshake.sid);
    this.loop = this.poll().catch(error => { if (!this.abort.signal.aborted) this.failure = error; });
    await this.send('40' + JSON.stringify({ token }));
    await this.until(() => this.connected, 'Socket.IO CONNECT acknowledgement');
  }
  async poll() {
    while (!this.abort.signal.aborted) {
      const body = await this.request('GET');
      for (const packet of body.split('\x1e')) {
        if (packet === '2') {
          this.pings++;
          await this.send('3');
          this.pongs++;
        } else if (packet.startsWith('40')) {
          assert.ok(JSON.parse(packet.slice(2)).sid);
          this.connected = true;
        } else if (packet.startsWith('42')) {
          const [name, payload] = JSON.parse(packet.slice(2));
          this.events.push({ name, payload });
        } else if (packet !== '6') throw new Error(`Unexpected Engine.IO packet type ${packet.slice(0, 2)}`);
      }
    }
  }
  async until(predicate, label, timeout = 10000) {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (this.failure) throw this.failure;
      assert.ok(Date.now() < end, `Timed out: ${label}`);
      await sleep(5);
    }
  }
  async close() {
    try { if (!this.failure && this.connected) await this.send('41'); }
    finally { this.connected = false; this.abort.abort(); await this.loop; }
  }
}

async function main() {
  if (!process.argv.includes('--worker')) { runWorker(fileURLToPath(import.meta.url)); return; }
  const directory = mkdtempSync(join(tmpdir(), 'qingyun-unity-smoke-'));
  const evidenceDir = join(project, '.local/verification');
  mkdirSync(evidenceDir, { recursive: true });
  const evidence = { passed: false, at: new Date().toISOString(), transport: 'Engine.IO 4 HTTP polling',
    serverAuthority: true, isolatedDatabase: true, acceleratedSimulationClock: true, checks: {} };
  let server;
  let client;
  let failure;
  try {
    let clock = Date.now();
    server = await startIsolated({ dataDir: directory, now: () => clock, timers: false });
    const player = await server.preparePlayer({ username: 'smoke_unity', password: 'SmokeUnity2026' }, '验收剑客');
    evidence.checks.registerLoginCharacter = true;
    const before = await server.api('character', undefined, player.token);
    assert.equal(before.character.stageIndex, 20);
    client = new PollingClient(server.url);
    await client.connect(player.token);
    evidence.checks.socketTokenAuthentication = true;
    await client.emit('zone:enter', { zoneId: 'map-qingyun-mountain' });
    await client.until(() => client.events.some(event => event.name === 'zone:joined'), 'zone:joined');
    const joined = client.events.find(event => event.name === 'zone:joined').payload;
    assert.equal(joined.zoneId, 'map-qingyun-mountain');
    assert.equal(joined.frame.full, true);
    assert.ok(joined.frame.add.some(row => row.i === joined.self && row.id === player.characterId));
    assert.ok(joined.frame.ents.every(row => row.length === 7));
    evidence.checks.joinedFullFrame = true;
    const world = server.ctx.zones.worlds.get(joined.zoneId);
    assert.ok(world);
    let ticks = 0;
    let resynced = false;
    const bossSlain = () => client.events.some(event => event.name === 'zone:frame' &&
      event.payload.events.some(item => item.t === 'boss_slain' && item.killerName === '验收剑客'));
    const bossLoot = () => client.events.some(event => event.name === 'zone:loot' && event.payload.bossKills > 0);
    for (; ticks < 12000 && !(bossSlain() && bossLoot()); ticks++) {
      clock += 250;
      server.ctx.zones.step(clock);
      world.broadcast(clock);
      if (ticks % 20 === 19) server.ctx.zones.flush(clock);
      if (ticks === 20) {
        const previous = client.events.filter(event => event.name === 'zone:joined').length;
        await client.emit('zone:enter', { zoneId: joined.zoneId });
        await client.until(() => client.events.filter(event => event.name === 'zone:joined').length > previous, 'resync full frame');
        const fresh = client.events.filter(event => event.name === 'zone:joined').at(-1).payload;
        assert.equal(fresh.frame.full, true);
        assert.equal(fresh.enteredAt, joined.enteredAt);
        resynced = true;
      }
      // Leave the real GET/POST transport time to receive each server broadcast.
      await sleep(5);
    }
    assert.ok(resynced);
    assert.ok(bossSlain(), 'real simulation must emit boss_slain for the test player');
    assert.ok(bossLoot(), 'real settlement must deliver bossKills > 0');
    const frames = client.events.filter(event => event.name === 'zone:frame').map(event => event.payload);
    assert.ok(frames.some(frame => frame.full));
    assert.ok(frames.some(frame => !frame.full));
    assert.ok(frames.every((frame, i) => i === 0 || frame.seq > frames[i - 1].seq));
    evidence.checks.fullAndDeltaFrames = true;
    evidence.checks.resyncFullFrame = true;
    evidence.checks.bossSlainAndSettledLoot = true;
    evidence.simulatedSeconds = ticks * 0.25;
    evidence.receivedFrames = frames.length;
    console.log(`Combat verified: ${frames.length} frames, Boss slain and loot settled (${evidence.simulatedSeconds}s simulated)`);

    await client.until(() => client.pings > 0 && client.pongs > 0, 'real Engine.IO heartbeat', 30000);
    evidence.checks.engineIoPingPong = true;
    await client.emit('zone:retreat');
    await client.until(() => client.events.some(event => event.name === 'zone:left' && event.payload.reason === 'retreat'), 'zone retreat');
    assert.equal(server.ctx.zones.zoneOf(player.characterId), null);
    evidence.checks.retreat = true;
    const receipts = client.events.filter(event => event.name === 'zone:loot').map(event => event.payload);
    const total = receipts.reduce((sum, loot) => ({ kills: sum.kills + loot.kills,
      bossKills: sum.bossKills + loot.bossKills, spiritStones: sum.spiritStones + loot.spiritStones,
      itemQuantity: sum.itemQuantity + loot.items.reduce((n, item) => n + item.qty, 0),
    }), { kills: 0, bossKills: 0, spiritStones: 0, itemQuantity: 0 });
    const after = await server.api('character', undefined, player.token);
    assert.equal(after.character.spiritStones - before.character.spiritStones, total.spiritStones);
    await client.close();
    client = null;
    const dbFile = server.dbFile;
    await server.close();
    server = null;
    // Reopen the closed SQLite file: neither an in-memory model nor a HTTP 200
    // is accepted as evidence that the authoritative reward survived shutdown.
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const saved = db.prepare('SELECT spirit_stones, state_json FROM characters WHERE id = ?').get(player.characterId);
      assert.equal(saved.spirit_stones, after.character.spiritStones);
      assert.equal(JSON.parse(saved.state_json).spiritStones, after.character.spiritStones);
      assert.ok(total.bossKills > 0 && total.spiritStones > 0);
      const stacks = db.prepare('SELECT SUM(qty) AS quantity FROM inventory WHERE character_id = ?').get(player.characterId);
      assert.ok(stacks.quantity >= total.itemQuantity);
      evidence.persisted = { spiritStones: saved.spirit_stones, inventoryQuantity: stacks.quantity };
    } finally { db.close(); }
    evidence.rewards = total;
    evidence.checks.sqliteReopenedAfterShutdown = true;
    evidence.passed = true;
    console.log('PASS: register/login, character, polling, full/delta, heartbeat, resync, Boss loot, retreat, reopened SQLite');
  } catch (error) {
    failure = error;
    evidence.error = error.message;
    console.error(`FAIL: ${error.message}`);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    writeFileSync(join(evidenceDir, 'backend.json'), JSON.stringify(evidence, null, 2) + '\n');
    if (evidence.passed) rmSync(directory, { recursive: true, force: true });
    else console.error(`Isolated failure database retained: ${directory}`);
  }
  if (failure) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
