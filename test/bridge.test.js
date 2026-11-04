import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderStatsCard, withStatsCard } from '../src/statsCard.js';
import { renderKcCard, withKcCards } from '../src/kcCard.js';
import { bossName, bossIconUrl } from '../src/bosses.js';
import { BRAND, Store, createBridge, validSnapshot, validEvent, validIcons, formatEvent, statsReply, kcReply, deliverPending, validateMembers, alertChannelIds, validateSkillEmojis, combatLevel } from '../src/bridge.js';

const sharkPng = readFileSync(new URL('../public/demo-icons/385.png', import.meta.url)).toString('base64');

const members = [{ name: 'Test Player', token: 'a'.repeat(48) }, { name: 'Other Player', token: 'b'.repeat(48) }];
const skillNames = ['ATTACK', 'DEFENCE', 'STRENGTH', 'HITPOINTS', 'RANGED', 'PRAYER', 'MAGIC',
  'COOKING', 'WOODCUTTING', 'FLETCHING', 'FISHING', 'FIREMAKING', 'CRAFTING', 'SMITHING',
  'MINING', 'HERBLORE', 'AGILITY', 'THIEVING', 'SLAYER', 'FARMING', 'RUNECRAFT', 'HUNTER', 'CONSTRUCTION'];
const snapshot = () => ({
  username: 'Test Player', stats: Object.fromEntries(skillNames.map(name => [name, { level: 99, xp: 13034431 }])),
  position: { x: 3200, y: 3200, plane: 0, world: 444 }, observedAt: Date.now(),
  bankShared: true, bank: [{ id: 385, qty: 100, name: 'Shark' }], bankUpdatedAt: Date.now() - 600000,
});
const event = (type = 'boss', id = 'test') => ({
  id, username: 'Test Player', type, boss: 'Zulrah', kc: 127,
  source: 'Zulrah', items: [{ id: 12922, name: 'Tanzanite fang', qty: 1 }],
  quest: 'Dragon Slayer I', message: 'Hello @everyone',
});

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bowlsofmayo-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new Store(join(dir, 'state.json'));
}

test('snapshot validates all stats, positions, item quantities and age', () => {
  assert.equal(validSnapshot(snapshot()), true);
  for (const change of [
    { stats: { ATTACK: { level: 99, xp: 1 } } }, { position: { x: -1 } },
    { bank: [{ id: 385, qty: -1, name: 'Shark' }] }, { observedAt: Date.now() - 400000 },
    { observedAt: Date.now() + 120000 }, { bankShared: undefined }, { bank: [null] },
  ]) assert.equal(validSnapshot({ ...snapshot(), ...change }), false);
  assert.equal(validSnapshot({ ...snapshot(), bank: null, position: null }), true);
});

test('bank timestamps persist across polls/relog and disabling sharing removes contents', t => {
  const store = temporary(t);
  const body = snapshot();
  store.snapshot(body);
  store.snapshot({ ...snapshot(), observedAt: body.observedAt + 1, bank: null });
  assert.equal(store.state.members['test player'].bankUpdatedAt, body.bankUpdatedAt);
  assert.equal(store.state.members['test player'].bank[0].name, 'Shark');
  store.snapshot({ ...snapshot(), observedAt: body.observedAt + 2, bank: null, bankShared: false });
  assert.equal(store.state.members['test player'].bank, null);
  const reopened = new Store(store.file);
  assert.equal(reopened.state.members['test player'].bank, null);
});

test('all four events validate and format without Discord mentions', () => {
  for (const type of ['boss', 'loot', 'quest', 'chat']) {
    assert.equal(validEvent(event(type)), true);
    assert.ok(formatEvent(event(type)).includes('Test Player'));
  }
  assert.match(formatEvent(event()), /127/);
  assert.match(formatEvent(event('loot')), /Tanzanite fang/);
  assert.match(formatEvent(event('quest')), /Dragon Slayer I/);
  assert.equal(formatEvent(event('chat')).includes('@everyone'), false);
  assert.equal(validEvent({ ...event(), kc: -1 }), false);
  assert.equal(validEvent({ ...event('chat'), message: '' }), false);
  assert.equal(validEvent({ ...event('loot'), items: [] }), false);
  assert.equal(validEvent({ ...event(), type: 'unknown' }), false);
  assert.equal(validEvent({ ...event('loot'), kc: null }), true);
});

