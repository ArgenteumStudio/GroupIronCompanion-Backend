import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge, Store, validSnapshot } from '../src/bridge.js';
import { SKILLS } from '../public/skills.js';
const item = { id: 385, name: 'Raw shark', qty: 100, price: 1000, highAlch: 50 };
const snapshot = (changes = {}) => ({
  username: 'Player One', stats: Object.fromEntries(SKILLS.map(skill => [skill, { level: 50, xp: 101333 }])),
  observedAt: Date.now(), position: null, bankShared: true, bank: null,
  groupStorage: [item], groupStorageUpdatedAt: Date.now() - 10, ...changes,
});
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'shared-bank-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new Store(join(dir, 'state.json'));
}
test('group storage validates independently, accepts empty storage and legacy clients, rejects invalid prices and age', () => {
  assert.equal(validSnapshot(snapshot()), true);
  assert.equal(validSnapshot(snapshot({ groupStorage: [] })), true);
  assert.equal(validSnapshot(snapshot({ groupStorage: null })), true);
  for (const change of [{ groupStorageUpdatedAt: -1 }, { groupStorageUpdatedAt: Date.now() + 100000 },
    { groupStorage: [{ ...item, highAlch: -1 }] }, { groupStorage: [{ ...item, price: '100' }] },
    { groupStorage: [null] }]) assert.equal(validSnapshot(snapshot(change)), false);
});
test('storage persistence preserves capture time, ignores older captures and clears the uploader on opt-out', t => {
  const store = setup(t), body = snapshot();
  store.snapshot(body);
  store.snapshot(snapshot({ observedAt: body.observedAt + 1, groupStorage: null }));
  assert.equal(store.state.members['player one'].groupStorageUpdatedAt, body.groupStorageUpdatedAt);
  store.snapshot(snapshot({ observedAt: body.observedAt + 2, groupStorage: [], groupStorageUpdatedAt: body.groupStorageUpdatedAt - 1 }));
  assert.equal(store.state.members['player one'].groupStorage.length, 1);
  const loaded = new Store(store.file);
  assert.equal(loaded.state.members['player one'].groupStorage[0].highAlch, 50);
  loaded.snapshot(snapshot({ observedAt: body.observedAt + 3, bankShared: false }));
  assert.equal(loaded.state.members['player one'].groupStorage, null);
});
test('failed storage persistence rolls back the full snapshot and XP history', t => {
  const store = setup(t), first = snapshot();
  store.snapshot(first);
  const previous = structuredClone(store.state);
  store.save = () => { throw new Error('Disk unavailable'); };
  assert.throws(() => store.snapshot(snapshot({ observedAt: first.observedAt + 1,
    groupStorage: [], groupStorageUpdatedAt: first.groupStorageUpdatedAt + 1 })), /Disk unavailable/);
  assert.deepEqual(store.state, previous);
});
test('HTTP returns one latest authorized shared snapshot, not duplicate contents, and permits its item icons only', async t => {
  const store = setup(t);
  const members = [{ name: 'Player One', token: 'a'.repeat(64) }, { name: 'Player Two', token: 'b'.repeat(64) }];
  const server = createBridge({ store, members });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, token = members[0].token) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const first = snapshot();
  assert.equal((await call('/v1/snapshot', first)).status, 200);
  const second = snapshot({ username: 'Player Two', groupStorage: [], groupStorageUpdatedAt: first.groupStorageUpdatedAt + 1 });
  assert.equal((await call('/v1/snapshot', second, members[1].token)).status, 200);
  let group = await (await call('/v1/group')).json();
  assert.equal(group.groupStorage.username, 'Player Two');
  assert.deepEqual(group.groupStorage.items, [], 'Empty latest storage replaces an older nonempty snapshot');
  const png = readFileSync(new URL('../public/demo-icons/385.png', import.meta.url)).toString('base64');
  assert.equal((await call('/v1/icons', { username: 'Player One', icons: { 385: png } })).status, 200);
  assert.equal((await call('/v1/icons', { username: 'Player Two', icons: { 385: png } }, members[1].token)).status, 403);
  members.pop();
  group = await (await call('/v1/group')).json();
  assert.equal(group.groupStorage.username, 'Player One', 'Unlinked uploaders must not be used');
  assert.equal(group.groupStorage.items.length, 1);
  for (const path of ['/bank-info.js', '/tab-session.js']) assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await fetch(base + '/v1/group')).status, 401);
});
