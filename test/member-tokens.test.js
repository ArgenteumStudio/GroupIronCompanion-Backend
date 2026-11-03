import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, createBridge, allCharacters } from '../src/bridge.js';
import { DiscordAccess } from '../src/access.js';
import { SKILLS } from '../public/skills.js';
import { DEFAULT_PERMISSIONS } from '../src/permissions.js';

const ownerId = '123456789012345678';
const readerId = '223456789012345678';
const header = key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'member-tokens-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'state.json'));
  const members = [{ name: 'Owner', discordId: ownerId }, { name: 'Reader', discordId: readerId }];
  const checks = [];
  let present = true, admin = true;
  const access = new DiscordAccess({
    store, members,
    isMember: async id => { checks.push(id); return present; },
    isAdmin: async id => admin && id === ownerId,
  });
  let ownerKey, readerKey;
  await access.issue(ownerId, async details => { ownerKey = details.key; });
  store.state.accessKeys ??= {};
  return { store, members, access, owner: members[0], ownerKey, readerKey, checks,
    leave: () => { present = false; }, demote: () => { admin = false; } };
}
async function http(t, f) {
  const server = createBridge({ store: f.store, members: f.members, access: f.access, logger: { error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, key = f.ownerKey, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: header(key),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
}
const snapshot = name => ({
  username: name, observedAt: Date.now(), position: null, bankShared: false, bank: null,
  stats: Object.fromEntries(SKILLS.map(skill => [skill, { level: 50, xp: 101333 }])),
});

test('owner generates unique hashed member keys without member Discord; tokens remain valid after restart', async t => {
  const f = await fixture(t);
  const created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
  assert.match(created.key, /^[a-f0-9]{64}$/);
  assert.equal(created.name, 'Iron Ada');
  const auth = await f.access.authenticate(header(created.key).Authorization);
  assert.equal(auth.name, 'Iron Ada');
  assert.equal(auth.memberTokenId, created.id);
  assert.equal(auth.role, 'member');
  assert.deepEqual(auth.permissions, DEFAULT_PERMISSIONS);
  assert.equal(await f.access.isAdmin(auth), false);
  assert.ok(f.checks.every(id => [ownerId, readerId].includes(id)), 'No member Discord identity is needed');
  assert.equal(readFileSync(f.store.file, 'utf8').includes(created.key), false);
  assert.equal(JSON.stringify(f.access.listMemberTokens()).includes(created.key), false);
  assert.equal(JSON.stringify(f.access.listMemberTokens()).includes('hash'), false);
  const restarted = new DiscordAccess({ store: new Store(f.store.file), members: f.members,
    isMember: async () => true, isAdmin: async () => true });
  assert.equal((await restarted.authenticate(header(created.key).Authorization)).name, 'Iron Ada');
  assert.ok(allCharacters(f.store, f.members).includes('Iron Ada'));
});

test('member key reads group but can upload only its assigned character and never administer tokens/settings', async t => {
  const f = await fixture(t), call = await http(t, f);
  assert.equal((await call('/v1/member-tokens', undefined, 'POST', { name: 'Iron Ada' })).status, 201);
  const generated = await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Rune Rook' });
  const { key, id } = generated.body;
  assert.equal(generated.status, 201);
  assert.equal((await call('/v1/group', key)).status, 200);
  const me = await call('/v1/me', key);
  assert.equal(me.body.admin, false);
  assert.deepEqual(me.body.characters, ['Rune Rook']);
  assert.equal((await call('/v1/snapshot', key, 'POST', snapshot('Rune_Rook'))).status, 200);
  assert.equal((await call('/v1/snapshot', key, 'POST', snapshot('Wrong Char'))).status, 403);
  for (const [path, method, body] of [
    ['/v1/settings', 'GET'], ['/v1/settings', 'PUT', { settings: {} }],
    ['/v1/member-tokens', 'GET'], ['/v1/member-tokens', 'POST', { name: 'Intruder' }],
    [`/v1/member-tokens/${id}`, 'PUT', {}], [`/v1/member-tokens/${id}`, 'DELETE'],
  ]) assert.equal((await call(path, key, method, body)).status, 403);
  assert.equal((await call('/v1/member-tokens', 'f'.repeat(64))).status, 401);
  assert.equal((await call('/v1/member-tokens', '0'.repeat(64))).status, 401);
  const listing = await call('/v1/member-tokens');
  assert.equal(listing.body.tokens.length, 2);
  assert.equal(JSON.stringify(listing).includes(key), false);
  assert.equal((await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'rune_rook' })).status, 400);
  assert.equal((await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Owner' })).status, 400);
  assert.equal((await call('/v1/member-tokens', f.ownerKey, 'POST', { name: '<script>' })).status, 400);
  const replacement = await call(`/v1/member-tokens/${id}`, f.ownerKey, 'PUT', { name: 'Cannot Rename' });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.name, 'Rune Rook');
  assert.equal((await call('/v1/group', key)).status, 401);
  assert.equal((await call('/v1/group', replacement.body.key)).status, 200);
  assert.equal((await call(`/v1/member-tokens/${id}`, f.ownerKey, 'DELETE')).status, 200);
  assert.equal((await call('/v1/group', replacement.body.key)).status, 401);
  const group = await call('/v1/group');
  assert.equal(group.body.members.length, 0, 'Revoked character is no longer an authorized group identity');
});

test('member-token authentication fails closed on owner departure, demotion, removal and Discord outage', async t => {
  for (const mode of ['leave', 'demote', 'remove', 'outage']) {
    const f = await fixture(t), created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
    if (mode === 'leave') f.leave();
    if (mode === 'demote') f.demote();
    if (mode === 'remove') f.members.shift();
    if (mode === 'outage') f.access.isMember = async () => { throw new Error('Discord unavailable'); };
    if (mode === 'outage') await assert.rejects(f.access.authenticate(header(created.key).Authorization), /Discord unavailable/);
    else assert.equal(await f.access.authenticate(header(created.key).Authorization), undefined);
  }
});

test('revocation and replacement invalidate in-flight authentication; persistence failures never return usable new keys', async t => {
  const f = await fixture(t);
  let created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
  let finish;
  const membership = f.access.isMember;
  f.access.isMember = () => new Promise(resolve => { finish = resolve; });
  const inFlight = f.access.authenticate(header(created.key).Authorization);
  f.access.removeMemberToken(created.id);
  finish(true);
  assert.equal(await inFlight, undefined);
  f.access.isMember = membership;
  created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
  f.store.save = () => { throw new Error('Disk unavailable'); };
  await assert.rejects(f.access.issueMemberToken(f.owner, 'Alt'), /Disk unavailable/);
  await assert.rejects(f.access.issueMemberToken(f.owner, undefined, created.id), /Disk unavailable/);
  assert.ok(await f.access.authenticate(header(created.key).Authorization), 'Failed replacement preserves original working key');
  assert.throws(() => f.access.removeMemberToken(created.id), /Disk unavailable/);
  assert.equal(await f.access.authenticate(header(created.key).Authorization), undefined, 'Failed revoke still denies current-process access');
});

test('owner revocation cascades to issued member keys and persists across restart', async t => {
  const f = await fixture(t), created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
  f.access.revoke(ownerId);
  assert.equal(await f.access.authenticate(header(created.key).Authorization), undefined);
  assert.equal(new Store(f.store.file).state.memberTokens[created.id], undefined);
  assert.equal(f.store.state.accessKeys[ownerId], undefined);
});

test('non-owner Discord verification and legacy keys cannot bypass member viewing permissions', async t => {
  const f = await fixture(t);
  let delivered = false;
  await assert.rejects(f.access.issue(readerId, async () => { delivered = true; }), /Only the configured group owner/);
  assert.equal(delivered, false);
  const created = await f.access.issueMemberToken(f.owner, 'Iron Ada');
  f.demote();
  assert.equal(await f.access.authenticate(header(f.ownerKey).Authorization), undefined);
  assert.equal(await f.access.authenticate(header(created.key).Authorization), undefined);
  assert.equal(f.store.state.accessKeys[ownerId], undefined);
  assert.equal(f.store.state.memberTokens[created.id], undefined);
});

test('owner permission loss or revocation during DM delivery cannot activate an unrestricted owner key', async t => {
  for (const action of ['demote', 'revoke']) {
    const f = await fixture(t);
    f.access.lastAttempt.clear();
    let sent;
    await assert.rejects(f.access.issue(ownerId, async ({ key }) => {
      sent = key;
      if (action === 'demote') f.demote();
      else f.access.revoke(ownerId);
    }), /membership changed/);
    assert.equal(await f.access.authenticate(header(sent).Authorization), undefined);
  }
});

test('owner can promote/demote managers; managers administer regular members only and cannot escalate access', async t => {
  const f = await fixture(t), call = await http(t, f);
  const manager = (await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Manager' })).body;
  const otherManager = (await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Manager Two' })).body;
  const regular = (await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Regular' })).body;
  for (const id of [manager.id, otherManager.id]) {
    assert.equal((await call(`/v1/member-tokens/${id}`, f.ownerKey, 'PATCH', { role: 'manager' })).status, 200);
  }
  const me = (await call('/v1/me', manager.key)).body;
  assert.equal(me.role, 'manager');
  assert.equal(me.admin, false);
  assert.equal(me.canManageGroup, true);
  assert.equal((await call('/v1/settings', manager.key)).status, 403);
  assert.equal((await call('/v1/member-tokens', manager.key)).status, 200);
  const invited = await call('/v1/member-tokens', manager.key, 'POST', { name: 'Invited' });
  assert.equal(invited.status, 201);
  for (const target of [manager.id, otherManager.id]) {
    for (const [method, body] of [['PUT', {}], ['DELETE'], ['PATCH', { permissions: DEFAULT_PERMISSIONS }]]) {
      assert.equal((await call(`/v1/member-tokens/${target}`, manager.key, method, body)).status, 400);
    }
  }
  assert.equal((await call(`/v1/member-tokens/${regular.id}`, manager.key, 'PATCH', { role: 'manager' })).status, 400);
  const limited = { ...DEFAULT_PERMISSIONS, banks: false, locations: false };
  assert.equal((await call(`/v1/member-tokens/${manager.id}`, f.ownerKey, 'PATCH', { permissions: limited })).status, 200);
  assert.equal((await call(`/v1/member-tokens/${regular.id}`, manager.key, 'PUT', {})).status, 400,
    'Manager cannot retrieve a token with broader access');
  assert.equal((await call(`/v1/member-tokens/${regular.id}`, manager.key, 'PATCH', { permissions: DEFAULT_PERMISSIONS })).status, 400);
  assert.equal((await call(`/v1/member-tokens/${regular.id}`, manager.key, 'PATCH', { permissions: limited })).status, 200);
  assert.equal((await call(`/v1/member-tokens/${regular.id}`, manager.key, 'PUT', {})).status, 200);
  const limitedInvite = await call('/v1/member-tokens', manager.key, 'POST', { name: 'Limited' });
  assert.equal(limitedInvite.status, 201);
  assert.deepEqual((await call('/v1/me', limitedInvite.body.key)).body.permissions, limited);
  assert.equal((await call(`/v1/member-tokens/${invited.body.id}`, manager.key, 'DELETE')).status, 200);
  assert.equal((await call(`/v1/member-tokens/${manager.id}`, f.ownerKey, 'PATCH', { role: 'member' })).status, 200);
  assert.equal((await call('/v1/member-tokens', manager.key)).status, 403);
  assert.equal((await call('/v1/group', manager.key)).status, 200, 'Demotion does not kick the member');
  assert.equal((await call(`/v1/member-tokens/${'0'.repeat(32)}`, f.ownerKey, 'DELETE')).status, 400, 'Owner is not a member-token row that managers can remove');
});

test('each viewing permission is server enforced across snapshots, icons, activity and XP; upload consent stays independent', async t => {
  const f = await fixture(t), call = await http(t, f);
  const generated = (await call('/v1/member-tokens', f.ownerKey, 'POST', { name: 'Iron Ada' })).body;
  f.store.snapshot({ ...snapshot('Iron Ada'), bankShared: true,
    bank: [{ id: 385, qty: 100, name: 'Personal secret' }], bankUpdatedAt: Date.now() - 10,
    groupStorage: [{ id: 554, qty: 500, name: 'Storage secret' }], groupStorageUpdatedAt: Date.now() - 10,
    position: { x: 3200, y: 3200, plane: 0, world: 444 }, questPoints: 123 });
  f.store.event({ username: 'Iron Ada', id: 'secret-chat', type: 'chat', message: 'Activity secret' });
  const png = readFileSync(new URL('../public/demo-icons/385.png', import.meta.url)).toString('base64');
  f.store.saveIcons({ 385: png, 554: png });
  for (const key of Object.keys(DEFAULT_PERMISSIONS)) {
    const permissions = { ...DEFAULT_PERMISSIONS, [key]: false };
    assert.equal((await call(`/v1/member-tokens/${generated.id}`, f.ownerKey, 'PATCH', { permissions })).status, 200);
    const response = await call('/v1/group', generated.key);
    assert.equal(response.status, 200);
    const group = response.body, member = group.members[0];
    assert.deepEqual(group.viewer.permissions, permissions);
    assert.equal(member.bank === null, key === 'banks');
    assert.equal(group.groupStorage === null, key === 'storage');
    assert.equal(Object.hasOwn(group.icons, '385'), key !== 'banks');
    assert.equal(Object.hasOwn(group.icons, '554'), key !== 'storage');
    assert.equal(Object.hasOwn(member, 'stats'), key !== 'stats');
    assert.equal(Object.hasOwn(member, 'questPoints'), key !== 'stats');
    assert.equal(member.position === null, key === 'locations');
    assert.equal(group.activity.length === 0, key === 'activity');
    assert.equal(Object.hasOwn(member, 'groupStorage'), false, 'Raw per-publisher storage must never leak around storage permission');
    assert.equal((await call('/v1/xp', generated.key)).status, key === 'stats' ? 403 : 200);
    if (key === 'stats') assert.equal((await call('/v1/live-xp', generated.key)).status, 403);
  }
  const none = Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(key => [key, false]));
  assert.equal((await call(`/v1/member-tokens/${generated.id}`, f.ownerKey, 'PATCH', { permissions: none })).status, 200);
  const locked = await call('/v1/group', generated.key);
  assert.equal(locked.body.members[0].bank, null);
  assert.deepEqual(locked.body.icons, {});
  assert.deepEqual(locked.body.activity, []);
  assert.equal((await call('/v1/snapshot', generated.key, 'POST', snapshot('Iron Ada'))).status, 200,
    'Viewing restrictions do not silently override the player-selected upload consent');
  for (const invalid of [{ permissions: {} }, { role: 'owner' }, { permissions: { ...none, banks: 'true' } }, { hash: 'bad' }]) {
    assert.equal((await call(`/v1/member-tokens/${generated.id}`, f.ownerKey, 'PATCH', invalid)).status, 400);
  }
});