test('XP history survives restart and ignores out-of-order snapshots', t => {
  const store = temporary(t);
  const first = snapshot();
  store.snapshot(first);
  const second = { ...first, stats: { ...first.stats, ATTACK: { level: 99, xp: first.stats.ATTACK.xp + 1234 } },
    observedAt: first.observedAt + 1000 };
  store.snapshot(second);
  store.snapshot(first);
  const restarted = new Store(store.file);
  assert.equal(restarted.state.xpHistory['test player'].points.at(-1).gained, 1234);
  assert.equal(restarted.state.members['test player'].updatedAt, second.observedAt);
});

test('existing pre-graph state starts history without backfilling account XP', t => {
  const store = temporary(t);
  const first = snapshot();
  writeFileSync(store.file, JSON.stringify({
    version: 1, members: { 'test player': { ...first, updatedAt: first.observedAt } },
    seen: {}, outbox: [], activity: [],
  }));
  const migrated = new Store(store.file);
  migrated.snapshot({ ...first, observedAt: first.observedAt + 1000 });
  assert.equal(migrated.state.xpHistory['test player'].points.length, 1);
  assert.equal(migrated.state.xpHistory['test player'].points[0].gained, 0);
});

test('events are persistent and deduplicated; failed Discord delivery remains queued', async t => {
  const store = temporary(t);
  assert.equal(store.event(event()), true);
  assert.equal(store.event(event()), false);
  assert.equal(new Store(store.file).state.outbox.length, 1);
  await assert.rejects(deliverPending(store, async () => { throw new Error('Offline'); }), /Offline/);
  assert.equal(store.state.outbox.length, 1);
  const sent = [];
  await deliverPending(store, async text => sent.push(text));
  assert.equal(sent.length, 1);
  assert.equal(new Store(store.file).state.outbox.length, 0);
  assert.equal(store.state.activity.length, 1);
});

test('persistence failures do not acknowledge or deduplicate lost events', t => {
  const store = temporary(t);
  const save = store.save.bind(store);
  store.save = () => { throw new Error('Disk full'); };
  assert.throws(() => store.event(event()), /Disk full/);
  assert.equal(store.state.outbox.length, 0);
  assert.equal(Object.keys(store.state.seen).length, 0);
  assert.equal(store.state.activity.length, 0);
  assert.throws(() => store.snapshot(snapshot()), /Disk full/);
  assert.equal(Object.keys(store.state.members).length, 0);
  assert.equal(Object.keys(store.state.xpHistory).length, 0);
  store.save = save;
  assert.equal(store.event(event()), true);
});

test('Discord acknowledgement persistence failure keeps event queued for retry', async t => {
  const store = temporary(t);
  store.event(event());
  store.save = () => { throw new Error('Disk full'); };
  await assert.rejects(deliverPending(store, async () => {}), /Disk full/);
  assert.equal(store.state.outbox.length, 1);
});

test('alert types route to their own channels and blank settings fall back to the main channel', async t => {
  const main = '11111111111111111';
  assert.deepEqual(alertChannelIds({ DISCORD_CHANNEL_ID: main }),
    { loot: main, boss: main, quest: main, diary: main, chat: main });
  assert.deepEqual(alertChannelIds({
    DISCORD_CHANNEL_ID: main, DISCORD_DROPS_CHANNEL_ID: ' 22222222222222222 ',
    DISCORD_KILLS_CHANNEL_ID: '33333333333333333', DISCORD_QUESTS_CHANNEL_ID: '44444444444444444',
  }), { loot: '22222222222222222', boss: '33333333333333333', quest: '44444444444444444', diary: '44444444444444444', chat: main });
  assert.throws(() => alertChannelIds({ DISCORD_CHANNEL_ID: main, DISCORD_DROPS_CHANNEL_ID: '#drops' }),
    /DISCORD_DROPS_CHANNEL_ID/);
  assert.throws(() => alertChannelIds({}), /DISCORD_CHANNEL_ID/);
  const store = temporary(t);
  store.event(event());
  const sent = [];
  await deliverPending(store, async (text, queued) => sent.push(queued.type));
  assert.deepEqual(sent, [event().type]);
});

