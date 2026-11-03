import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveXp, validXpBatch } from '../src/liveXp.js';
import { createBridge, Store } from '../src/bridge.js';
import { SKILLS, xpAtLevel, levelProgress, combatLevel } from '../public/skills.js';

const drop = (changes = {}) => ({ id: 'mining-1', skill: 'MINING', amount: 35, totalXp: 1035,
  level: 9, observedAt: Date.now(), ...changes });
const batch = changes => ({ username: 'Test Player', drops: [drop()], ...changes });

test('live XP validates exact positive gains, known skills, level, bounds and event age', () => {
  assert.equal(validXpBatch(batch()), true);
  for (const changes of [{ amount: 0 }, { amount: -1 }, { skill: 'OVERALL' }, { totalXp: 10 },
    { level: 0 }, { id: '' }, { amount: 0.5 }, { observedAt: Date.now() - 31000 },
    { observedAt: Date.now() + 61000 }, { totalXp: 200000001 }]) {
    assert.equal(validXpBatch(batch({ drops: [drop(changes)] })), false, JSON.stringify(changes));
  }
  assert.ok(!validXpBatch(null));
  assert.ok(!validXpBatch({}));
  for (const invalid of [{ username: 'not an OSRS name' }, { drops: [] },
    { drops: Array.from({ length: 51 }, () => drop()) }, { drops: [null] }]) {
    assert.ok(!validXpBatch(batch(invalid)));
  }
});

test('live event buffer deduplicates retries, bounds retention, and recovers after restart', () => {
  let now = 100000;
  const hub = new LiveXp({ now: () => now });
  assert.equal(hub.publish('Test_Player', [drop(), drop()]), 1);
  assert.equal(hub.publish('Test Player', [drop()]), 0);
  let result = hub.read(null);
  assert.equal(result.reset, true);
  assert.equal(result.drops.length, 1);
  const after = result.cursor;
  hub.publish('Test Player', [drop({ id: 'second', amount: 70 })]);
  result = hub.read(after);
  assert.equal(result.reset, false);
  assert.equal(result.drops.length, 1);
  assert.equal(result.drops[0].amount, 70);
  assert.equal(hub.read('old-server:5').reset, true);
  for (let i = 0; i < 520; i++) hub.publish('Test Player', [drop({ id: `drop-${i}` })]);
  assert.equal(hub.read(null).drops.length, 500);
  assert.equal(hub.read(after).reset, true);
  now += 300001;
  assert.equal(hub.read(null).drops.length, 0);
});

test('live long poll wakes immediately on a new event and cleans up aborts/timeouts', async () => {
  const hub = new LiveXp({ waitMillis: 10 });
  const controller = new AbortController();
  const after = hub.cursor;
  const pending = hub.poll(after, controller.signal);
  assert.equal(hub.waiters.size, 1);
  hub.publish('Test Player', [drop()]);
  assert.equal((await pending).drops[0].amount, 35);
  assert.equal(hub.waiters.size, 0);
  const abort = hub.poll(hub.cursor, controller.signal);
  controller.abort();
  await abort;
  assert.equal(hub.waiters.size, 0);
  await hub.poll(hub.cursor, new AbortController().signal);
  assert.equal(hub.waiters.size, 0);
  const close = hub.poll(hub.cursor, new AbortController().signal);
  hub.close();
  await close;
  assert.equal(hub.waiters.size, 0);
});

