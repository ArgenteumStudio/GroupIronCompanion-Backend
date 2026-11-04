import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenPoint, visibleTiles, visibleMembers, fitView, tileUrl, activePlane } from '../public/world-map.js';
import { createWorldMap, tileTemplate } from '../src/worldMap.js';
import { createBridge } from '../src/bridge.js';

test('geographical projection anchors Lumbridge to the Wiki tile grid, with north upwards', () => {
  const center = { x: 3222, y: 3218 };
  assert.deepEqual(screenPoint(center, center, 1, 600, 360), { x: 300, y: 180 });
  assert.deepEqual(screenPoint({ x: 3232, y: 3228 }, center, 1, 600, 360), { x: 320, y: 160 });
  const tiles = visibleTiles(center, 1, 600, 360);
  const tile = tiles.find(tile => tile.x === 25 && tile.y === 25);
  // The Wiki's mapframe for 3222,3218 at zoom 1 uses tile 25,25 at pixel 44,220.
  assert.equal(tile.left + 44, 300);
  assert.equal(tile.top + 220, 180);
  assert.equal(tileUrl(tileTemplate('2026-10-20_a'), tile, 1, 2),
    'https://maps.runescape.wiki/osrs/versions/2026-10-20_a/tiles/rendered/-1/1/2_25_25.png');
});

test('Moons of Peril uses combined map tiles rather than the surface-only layer', () => {
  const tiles = visibleTiles({ x: 1488, y: 9632 }, 2, 600, 360);
  const tile = tiles.find(tile => tile.x === 23 && tile.y === 150);
  assert.ok(tile);
  assert.equal(tileUrl(tileTemplate('2026-10-20_a'), tile, 2, 0),
    'https://maps.runescape.wiki/osrs/versions/2026-10-20_a/tiles/rendered/-1/2/0_23_150.png');
});

test('map tiles cover the viewport at every supported zoom without gaps or unbounded requests', () => {
  for (const zoom of [-3, -2, -1, 0, 1, 2, 3, 4]) {
    const center = { x: 3222, y: 3218 };
    const tiles = visibleTiles(center, zoom, 800, 360);
    assert.ok(tiles.length <= 20);
    for (const [x, y] of [[0, 0], [400, 180], [799, 359]]) {
      assert.ok(tiles.some(tile => x >= tile.left && x < tile.left + 256 &&
        y >= tile.top && y < tile.top + 256), `Missing tile at ${x},${y}, zoom ${zoom}`);
    }
    const point = screenPoint({ x: 3223, y: 3219 }, center, zoom, 800, 360);
    assert.equal(point.x - 400, 2 ** zoom);
    assert.equal(180 - point.y, 2 ** zoom);
  }
});

test('fit group handles no players, a single player, and separated coordinates', () => {
  assert.deepEqual(fitView([], 600, 360), { center: { x: 3222, y: 3218 }, zoom: 1 });
  assert.deepEqual(fitView([{ x: 3200, y: 3200 }], 600, 360), {
    center: { x: 3200, y: 3200 }, zoom: 2,
  });
  const positions = [{ x: 3090, y: 3240 }, { x: 3222, y: 3218 }, { x: 3250, y: 3420 }];
  const view = fitView(positions, 600, 360);
  for (const position of positions) {
    const point = screenPoint(position, view.center, view.zoom, 600, 360);
    assert.ok(point.x >= 80 && point.x <= 520);
    assert.ok(point.y >= 50 && point.y <= 310);
  }
});

test('markers separate floors and hide non-shared and stale locations, regardless of world', () => {
  const now = 100000;
  const members = [
    { username: 'Current', updatedAt: now, position: { x: 3222, y: 3218, plane: 0, world: 444 } },
    { username: 'Other world', updatedAt: now, position: { x: 3220, y: 3210, plane: 0, world: 445 } },
    { username: 'Upstairs', updatedAt: now, position: { x: 3222, y: 3218, plane: 1, world: 444 } },
    { username: 'Stale', updatedAt: now - 30000, position: { x: 3222, y: 3218, plane: 0, world: 444 } },
    { username: 'Private', updatedAt: now, position: null },
  ];
  assert.deepEqual(visibleMembers(members, 0, now).map(member => member.username), ['Current', 'Other world']);
  assert.deepEqual(visibleMembers(members, 1, now).map(member => member.username), ['Upstairs']);
  assert.equal(visibleMembers(members, 0, now + 30000).length, 0);
});

test('map configuration can disable tiles, pin a version, or discover the current version', async () => {
  assert.deepEqual(createWorldMap({ env: { WORLD_MAP: 'off' } }).config(), { tiles: null });
  const pinned = createWorldMap({ env: { MAP_VERSION: '2026-10-20_a' },
    fetchImpl: () => { throw new Error('Pinned versions must not probe'); } });
  assert.deepEqual(pinned.config(), { tiles: tileTemplate('2026-10-20_a') });
  assert.throws(() => createWorldMap({ env: { MAP_VERSION: 'bad' } }), /MAP_VERSION/);
  const discovered = createWorldMap({ env: {}, fetchImpl: async () => ({
    ok: true, text: async () => 'https://maps.runescape.wiki/osrs/versions/2026-11-01_b/tiles/',
  }) });
  discovered.config();
  await discovered.ready();
  assert.deepEqual(discovered.config(), { tiles: tileTemplate('2026-11-01_b') });
  const errors = [];
  const failed = createWorldMap({ env: {}, fetchImpl: async () => { throw new Error('offline'); },
    logger: { error: message => errors.push(message) } });
  failed.config();
  await failed.ready();
  assert.match(errors[0], /offline/);
});

test('automatic floor selection keeps live and followed players visible without overriding a manual floor', () => {
  const now = 100000;
  const members = [
    { username: 'Current', updatedAt: now, position: { x: 3222, y: 3218, plane: 1 } },
    { username: 'Other', updatedAt: now, position: { x: 3222, y: 3218, plane: 2 } },
    { username: 'Stale', updatedAt: now - 31000, position: { x: 3222, y: 3218, plane: 0 } },
  ];
  assert.equal(activePlane(members, 0, null, true, now), 1);
  assert.equal(activePlane(members, 2, null, true, now), 2);
  assert.equal(activePlane(members, 0, null, false, now), 0);
  assert.equal(activePlane(members, 0, 'Other', false, now), 2);
  assert.equal(activePlane(members, 0, 'Stale', true, now), 1);
  assert.equal(activePlane([], 2, null, true, now), 2);
});

test('map assets and config are served without private data; group API still requires authentication', async t => {
  const server = createBridge({ store: {}, members: [{ name: 'Test Player', token: 'a'.repeat(48) }], worldMap: createWorldMap({
    env: { MAP_VERSION: '2026-10-20_a' },
  }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/world-map.js', 'text/javascript'], ['/world-map.css', 'text/css']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(type));
    const policy = response.headers.get('content-security-policy');
    assert.ok(policy.includes("script-src 'self'"));
    assert.ok(policy.includes('https://maps.runescape.wiki'));
  }
  assert.deepEqual(await (await fetch(base + '/map-config')).json(), {
    tiles: tileTemplate('2026-10-20_a'),
  });
  assert.equal((await fetch(base + '/v1/group')).status, 401);
});