test('!stats supports names with spaces and underscores, reports last sync and stays group-only', async t => {
  const store = temporary(t);
  store.snapshot(snapshot());
  const names = members.map(member => member.name);
  const reply = statsReply('!stats Test_Player', store.state, names);
  const [embed] = reply.embeds;
  const field = (fields, label) => fields.find(value => value.name.includes(label))?.value;
  assert.equal(embed.title, 'Test Player');
  assert.equal(field(embed.fields, 'Total Level'), '`\u20022,277\u2002`');
  assert.equal(field(embed.fields, 'Combat Level'), '`\u2002126\u2002`');
  assert.equal(field(embed.fields, 'Total Experience'), '`\u2002299,791,913\u2002`');
  assert.match(field(embed.fields, 'Last Synced'), /^<t:\d+:R>$/);
  assert.equal(field(embed.fields, 'Quest Points'), '`\u2002—\u2002`');
  assert.match(field(embed.fields, 'Skills at 99'), /\/ \d+/);
  assert.equal(embed.footer.text, BRAND);
  assert.ok(embed.timestamp);
  assert.equal(embed.fields.length, 9);
  assert.ok(embed.fields.every(value => value.inline));
  const skillColumns = embed.fields.slice(6);
  assert.equal(skillColumns[0].value.split('\n')[0], '⚔️ **99**');
  assert.equal(skillColumns[1].value.split('\n')[0], '❤️ **99**');
  store.snapshot({ ...snapshot(), questPoints: 40, observedAt: Date.now() + 1 });
  const withQp = statsReply('!stats Test_Player', store.state, names);
  assert.equal(field(withQp.embeds[0].fields, 'Quest Points'), '`\u200240\u2002`');
  assert.equal(withQp.card.questPoints, 40);
  assert.equal(validSnapshot({ ...snapshot(), questPoints: -1 }), false);
  const custom = statsReply('!stats Test_Player', store.state, names, { ATTACK: '<:attack:123456789012345678>' });
  assert.match(custom.embeds[0].fields[6].value, /^<:attack:123456789012345678> \*\*99\*\*/);
  assert.throws(() => validateSkillEmojis({ ATTACK: '@everyone' }), /ATTACK/);
  assert.throws(() => validateSkillEmojis({ NOPE: '⚔️' }), /Unknown/);
  assert.equal(combatLevel({}), 3);
  assert.equal(reply.card.total, 2277);
  const png = await renderStatsCard(reply.card);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const withImage = await withStatsCard(reply);
  assert.equal(withImage.files[0].name, 'stats.png');
  assert.equal(withImage.embeds[0].image.url, 'attachment://stats.png');
  assert.equal(withImage.embeds[0].title, 'Test Player');
  assert.equal(withImage.embeds[0].fields.length, 6);
  assert.equal(field(withImage.embeds[0].fields, 'Total Level'), '`\u20022,277\u2002`');
  assert.equal(withImage.embeds[0].author.icon_url, 'attachment://brand.png');
  assert.equal(withImage.files[1].name, 'brand.png');
  assert.ok(withImage.embeds[0].footer.text);
  assert.equal(withImage.card, undefined);
  assert.equal(withImage.summaryFields, undefined);
  const fallback = await withStatsCard(reply, async () => { throw new Error('no canvas'); });
  assert.equal(fallback.files, undefined);
  assert.equal(fallback.summaryFields, undefined);
  assert.equal(fallback.embeds[0].fields.length, 9);
  assert.match(statsReply('!stats outsider', store.state, names).content, /not in this private group/);
  assert.match(statsReply('!stats Other Player', store.state, names).content, /No synced stats/);
  assert.match(statsReply('!stats', store.state, names).content, /Usage/);
  assert.equal(statsReply('hello', store.state, names), null);
});

test('member config rejects placeholders, duplicate names and duplicate tokens', () => {
  assert.doesNotThrow(() => validateMembers(members));
  assert.throws(() => validateMembers([{ name: 'Player', token: 'short' }]));
  assert.throws(() => validateMembers([members[0], members[0]]));
  assert.throws(() => validateMembers([{ name: 'Player', token: 'REPLACE_' + 'a'.repeat(40) }]));
});

