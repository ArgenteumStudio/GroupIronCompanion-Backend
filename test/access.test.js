import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, createBridge } from '../src/bridge.js';
import { DiscordAccess, clearCommand, discordAdmin, discordMemberLookup, discordMembership, linksCommand, validateDiscordMembers, verifyCommand } from '../src/access.js';

const id = '123456789012345678';
const members = [{ name: 'Test Player', discordId: id }];
const header = key => `Bearer ${key}`;
const getKey = content => /```\n([a-f0-9]{64})\n```/.exec(content)[1];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mayo-access-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'state.json'));
  let present = true;
  let time = 0;
  const access = new DiscordAccess({
    store, members, isMember: async () => present, isAdmin: async () => true, now: () => time,
  });
  return { store, access, leave: () => { present = false; }, join: () => { present = true; },
    advance: () => { time += 60000; },
    async issue() {
      let key;
      await access.issue(id, async details => { key = details.key; });
      return key;
    } };
}

test('production allowlist requires unique Discord identities and refuses legacy static tokens', () => {
  validateDiscordMembers(members);
  for (const invalid of [
    [{ ...members[0], discordId: 'not-an-id' }],
    [{ ...members[0], discordId: 123456789012345678 }],
    [{ ...members[0], token: 'a'.repeat(64) }],
    [...members, { name: 'Other', discordId: id }],
    [...members, { name: 'test_player', discordId: '223456789012345678' }],
    [null],
  ]) assert.throws(() => validateDiscordMembers(invalid));
});

test('verification issues a DM-only key, persists only its hash, and works after restart', async t => {
  const f = fixture(t);
  const key = await f.issue();
  assert.equal((await f.access.authenticate(header(key))).discordId, id);
  assert.equal(await f.access.authenticate(header('0'.repeat(64))), undefined);
  assert.equal(await f.access.authenticate(undefined), undefined);
  assert.equal(readFileSync(f.store.file, 'utf8').includes(key), false);
  const reopened = new DiscordAccess({
    store: new Store(f.store.file), members, isMember: async () => true, isAdmin: async () => true,
  });
  assert.equal((await reopened.authenticate(header(key))).discordId, id);
});

test('unapproved and absent members cannot obtain keys; requests are throttled', async t => {
  const f = fixture(t);
  let sent = 0;
  await assert.rejects(f.access.issue('223456789012345678', async () => { sent++; }), /not approved/);
  f.leave();
  await assert.rejects(f.access.issue(id, async () => { sent++; }), /must be in/);
  f.join();
  await assert.rejects(f.issue(), /one minute/);
  f.advance();
  await f.issue();
  assert.equal(sent, 0);
});

test('new key replaces previous key and old keys cannot bypass Discord membership checks', async t => {
  const f = fixture(t);
  const old = await f.issue();
  f.advance();
  const key = await f.issue();
  assert.notEqual(key, old);
  assert.equal(await f.access.authenticate(header(old)), undefined);
  f.leave();
  assert.equal(await f.access.authenticate(header(key)), undefined);
  f.join();
  assert.equal(await f.access.authenticate(header(key)), undefined);
  assert.equal(new Store(f.store.file).state.accessKeys[id], undefined);
});

test('explicit removal revokes access and Discord identity changes invalidate keys', async t => {
  const f = fixture(t);
  const key = await f.issue();
  for (const approved of [
    [{ name: 'Test Player', discordId: '223456789012345678' }],
  ]) {
    const changed = new DiscordAccess({ store: f.store, members: approved, isMember: async () => true, isAdmin: async () => true });
    assert.equal(await changed.authenticate(header(key)), undefined);
  }
  f.access.revoke(id);
  assert.equal(await f.access.authenticate(header(key)), undefined);
});

