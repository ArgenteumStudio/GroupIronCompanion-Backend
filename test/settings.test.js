import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { badgeLogo, branding, editableBranding, embedColor, initBranding, saveBranding, themeCss } from '../src/branding.js';
import { BRAND, Store, createBridge } from '../src/bridge.js';

const members = [{ name: 'Owner', token: 'o'.repeat(48) }, { name: 'Member', token: 'm'.repeat(48) }];

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'settings-test-'));
  await initBranding({ file: join(dir, 'branding.json') });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('saving settings persists only changes and applies them live', async t => {
  const dir = await setup(t);
  const { settings } = editableBranding();
  settings.clanName = 'Iron Pals';
  settings.discord.colors.boss = '#112233';
  settings.website.colors.accent = '#445566';
  const result = await saveBranding({ settings });
  assert.equal(result.settings.clanName, 'Iron Pals');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'branding.json'), 'utf8')), {
    clanName: 'Iron Pals', discord: { colors: { boss: '#112233' } }, website: { colors: { accent: '#445566' } },
  });
  assert.equal(branding.clanName, 'Iron Pals');
  assert.equal(BRAND, 'Iron Pals Clan Tracker');
  assert.equal(embedColor('boss'), 0x112233);
  assert.match(themeCss(), /--green:#445566/);
});

test('invalid settings are rejected without changing anything', async t => {
  const dir = await setup(t);
  const { settings } = editableBranding();
  await assert.rejects(saveBranding({ settings: { ...settings, extra: 1 } }), /unknown setting/);
  await assert.rejects(saveBranding({ settings: { ...settings, logo: '../../etc/passwd' } }), /upload the logo/);
  settings.discord.colors.loot = 'red';
  await assert.rejects(saveBranding({ settings }), /colour/);
  await assert.rejects(saveBranding({ settings: editableBranding().settings, logo: Buffer.from('<svg/>').toString('base64') }), /PNG, JPEG/);
  assert.equal(existsSync(join(dir, 'branding.json')), false);
  assert.equal(branding.discord.colors.loot, '#57A65B');
});

test('logo uploads are stored next to branding.json and can be removed', async t => {
  const dir = await setup(t);
  const png = badgeLogo('Test Clan').bytes;
  const saved = await saveBranding({ settings: editableBranding().settings, logo: png.toString('base64') });
  assert.equal(saved.customLogo, true);
  assert.deepEqual(readFileSync(join(dir, 'branding', 'logo.png')), png);
  assert.ok(branding.discordIcon);
  const removed = await saveBranding({ settings: editableBranding().settings, removeLogo: true });
  assert.equal(removed.customLogo, false);
  assert.equal(branding.discordIcon, null);
});

test('map icons persist independently, resize to PNG, survive restart and reset to the default dot', async t => {
  const dir = await setup(t);
  const logo = branding.logoImage.bytes;
  const canvas = createCanvas(120, 60), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FF0000'; ctx.fillRect(0, 0, 120, 60);
  const saved = await saveBranding({
    settings: editableBranding().settings, mapIcon: canvas.toBuffer('image/png').toString('base64'),
  });
  assert.equal(saved.customMapIcon, true);
  assert.equal(Object.hasOwn(saved.settings, 'mapIcon'), false);
  assert.deepEqual(branding.logoImage.bytes, logo);
  const file = JSON.parse(readFileSync(join(dir, 'branding.json'))).mapIcon;
  assert.deepEqual(readFileSync(join(dir, file)), branding.mapIconImage.bytes);
  const image = await loadImage(branding.mapIconImage.bytes);
  assert.equal(image.width, 32);
  assert.equal(image.height, 32);
  const pixels = createCanvas(32, 32), paint = pixels.getContext('2d');
  paint.drawImage(image, 0, 0);
  assert.equal(paint.getImageData(0, 0, 1, 1).data[3], 0, 'Non-square uploads must be letterboxed');
  const png = branding.mapIconImage.bytes;
  await saveBranding({ settings: editableBranding().settings });
  assert.deepEqual(branding.mapIconImage.bytes, png, 'Unrelated settings saves preserve the marker');
  await initBranding({ file: join(dir, 'branding.json') });
  assert.deepEqual(branding.mapIconImage.bytes, png);
  await saveBranding({ settings: editableBranding().settings, removeMapIcon: true });
  assert.equal(editableBranding().customMapIcon, false);
  assert.equal((await loadImage(branding.mapIconImage.bytes)).width, 16);
  assert.deepEqual(branding.logoImage.bytes, logo);
});