test('item sprites validate PNG dimensions and persist independently of snapshots', t => {
  const store = temporary(t);
  assert.equal(validIcons({ 385: sharkPng }), true);
  assert.equal(validIcons({ '../385': sharkPng }), false);
  assert.equal(validIcons({ 385: '<svg onload="bad"></svg>' }), false);
  assert.equal(validIcons({ 385: null }), false);
  assert.equal(validIcons({}), false);
  assert.equal(validIcons(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i + 1, sharkPng]))), false);
  const wrongDimensions = Buffer.from(sharkPng, 'base64');
  wrongDimensions.writeUInt32BE(5000, 16);
  assert.equal(validIcons({ 385: wrongDimensions.toString('base64') }), false);
  store.saveIcons({ 385: sharkPng });
  assert.deepEqual(new Store(store.file).icons([385, 554]), { 385: sharkPng });
});

test('HTTP integration: private API, bound identity, activity, schema errors and static website', async t => {
  const store = temporary(t);
  const server = createBridge({ store, members });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, token = members[0].token) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await fetch(base + '/v1/group')).status, 401);
  assert.equal((await request('/v1/group', undefined, 'wrong')).status, 401);
  assert.equal((await request('/v1/snapshot', snapshot(), members[1].token)).status, 403);
  assert.equal((await request('/v1/snapshot', snapshot())).status, 200);
  assert.equal((await fetch(base + '/v1/xp?range=24h')).status, 401);
  for (const range of ['1h', '24h', '7d', '15d', '30d', 'all']) {
    const response = await request(`/v1/xp?range=${range}`);
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.range, range);
    assert.equal(history.series.length, 2);
    assert.equal(history.series[0].gained, 0);
  }
  assert.equal((await request('/v1/xp?range=invalid')).status, 400);
  assert.equal((await fetch(base + '/v1/icons', { method: 'POST' })).status, 401);
  assert.equal((await request('/v1/icons', { username: 'Test Player', icons: { 385: sharkPng } }, members[1].token)).status, 403);
  assert.equal((await request('/v1/icons', { username: 'Test Player', icons: { 554: sharkPng } })).status, 403);
  assert.equal((await request('/v1/icons', { username: 'Test Player', icons: { 385: 'bad' } })).status, 400);
  assert.equal((await request('/v1/icons', { username: 'Test Player', icons: { 385: sharkPng } })).status, 200);
  assert.equal((await request('/v1/snapshot', { ...snapshot(), stats: {} })).status, 400);
  assert.equal((await request('/v1/events', event('boss'))).status, 200);
  assert.equal((await (await request('/v1/events', event('boss'))).json()).accepted, false);
  const group = await (await request('/v1/group')).json();
  assert.equal(group.members.length, 1);
  assert.equal(group.activity.length, 1);
  assert.equal(group.members[0].bank[0].qty, 100);
  assert.equal(group.icons[385], sharkPng);
  assert.equal(group.groupSize, 2);
  assert.equal(JSON.stringify(group).includes(members[0].token), false);
  for (const path of ['/', '/app.js', '/bank-tab-collapse.js', '/style.css', '/theme.css', '/logo', '/demo-icons/385.png']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  }
  assert.equal((await fetch(base + '/members.json')).status, 401);
  assert.equal((await request('/v1/events', { ...event(), type: 'bad' })).status, 400);
  await request('/v1/snapshot', { ...snapshot(), observedAt: Date.now() + 1, bankShared: false, bank: null });
  const unshared = await (await request('/v1/group')).json();
  assert.deepEqual(unshared.icons, {});
});

