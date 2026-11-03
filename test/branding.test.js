import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, initials, loadBranding, renderSiteHtml, resolveBranding, themeCss } from '../src/branding.js';

test('branding merges partial settings onto defaults', () => {
  const b = resolveBranding({ clanName: ' Iron Pals ', discord: { colors: { loot: '#00ff00' }, titles: { boss: 'Big Kill' } } });
  assert.equal(b.clanName, 'Iron Pals');
  assert.equal(b.discord.footer, 'Iron Pals Clan Tracker');
  assert.equal(b.discord.colors.loot, '#00FF00');
  assert.equal(b.discord.colors.boss, DEFAULTS.discord.colors.boss);
  assert.equal(b.discord.titles.boss, 'Big Kill');
  assert.equal(b.website.title, DEFAULTS.website.title);
  assert.equal(resolveBranding().discord.footer, 'Clan Tracker');
});

test('branding rejects typos, bad colours, bad numbers and unordered tiers', () => {
  assert.throws(() => resolveBranding({ clanname: 'x' }), /unknown setting branding\.clanname/);
  assert.throws(() => resolveBranding({ discord: { colors: { lot: '#000000' } } }), /discord\.colors\.lot/);
  assert.throws(() => resolveBranding({ discord: { colors: { loot: 'green' } } }), /colour/);
  assert.throws(() => resolveBranding({ discord: { milestones: { every: 0 } } }), /whole number/);
  assert.throws(() => resolveBranding({ discord: { lootTiers: { valuable: 5e7 } } }), /must increase/);
  assert.throws(() => resolveBranding({ clanName: 5 }), /must be a string/);
  assert.throws(() => resolveBranding({ clanName: 'x'.repeat(41) }), /40 characters/);
});

test('website text is HTML-escaped and theme colours are applied', () => {
  const b = resolveBranding({ clanName: '<script>', website: { heading: 'One\n<b>Two</b>', colors: { accent: '#123456' } } });
  const html = renderSiteHtml('<title>{{CLAN_NAME}}</title><h1>{{HEADING}}</h1>{{UNKNOWN}}', b);
  assert.equal(html, '<title>&#60;script&#62;</title><h1>One<br>&#60;b&#62;Two&#60;/b&#62;</h1>{{UNKNOWN}}');
  assert.match(themeCss(b), /--green:#123456/);
});

test('custom logos are validated and a badge is drawn when none is set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'branding-'));
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ clanName: 'Bowls of Mayo' }));
  const badge = await loadBranding({ file: 'b.json', baseDir: dir });
  assert.equal(badge.logoImage.type, 'image/png');
  assert.equal(badge.discordIcon, null);
  assert.equal(initials('BowlsofMayo'), 'BM');
  assert.equal(initials('Bowls of Mayo'), 'BOM');

  writeFileSync(join(dir, 'logo.png'), badge.logoImage.bytes);
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ logo: 'logo.png' }));
  const custom = await loadBranding({ file: 'b.json', baseDir: dir });
  assert.ok(custom.discordIcon.subarray(1, 4).toString() === 'PNG');

  writeFileSync(join(dir, 'logo.png'), '<svg onload="x"></svg>');
  await assert.rejects(loadBranding({ file: 'b.json', baseDir: dir }), /PNG, JPEG, GIF or WebP/);
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ logo: 'missing.png' }));
  await assert.rejects(loadBranding({ file: 'b.json', baseDir: dir }), /not found/);
});