test('failed DM or disk persistence does not activate a new key or destroy the previous key', async t => {
  const f = fixture(t);
  const key = await f.issue();
  f.advance();
  await assert.rejects(f.access.issue(id, async () => { throw new Error('DM blocked'); }), /DM blocked/);
  assert.equal((await f.access.authenticate(header(key))).discordId, id);
  f.advance();
  f.store.save = () => { throw new Error('Disk full'); };
  await assert.rejects(f.issue(), /Disk full/);
  assert.equal((await f.access.authenticate(header(key))).discordId, id);
});

test('leaving during key delivery cannot activate the delivered key', async t => {
  const f = fixture(t);
  let key;
  await assert.rejects(f.access.issue(id, async details => {
    key = details.key;
    f.leave();
  }), /membership changed/);
  f.join();
  assert.equal(await f.access.authenticate(header(key)), undefined);
});

test('revocation fails closed in memory if persistence fails', async t => {
  const f = fixture(t);
  const key = await f.issue();
  f.store.save = () => { throw new Error('Disk full'); };
  assert.throws(() => f.access.revoke(id), /Disk full/);
  assert.equal(await f.access.authenticate(header(key)), undefined);
});

test('a removal event during an in-flight check cannot authorize the old key', async t => {
  const f = fixture(t);
  const key = await f.issue();
  let finish;
  f.access.isMember = () => new Promise(resolve => { finish = resolve; });
  const result = f.access.authenticate(header(key));
  f.access.revoke(id);
  finish(true);
  assert.equal(await result, undefined);
});

test('fresh membership checks fail closed on disconnect, unavailable guild and Discord errors', async () => {
  let ready = true;
  let error;
  const calls = [];
  const guild = { available: true, members: { async fetch(options) {
    calls.push(options);
    if (error) throw error;
    return {};
  } } };
  const discord = { isReady: () => ready, guilds: { cache: new Map([['guild', guild]]) } };
  const check = discordMembership(discord, 'guild');
  assert.equal(await check(id), true);
  assert.deepEqual(calls[0], { user: id, force: true, cache: false });
  error = Object.assign(new Error('Unknown member'), { code: 10007 });
  assert.equal(await check(id), false);
  error = new Error('Discord unavailable');
  await assert.rejects(check(id), /unavailable/);
  ready = false;
  await assert.rejects(check(id), /disconnected/);
  ready = true;
  guild.available = false;
  await assert.rejects(check(id), /server is unavailable/);
});

test('Discord member lookup shares requests, caches confirmed members and honours invalidation', async () => {
  let clock = 0;
  let calls = 0;
  let absent = false;
  let release;
  let gate = Promise.resolve();
  const member = { permissions: { has: permission => permission === 'ManageGuild' } };
  const guild = { available: true, members: { async fetch() {
    calls++;
    await gate;
    if (absent) throw Object.assign(new Error('Unknown member'), { code: 10007 });
    return member;
  } } };
  const discord = { isReady: () => true, guilds: { cache: new Map([['guild', guild]]) } };
  const lookup = discordMemberLookup(discord, 'guild', { ttlMillis: 30_000, now: () => clock });
  const isMember = discordMembership(discord, 'guild', lookup);
  const isAdmin = discordAdmin(discord, 'guild', lookup);

  gate = new Promise(resolve => { release = resolve; });
  const pending = Promise.all([isMember(id), isAdmin(id), isMember(id)]);
  release();
  assert.deepEqual(await pending, [true, true, true]);
  assert.equal(calls, 1, 'concurrent checks share one Discord request');
  assert.equal(await isAdmin(id), true);
  assert.equal(calls, 1, 'confirmed members are served from cache');

  clock = 30_000;
  assert.equal(await isMember(id), true);
  assert.equal(calls, 2, 'cache expires after the TTL');

  lookup.invalidate(id);
  absent = true;
  assert.equal(await isMember(id), false);
  assert.equal(await isMember(id), false);
  assert.equal(calls, 4, 'absent members are not cached');

  absent = false;
  gate = new Promise(resolve => { release = resolve; });
  const stale = isMember(id);
  lookup.invalidate(id);
  release();
  assert.equal(await stale, true);
  assert.equal(await isMember(id), true);
  assert.equal(calls, 6, 'a lookup invalidated while in flight is not cached');
});

