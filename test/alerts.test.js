import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND, alertMessage, spriteLoader, shortGp, lootColor, wikiUrl, isMilestone } from '../src/alertEmbed.js';
import { validEvent, formatEvent, ALERT_CHANNEL_SETTINGS } from '../src/bridge.js';

const shark = readFileSync(new URL('../public/demo-icons/385.png', import.meta.url));
const sprite = async () => shark;
const base = { id: 'x', username: 'Test_Player' };

test('loot alerts use item sprites, sort by value and show totals', async () => {
  const event = { ...base, type: 'loot', source: 'Zulrah', kc: 501, items: [
    { id: 12934, name: 'Zulrah\'s scales', qty: 500, price: 150 },
    { id: 12922, name: 'Tanzanite fang', qty: 1, price: 1500000 },
  ] };
  assert.equal(validEvent(event), true);
  assert.equal(validEvent({ ...event, items: [{ ...event.items[0], price: -1 }] }), false);
  const { embeds: [embed], files } = await alertMessage(event, { sprite });
  assert.equal(embed.title, 'Test_Player received loot from Zulrah');
  assert.equal(embed.author.name, 'Valuable Drop');
  assert.match(embed.description.split('\n')[0], /\[Tanzanite fang\]\(https:\/\/oldschool\.runescape\.wiki\/.*1\.5M/);
  assert.equal(embed.fields.find(f => f.name === 'Total Value').value, '`1,575,000 gp`');
  assert.equal(embed.fields.find(f => f.name === 'Kill Count').value, '`501`');
  assert.equal(embed.thumbnail.url, 'attachment://item.png');
  assert.equal(embed.image.url, 'attachment://loot.png');
  assert.deepEqual(files.map(f => f.name), ['brand.png', 'item.png', 'loot.png']);
  assert.ok(files.slice(1).every(f => f.attachment.subarray(1, 4).toString() === 'PNG'));
  assert.equal(embed.color, lootColor(1575000));
  assert.equal(embed.footer.text, BRAND);
  assert.ok(embed.timestamp);
});

test('loot without prices or sprites still renders a clean embed', async () => {
  const event = { ...base, type: 'loot', source: 'Vorkath', items: [{ id: 22006, name: 'Skeletal visage', qty: 1 }] };
  const { embeds: [embed], files } = await alertMessage(event, { sprite: async () => null });
  assert.equal(embed.title, 'Test_Player received Skeletal visage');
  assert.equal(embed.fields.find(f => f.name === 'Total Value').value, '`Unknown`');
  assert.match(embed.thumbnail.url, /static\.runelite\.net\/cache\/item\/icon\/22006\.png$/);
  assert.equal(embed.image, undefined);
  assert.deepEqual(files.map(f => f.name), ['brand.png']);
});

test('boss, quest and chat alerts are embeds without mentions', async () => {
  const boss = await alertMessage({ ...base, type: 'boss', boss: 'Vorkath', kc: 1250 });
  assert.equal(boss.embeds[0].title, 'Test_Player reached 1,250 Vorkath kills!');
  assert.equal(boss.embeds[0].author.name, 'Kill Count Milestone');
  assert.equal(boss.embeds[0].fields[1].value, '`1,250`');
  assert.deepEqual(boss.files.map(f => f.name), ['brand.png', 'combat.png']);
  const kill = await alertMessage({ ...base, type: 'boss', boss: 'Vorkath', kc: 1234 });
  assert.equal(kill.embeds[0].title, 'Test_Player defeated Vorkath');
  assert.equal(isMilestone(1), true);
  assert.equal(isMilestone(51), false);
  const quest = await alertMessage({ ...base, type: 'quest', quest: 'Dragon Slayer II' });
  assert.equal(quest.embeds[0].title, 'Dragon Slayer II');
  assert.match(quest.embeds[0].description, /has completed \*\*Dragon Slayer II\*\*/);
  assert.equal(quest.files[1].name, 'quest.png');
  const diaryEvent = { ...base, type: 'diary', diary: 'Varrock Hard' };
  assert.equal(validEvent(diaryEvent), true);
  assert.equal(validEvent({ ...diaryEvent, diary: '' }), false);
  const diary = await alertMessage(diaryEvent);
  assert.equal(diary.embeds[0].title, 'Varrock Hard Diary');
  assert.equal(diary.embeds[0].author.name, 'Achievement Diary');
  assert.match(diary.embeds[0].url, /search=Varrock%20Diary&/);
  assert.equal(ALERT_CHANNEL_SETTINGS.diary, ALERT_CHANNEL_SETTINGS.quest);
  assert.match(formatEvent(diaryEvent), /completed the \*\*Varrock Hard\*\* Achievement Diary/);
  assert.match(wikiUrl('Prayer potion(4)'), /%284%29/);
  const chat = await alertMessage({ ...base, type: 'chat', message: 'hi @everyone' });
  assert.equal(chat.embeds[0].description.includes('@everyone'), false);
  await assert.rejects(alertMessage({ ...base, type: 'nope' }), /Unknown/);
});

test('sprite loader prefers local icons, validates PNGs and caches', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bowlsofmayo-sprites-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '385.png'), shark);
  let calls = 0;
  const load = spriteLoader(dir, async () => { calls++; return { ok: true, arrayBuffer: async () => new TextEncoder().encode('<html>').buffer }; });
  assert.ok((await load(385)).equals(shark));
  assert.equal(calls, 0);
  assert.equal(await load(4151), null);
  assert.equal(calls, 1);
  const remote = spriteLoader(null, async () => ({ ok: true, arrayBuffer: async () => shark.buffer.slice(shark.byteOffset, shark.byteOffset + shark.length) }));
  assert.ok((await remote(4151)).equals(shark));
  assert.equal(shortGp(2500000), '2.5M');
  assert.equal(shortGp(950), '950');
});