test('invalid map icons do not change saved settings or the active image', async t => {
  const dir = await setup(t);
  const before = branding.mapIconImage.bytes;
  const settings = editableBranding().settings;
  for (const mapIcon of ['not base64', Buffer.from('<svg/>').toString('base64'),
    createCanvas(8, 8).toBuffer('image/png').toString('base64'),
    createCanvas(2049, 1).toBuffer('image/png').toString('base64'),
    Buffer.alloc(1024 * 1024 + 1).toString('base64')]) {
    await assert.rejects(saveBranding({ settings, mapIcon }), /map icon/);
    assert.deepEqual(branding.mapIconImage.bytes, before);
  }
  await assert.rejects(saveBranding({ settings: { ...settings, mapIcon: 'outside.png' } }), /upload the map icon/);
  assert.equal(existsSync(join(dir, 'branding.json')), false);
});

test('HTTP settings are limited to admins', async t => {
  const dir = await setup(t);
  const store = new Store(join(dir, 'state.json'));
  const logger = { log() {}, error() {} };
  const server = createBridge({ store, members, logger, isAdmin: member => member.name === 'Owner' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, token, init = {}) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });

  assert.equal((await fetch(`${base}/v1/settings`)).status, 401);
  const permissions = { banks: true, storage: true, stats: true, locations: true, activity: true };
  assert.deepEqual(await (await call('/v1/me', 'm'.repeat(48))).json(),
    { name: 'Member', characters: ['Member'], admin: false, role: 'member', canManageGroup: false, permissions });
  assert.deepEqual(await (await call('/v1/me', 'o'.repeat(48))).json(),
    { name: 'Owner', characters: ['Owner'], admin: true, role: 'owner', canManageGroup: true, permissions });
  assert.equal((await call('/v1/settings', 'm'.repeat(48))).status, 403);
  const { settings } = await (await call('/v1/settings', 'o'.repeat(48))).json();
  settings.website.title = 'Our hideout';
  const put = body => call('/v1/settings', 'o'.repeat(48), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await call('/v1/settings', 'm'.repeat(48), { method: 'PUT', body: JSON.stringify({ settings }) })).status, 403);
  assert.equal((await put({ settings })).status, 200);
  assert.match(await (await fetch(`${base}/`)).text(), /Our hideout/);
  const bad = await put({ settings: { ...settings, clanName: 'x'.repeat(50) } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /40 characters/);
  assert.equal((await fetch(`${base}/settings.js`)).status, 200);
  assert.equal((await fetch(`${base}/logo?v=2`)).status, 200);
  assert.equal((await fetch(`${base}/theme.css?v=2`)).status, 200);
  const mapPng = badgeLogo('Map').bytes.toString('base64');
  assert.equal((await call('/v1/settings', 'm'.repeat(48), {
    method: 'PUT', body: JSON.stringify({ settings, mapIcon: mapPng }),
  })).status, 403);
  assert.equal((await put({ settings, mapIcon: mapPng })).status, 200);
  const icon = await fetch(`${base}/map-icon?v=2`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.equal(icon.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await icon.arrayBuffer()), branding.mapIconImage.bytes);
  assert.equal((await put({ settings, removeMapIcon: true })).status, 200);
  assert.equal((await loadImage(branding.mapIconImage.bytes)).width, 16);
});