test('bot responds publicly without exposing the key or sensitive Discord error payloads', async t => {
  const f = fixture(t);
  const dms = [];
  const replies = [];
  const logs = [];
  const message = {
    content: '!verify', author: { id, async send(body) { dms.push(body); } },
    async reply(body) { replies.push(body); },
  };
  const logger = { error(...args) { logs.push(args); } };
  assert.equal(await verifyCommand(message, f.access, logger), true);
  assert.equal(dms.length, 1);
  const dmKey = getKey(dms[0].embeds[0].description);
  assert.ok(dms[0].embeds[0].description.includes('Test Player'));
  assert.equal(JSON.stringify(replies).includes(dmKey), false);
  assert.match(replies[0].embeds[0].title, /Verification complete/);
  assert.equal(replies[0].content, undefined);
  f.advance();
  message.author.send = async () => {
    throw Object.assign(new Error('DM failed'), { code: 50007, requestBody: { content: 'SECRET' } });
  };
  await verifyCommand(message, f.access, logger);
  assert.match(replies.at(-1).embeds[0].description, /Direct Messages/);
  assert.equal(JSON.stringify(replies).includes("SECRET"), false);
  assert.equal(JSON.stringify(logs).includes('SECRET'), false);
  message.content = '!stats Test Player';
  assert.equal(await verifyCommand(message, f.access, logger), false);
});