test('kc command lists saved and observed kill counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kc-'));
  try {
    const store = new Store(join(dir, 'state.json'));
    store.state.members['im herp'] = { username: 'IM Herp', killCounts: { zulrah: 120, 'chambers of xeric': 15 } };
    assert.equal(store.event({ id: 'a', type: 'boss', username: 'IM Herp', boss: 'Zulrah', kc: 121 }), true);
    assert.equal(store.event({ id: 'b', type: 'loot', username: 'NoLikey', source: 'Lunar Chest', kc: 7,
      items: [{ id: 995, quantity: 1 }] }), true);
    const names = ['IM Herp', 'NoLikey'];
    assert.equal(kcReply('!stats IM Herp', store.state, names, ['IM Herp']), null);

    const own = kcReply('!kc', store.state, names, ['IM Herp']).embeds;
    assert.equal(own.length, 1);
    assert.equal(own[0].title, 'IM Herp');
    assert.match(own[0].description, /^\*\*Zulrah\*\* — 121\n\*\*Chambers of Xeric\*\* — 15/);

    const other = kcReply('!kc nolikey', store.state, names, ['IM Herp']).embeds[0];
    assert.match(other.description, /Lunar Chests\*\* — 7/);

    const one = kcReply('!kc IM Herp zul', store.state, names, []).embeds[0];
    assert.equal(one.description, '**Zulrah** — 121\n');
    assert.equal(kcReply('!kc Zulrah', store.state, names, ['IM Herp']).embeds[0].description, '**Zulrah** — 121\n');
    assert.match(kcReply('!kc IM Herp Vorkath', store.state, names, []).embeds[0].description, /No kill count found/);
    assert.match(kcReply('!kc Stranger', store.state, names, []).content, /not in this private group/);

    const reloaded = new Store(join(dir, 'state.json'));
    assert.equal(reloaded.state.kc['nolikey']['lunar chest'].kc, 7);

    // normalize() turns underscores into spaces, so "__proto__" is stored as the plain key "proto".
    assert.equal(reloaded.event({ id: 'p', type: 'boss', username: '__proto__', boss: 'Vorkath', kc: 9 }), true);
    assert.equal(Object.getPrototypeOf(reloaded.state.kc), Object.prototype);
    assert.equal(reloaded.state.kc.proto.vorkath.kc, 9);
    assert.equal(reloaded.state.kc['nolikey'].vorkath, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('kc card renders boss icons and keeps text when rendering fails', async () => {
  assert.equal(bossName('chambers of xeric'), 'Chambers of Xeric');
  assert.equal(bossName('Lunar Chest'), 'Lunar Chests');
  assert.equal(bossName('some new boss'), 'Some New Boss');
  assert.match(bossIconUrl("Kree'Arra"), /Kree'arra_icon\.png$/);
  const icon = async () => readFileSync(new URL('../public/skill-icons/slayer.png', import.meta.url));
  const card = { username: 'IM Herp', total: 136, counts: [{ boss: 'Zulrah', kc: 121 }, { boss: 'Chambers of Xeric', kc: 15 }] };
  const png = await renderKcCard(card, icon);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const reply = { embeds: [{ author: { name: 'Kill Counts' }, title: 'IM Herp', description: 'list', footer: { text: 'x' } }], cards: [card] };
  const rendered = await withKcCards(reply, icon);
  assert.equal(rendered.embeds[0].image.url, 'attachment://kc-0.png');
  assert.equal(rendered.embeds[0].description, undefined);
  assert.equal(rendered.files.length, 2);
  const fallback = await withKcCards(reply, icon, async () => { throw new Error('no canvas'); });
  assert.equal(fallback.embeds[0].description, 'list');
});

test('kc merges official hiscore boss counts, keeping the highest', async () => {
  const { hiscoreLoader } = await import('../src/hiscores.js');
  let calls = 0;
  const load = hiscoreLoader(async () => {
    calls++;
    return { ok: true, json: async () => ({ activities: [
      { name: 'Clue Scrolls (all)', score: 11 }, { name: 'Crazy Archaeologist', score: 7 },
      { name: 'Wintertodt', score: 300 }, { name: 'Zulrah', score: -1 },
    ] }) };
  });
  const counts = await load('IM Herp');
  assert.deepEqual(counts, { 'Crazy Archaeologist': 7, Wintertodt: 300 });
  await load('im herp');
  assert.equal(calls, 1);
  const state = { members: { 'im herp': { username: 'IM Herp', killCounts: { wintertodt: 349 } } }, kc: {},
    hiscores: { 'im herp': counts } };
  const reply = kcReply('!kc', state, ['IM Herp'], ['IM Herp']);
  assert.deepEqual(reply.cards[0].counts, [{ boss: 'Wintertodt', kc: 349 }, { boss: 'Crazy Archaeologist', kc: 7 }]);
  const failing = hiscoreLoader(async () => { throw new Error('down'); });
  assert.deepEqual(await failing('IM Herp'), {});
});