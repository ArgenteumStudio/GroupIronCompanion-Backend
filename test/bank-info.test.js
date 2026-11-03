import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankSummary, itemBankInfo } from '../public/bank-info.js';
import { tabSession } from '../public/tab-session.js';
const item = (name, qty = 1, extra = {}) => ({ id: 1, name, qty, ...extra });
const xp = items => Object.fromEntries(bankSummary(items).skills.map(entry => [entry.skill, entry.xp]));

test('bank values use stack quantities, preserve exact large GP totals and label missing prices', () => {
  const values = bankSummary([item('Coins', 25, { price: 1, highAlch: 0 }), item('Unknown')]);
  assert.equal(values.ge, '25 gp (partial)');
  assert.equal(values.alch, '0 gp (partial)');
  assert.match(values.coverage, /1 unsynced/);
  assert.equal(bankSummary([item('Large stack', 2147483647, { price: 2147483647 })]).ge,
    '4,611,686,014,132,420,609 gp');
  assert.match(itemBankInfo(item('Logs', 10, { price: 50, highAlch: 2 })), /500 gp stack/);
  assert.match(itemBankInfo(item('Logs', 10)), /Not synced/);
  assert.doesNotMatch(itemBankInfo(item('Logs', 10), false), /XP|FIREMAKING/);
});

test('banked XP counts only one supported base action per supply without later stages', () => {
  assert.deepEqual(xp([
    item('Oak logs', 100), item('Raw shark', 10), item('Dragon bones', 5),
    item('Grimy ranarr weed', 4), item('Gold ore', 20), item('Steel bar', 10),
    item('Shark', 5), item('Unlisted supply', 1000),
  ]), { FIREMAKING: 6000, COOKING: 2100, SMITHING: 825, PRAYER: 360, HERBLORE: 30 });
  assert.match(itemBankInfo(item('Oak logs')), /Burn logs/);
  assert.match(itemBankInfo(item('Shark')), /unsupported/);
  assert.deepEqual(xp([item('Ranarr weed', 100)]), {}, 'Clean herbs do not invent future potion ingredients');
  assert.deepEqual(xp([item('Copper ore', 10), item('Tin ore', 2)]), { SMITHING: 12.4 });
});

test('recipe XP is bounded by secondaries, allocated once, and never borrowed across banks', () => {
  const items = [item('Guam potion (unf)', 10), item('Irit potion (unf)', 10), item('Eye of newt', 12)];
  assert.deepEqual(xp(items), { HERBLORE: 450 });
  assert.deepEqual(xp([item('Mithril ore', 10), item('Runite ore', 10), item('Coal', 45)]), { SMITHING: 300 });
  assert.deepEqual(xp([item('Ranarr potion (unf)', 10)]), {});
  const separate = [[item('Ranarr potion (unf)', 10)], [item('Snape grass', 10)]];
  assert.deepEqual(bankSummary(separate.flat(), separate).skills, []);
  assert.match(bankSummary(items).xpNote, /unsupported items are excluded/);
});

test('tab access survives reload in session storage, clears on Lock, rejects invalid values and surfaces storage errors', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const first = tabSession(storage);
  assert.equal(first.load(), '');
  first.save('a'.repeat(64));
  assert.equal(tabSession(storage).load(), 'a'.repeat(64));
  first.clear();
  assert.equal(tabSession(storage).load(), '');
  assert.throws(() => first.save('bad'), /64-character/);
  values.set('bowlsofmayo-tab-access', 'bad');
  assert.throws(() => first.load(), /cleared/);
  assert.equal(values.size, 0);
  const denied = tabSession({ getItem() { throw new Error('Storage disabled'); } });
  assert.throws(() => denied.load(), /Storage disabled/);
});