test('all private API surfaces require Discord-verified credentials and fail closed on outages', async t => {
  const f = fixture(t);
  const key = await f.issue();
  const server = createBridge({ store: f.store, members, access: f.access, logger: { error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/v1/group`, { headers: { Authorization: header(key) } })).status, 200);
  assert.equal((await fetch(`${base}/v1/xp`, { headers: { Authorization: header(key) } })).status, 200);
  assert.equal((await fetch(`${base}/v1/events`, {
    method: 'POST', headers: { Authorization: header(key) },
    body: JSON.stringify({ username: 'Test Player', id: 'verified-kill', type: 'boss', boss: 'Zulrah', kc: 1 }),
  })).status, 200);
  assert.equal((await fetch(`${base}/v1/icons`, {
    method: 'POST', headers: { Authorization: header(key) },
    body: JSON.stringify({ username: 'Other Player', icons: {} }),
  })).status, 403);
  f.access.isMember = async () => { throw new Error('Offline'); };
  assert.equal((await fetch(`${base}/v1/group`, { headers: { Authorization: header(key) } })).status, 503);
  f.access.isMember = async () => false;
  for (const [path, method] of [
    ['/v1/group', 'GET'], ['/v1/xp', 'GET'], ['/v1/snapshot', 'POST'],
    ['/v1/events', 'POST'], ['/v1/icons', 'POST'],
  ]) {
    assert.equal((await fetch(base + path, { method, headers: { Authorization: header(key) } })).status, 401);
  }
});

test('characters auto-link on first sync, alts are capped, and names cannot be taken from another member', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mayo-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const otherId = '223456789012345678';
  const group = [{ discordId: id }, { name: 'Owned Name', discordId: otherId }];
  const store = new Store(join(dir, 'state.json'));
  const access = new DiscordAccess({ store, members: group, isMember: async () => true, isAdmin: async () => true });
  let key;
  await access.issue(id, async details => {
    key = details.key;
    assert.deepEqual(details.characters, []);
  });
  const server = createBridge({ store, members: group, access, logger: { error() {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (username, n = 0) => {
    const response = await fetch(`${base}/v1/events`, {
      method: 'POST', headers: { Authorization: header(key) },
      body: JSON.stringify({ username, id: `kill-${username}-${n}`, type: 'boss', boss: 'Zulrah', kc: 1 }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await post('Main Char')).status, 200);
  assert.equal((await post('main_char', 1)).status, 200);
  assert.equal((await post('Alt One')).status, 200);
  const taken = await post('owned name');
  assert.equal(taken.status, 403);
  assert.match(taken.body.error, /another group member/);
  for (const name of ['Alt Two', 'Alt Three', 'Alt Four']) assert.equal((await post(name)).status, 200);
  const full = await post('Alt Five');
  assert.equal(full.status, 403);
  assert.match(full.body.error, /5 characters linked/);
  assert.deepEqual(new Store(store.file).state.links[id], ['Main Char', 'Alt One', 'Alt Two', 'Alt Three', 'Alt Four']);
  const me = await (await fetch(`${base}/v1/me`, { headers: { Authorization: header(key) } })).json();
  assert.equal(me.characters.length, 5);
  const groupView = await (await fetch(`${base}/v1/group`, { headers: { Authorization: header(key) } })).json();
  assert.equal(groupView.activity.length, 6);

  const replies = [];
  const command = (content, authorId = id) => linksCommand({
    content, author: { id: authorId }, async reply(body) { replies.push(body.embeds[0]); },
  }, access, { error() {} });
  assert.equal(await command('!stats Main Char'), false);
  await command('!characters');
  assert.match(replies.at(-1).description, /Alt Four[\s\S]*5 \/ 5/);
  await command('!unlink Owned Name');
  assert.match(replies.at(-1).title, /Set by the owner/);
  await command('!unlink alt_four');
  assert.match(replies.at(-1).title, /Character unlinked/);
  await command('!unlink Alt Three', otherId);
  assert.match(replies.at(-1).title, /Character unlinked/);
  await command('!unlink Owned Name', otherId);
  assert.match(replies.at(-1).title, /Set by the owner/);
  assert.equal((await post('Alt Five')).status, 200);
});
test('!clear deletes only the bot messages in allowed channels for admins', async t => {
  const BOT = '999999999999999999';
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  const make = (n, author, age) => ({ id: String(1000 - n), author: { id: author }, createdTimestamp: now - age,
    deleted: false, async delete() { this.deleted = true; } });
  const history = [make(1, BOT, DAY), make(2, id, DAY), make(3, BOT, DAY), make(4, BOT, 30 * DAY), make(5, BOT, DAY)];
  const bulk = [];
  const sent = [];
  const channel = {
    messages: { async fetch({ before }) {
      const page = history.filter(value => Number(value.id) < Number(before));
      const map = new Map(page.map(value => [value.id, value]));
      map.last = () => page.at(-1);
      return map;
    } },
    async bulkDelete(ids) { bulk.push(...ids); for (const value of history) if (ids.includes(value.id)) value.deleted = true; return { size: ids.length }; },
    async send(reply) { sent.push(reply); return { delete: async () => {} }; },
  };
  const replies = [];
  const command = (content, isAdmin = true, channelId = 'alerts') => clearCommand({
    content, channelId, channel, author: { id }, id: '1000',
    delete: async () => {}, reply: async value => { replies.push(value); },
  }, { members, isAdmin: async () => isAdmin }, { channelIds: new Set(['alerts']), botId: BOT, now: () => now, confirmMillis: 0, logger: { log() {}, error: (...args) => assert.fail(args.join(' ')) } });

  assert.equal(await command('!clearall'), false);
  assert.equal(await command('!clear', true, 'general'), false);
  assert.equal(await command('!clear', false), true);
  assert.match(replies[0].embeds[0].data?.title ?? JSON.stringify(replies[0]), /Not allowed/);
  assert.equal(history.some(value => value.deleted), false);

  assert.equal(await command('!clear 2'), true);
  assert.deepEqual(bulk, ['999', '997']);
  assert.equal(history[1].deleted, false);
  assert.equal(history[3].deleted, false);

  assert.equal(await command('!clear all'), true);
  assert.equal(history.filter(value => value.author.id === BOT).every(value => value.deleted), true);
  assert.equal(history[1].deleted, false);
  assert.match(JSON.stringify(sent.at(-1)), /Removed \*\*/);
});
