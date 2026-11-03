import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordXp, xpSeries, smoothXpPath, XP_RANGES } from '../public/xp.js';
const hour = 3600000;
const day = 24 * hour;
const now = 1800000000000;
const members = [{ name: 'One', key: 'one' }, { name: 'Two', key: 'two' }];

test('smooth chart curves pass through observations without stair steps or XP overshoot', () => {
  const points = [
    { time: 0, gained: 0 }, { time: 1, gained: 10 },
    { time: 10, gained: 10 }, { time: 11, gained: 100 }, { time: 100, gained: 110 },
  ];
  for (const scale of [1, -2]) {
    const path = smoothXpPath(points, time => time * 10, xp => xp * scale);
    assert.ok(path.startsWith('M 0 0'));
    assert.equal(/[HV]/.test(path), false);
    const segments = path.split(' C ').slice(1).map(segment => segment.trim().split(/\s+/).map(Number));
    assert.equal(segments.length, points.length - 1);
    segments.forEach(([x1, y1, x2, y2, x3, y3], index) => {
      const start = points[index], end = points[index + 1];
      assert.equal(x3, end.time * 10);
      assert.equal(y3, end.gained * scale);
      assert.ok(x1 >= start.time * 10 && x1 <= x2 && x2 <= x3);
      const low = Math.min(start.gained * scale, y3), high = Math.max(start.gained * scale, y3);
      for (const value of [y1, y2]) assert.ok(value >= low && value <= high);
      let previous = start.gained * scale;
      for (let step = 1; step <= 20; step++) {
        const t = step / 20, u = 1 - t;
        const value = u ** 3 * start.gained * scale + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3;
        assert.ok(value >= low - 1e-8 && value <= high + 1e-8);
        assert.ok(scale > 0 ? value >= previous - 1e-8 : value <= previous + 1e-8);
        previous = value;
      }
    });
  }
});

test('smooth chart handles empty, single, duplicate-time and flat observations without NaN', () => {
  const x = value => value, y = value => value;
  assert.equal(smoothXpPath([], x, y), '');
  assert.equal(smoothXpPath([{ time: 1, gained: 0 }], x, y), 'M 1 0');
  const points = [{ time: 1, gained: 0 }, { time: 2, gained: 0 }, { time: 2, gained: 0 }];
  const path = smoothXpPath(points, x, y);
  assert.equal((path.match(/ C /g) ?? []).length, 1);
  assert.ok(path.endsWith('2 0'));
  assert.equal(/NaN|Infinity/.test(path), false);
  assert.deepEqual(points, [{ time: 1, gained: 0 }, { time: 2, gained: 0 }, { time: 2, gained: 0 }]);
});

test('first sync is a zero-gain baseline; total account XP is never counted as gains', () => {
  const first = recordXp(undefined, undefined, { ATTACK: { xp: 13034431 } }, now);
  assert.deepEqual(first.points, [{ time: now, gained: 0 }]);
  const second = recordXp(first, { ATTACK: { xp: 13034431 } },
    { ATTACK: { xp: 13034531 }, SAILING: { xp: 5000 } }, now + 1000);
  assert.equal(second.points.at(-1).gained, 100);
  assert.equal(second.points[0].gained, 0);
});

test('tracks positive deltas across skills, compacts minutes, ignores older/duplicate snapshots', () => {
  const first = recordXp(undefined, undefined, {}, now);
  const second = recordXp(first, { ATTACK: { xp: 100 }, DEFENCE: { xp: 100 } },
    { ATTACK: { xp: 120 }, DEFENCE: { xp: 90 } }, now + 1000);
  const third = recordXp(second, { ATTACK: { xp: 120 } }, { ATTACK: { xp: 150 } }, now + 2000);
  assert.equal(third.points.length, 2);
  assert.equal(third.points.at(-1).gained, 50);
  assert.equal(recordXp(third, {}, {}, now), third);
  assert.equal(recordXp(third, {}, {}, now + 2000), third);
});

test('all six windows subtract their own baseline and retain every group line', () => {
  const points = [];
  for (let h = 40 * 24; h >= 0; h--) points.push({ time: now - h * hour, gained: (40 * 24 - h) * 100 });
  const histories = { one: { points }, two: { points: points.map(point => ({ ...point, gained: point.gained * 2 })) } };
  for (const [range, duration] of Object.entries(XP_RANGES)) {
    const result = xpSeries(histories, members, range, now);
    const expected = (duration === null ? 40 * 24 : duration / hour) * 100;
    assert.equal(result.series.length, 2);
    assert.equal(result.series[0].gained, expected, range);
    assert.equal(result.series[1].gained, expected * 2, range);
    for (const line of result.series) {
      assert.equal(line.points[0].gained, 0);
      assert.equal(line.points.at(-1).gained, line.gained);
      assert.ok(line.points.length <= 243);
    }
  }
  assert.throws(() => xpSeries({}, members, '99d', now), /Invalid/);
});

test('late join, no samples, offline gaps and no recent gains are explicit', () => {
  const histories = { one: { points: [{ time: now - hour / 2, gained: 0 }, { time: now - 1000, gained: 25 }] } };
  const result = xpSeries(histories, members, '24h', now);
  assert.equal(result.series[0].partial, true);
  assert.equal(result.series[0].gained, 25);
  assert.equal(result.series[0].points[0].time, now - hour / 2);
  assert.deepEqual(result.series[1].points, []);
  assert.equal(result.series[1].trackedSince, null);
  const offline = xpSeries({ one: { points: [{ time: now - 2 * day, gained: 0 }] } }, members, '1h', now);
  assert.equal(offline.series[0].gained, 0);
  assert.equal(offline.series[0].lastObservedAt, now - 2 * day);
  assert.ok(offline.series[0].points.every(point => point.gained === 0));
});

test('old history is condensed to daily endpoints without losing all-time baseline or total', () => {
  let history;
  for (let h = 0; h <= 70 * 24; h++) {
    history = recordXp(history, { ATTACK: { xp: h * 10 } },
      { ATTACK: { xp: h * 10 + 10 } }, now - 70 * day + h * hour);
  }
  assert.equal(history.points[0].time, now - 70 * day);
  assert.equal(history.points[0].gained, 0);
  assert.equal(history.points.at(-1).gained, 70 * 24 * 10);
  assert.ok(history.points.length < 850);
  assert.equal(xpSeries({ one: history }, members, 'all', now).series[0].gained, 16800);
});