test('member skill summaries and level progress match OSRS thresholds', () => {
  assert.equal(xpAtLevel(1), 0);
  assert.equal(xpAtLevel(2), 83);
  assert.equal(xpAtLevel(99), 13034431);
  assert.equal(levelProgress({ level: 1, xp: 0 }).remaining, 83);
  assert.equal(levelProgress({ level: 1, xp: 83 }).percent, 100);
  assert.deepEqual(levelProgress({ level: 99, xp: 200000000 }), { remaining: 0, percent: 100 });
  assert.equal(combatLevel(Object.fromEntries(SKILLS.map(skill => [skill, { level: 99 }]))), 126);
  for (const skill of SKILLS) {
    const bytes = readFileSync(new URL(`../public/skill-icons/${skill.toLowerCase()}.png`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
});

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'live-xp-'));
  const store = new Store(join(directory, 'state.json'));
  const members = [{ name: 'Test Player', token: 'a'.repeat(48) }, { name: 'Other Player', token: 'b'.repeat(48) }];
  const server = createBridge({ store, members, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(() => { rmSync(directory, { recursive: true, force: true }); resolve(); });
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, token = members[0].token) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { store, call, base };
}

test('HTTP live drops require linked identity, deliver without snapshot polling and never enqueue Discord', async t => {
  const { call, base, store } = await setup(t);
  assert.equal((await fetch(base + '/v1/live-xp')).status, 401);
  assert.equal((await fetch(base + '/v1/xp-drops', { method: 'POST' })).status, 401);
  assert.equal((await call('/v1/xp-drops', batch(), 'b'.repeat(48))).status, 403);
  assert.equal((await call('/v1/xp-drops', batch({ drops: [drop({ amount: -1 })] }))).status, 400);
  const first = await (await call('/v1/live-xp')).json();
  const started = performance.now();
  const waiting = call(`/v1/live-xp?after=${encodeURIComponent(first.cursor)}`).then(response => response.json());
  assert.equal((await call('/v1/xp-drops', batch())).status, 200);
  const received = await waiting;
  assert.ok(performance.now() - started < 1500, 'Drops must not wait for the 10-second snapshot poll');
  assert.equal(received.drops[0].amount, 35);
  assert.equal(received.drops[0].skill, 'MINING');
  assert.equal(received.drops[0].username, 'Test Player');
  assert.equal(store.state.outbox.length, 0);
  assert.equal(store.state.activity.length, 0);
  assert.equal(Object.keys(store.state.xpHistory).length, 0);
  assert.equal((await (await call('/v1/xp-drops', batch())).json()).accepted, 0);
  for (const path of ['/members.js', '/members.css', '/skills.js', '/bank-tooltips.js', '/skill-icons/mining.png']) {
    assert.equal((await fetch(base + path)).status, 200);
  }
  assert.equal((await call('/skill-icons/invalid.png')).status, 404);
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.includes('id="live-xp-status"'), 'Keep an explicit connection status beside the cards');
  assert.ok(!html.includes('id="live-xp-feed"'), 'The separate XP feed panel must be removed');
});

test('live long polls recheck access after waiting and reject revoked keys', async t => {
  const member = { name: 'Test Player', discordId: '123456789012345678' };
  let allowed = true;
  const access = { authenticate: async () => allowed ? member : undefined };
  const { call } = await setup(t, { members: [member], access });
  const initial = await (await call('/v1/live-xp')).json();
  const pending = call(`/v1/live-xp?after=${encodeURIComponent(initial.cursor)}`);
  // Wake the pending read with a valid upload, then revoke before its access recheck.
  let checks = 0;
  access.authenticate = async () => {
    checks++;
    return checks <= 2 ? member : undefined;
  };
  await call('/v1/xp-drops', batch());
  assert.equal((await pending).status, 401);
  allowed = false;
});

test('live long polls recheck stats viewing permission before returning buffered drops', async t => {
  const member = { name: 'Test Player', memberTokenId: 'test-member', permissions: { stats: true } };
  const access = { authenticate: async () => member };
  const { call } = await setup(t, {
    members: [{ name: 'Test Player', discordId: '123456789012345678' }], access,
  });
  const initial = await (await call('/v1/live-xp')).json();
  const pending = call(`/v1/live-xp?after=${encodeURIComponent(initial.cursor)}`);
  let checks = 0;
  access.authenticate = async () => {
    checks++;
    return { ...member, permissions: { stats: checks <= 2 } };
  };
  await call('/v1/xp-drops', batch());
  const response = await pending;
  assert.equal(response.status, 403);
  assert.equal((await response.json()).drops, undefined);
});
