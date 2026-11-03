export const XP_RANGES = {
  '1h': 3600000, '24h': 86400000, '7d': 7 * 86400000,
  '15d': 15 * 86400000, '30d': 30 * 86400000, all: null,
};

export function smoothXpPath(points, x, y) {
  const coordinates = [];
  for (const point of points) {
    const position = { x: x(point.time), y: y(point.gained) };
    if (coordinates.at(-1)?.x === position.x) coordinates.pop();
    coordinates.push(position);
  }
  if (!coordinates.length) return '';
  const slopes = coordinates.slice(1).map((point, index) =>
    (point.y - coordinates[index].y) / (point.x - coordinates[index].x));
  const tangents = coordinates.map((point, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === coordinates.length - 1) return slopes.at(-1);
    const before = slopes[index - 1], after = slopes[index];
    if (before * after <= 0) return 0;
    // Bound the shared tangent to keep curves inside the observed XP range.
    return Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
  });
  let path = `M ${coordinates[0].x} ${coordinates[0].y}`;
  for (let index = 1; index < coordinates.length; index++) {
    const previous = coordinates[index - 1], point = coordinates[index];
    const third = (point.x - previous.x) / 3;
    path += ` C ${previous.x + third} ${previous.y + third * tangents[index - 1]}` +
      ` ${point.x - third} ${point.y - third * tangents[index]} ${point.x} ${point.y}`;
  }
  return path;
}

// Keep the initial baseline, minute endpoints for 31 days, then daily endpoints.
export function recordXp(previous, previousStats, stats, time) {
  if (!previous) return { points: [{ time, gained: 0 }] };
  const last = previous.points.at(-1);
  if (time <= last.time) return previous;
  const gained = last.gained + Object.entries(stats).reduce((sum, [skill, stat]) =>
    sum + (previousStats?.[skill] ? Math.max(0, stat.xp - previousStats[skill].xp) : 0), 0);
  const points = previous.points.slice();
  const bucket = Math.floor(time / 60000);
  if (points.length > 1 && Math.floor(last.time / 60000) === bucket) points.pop();
  points.push({ time, gained });
  const compact = [points[0]];
  const cutoff = time - 31 * 86400000;
  for (const point of points.slice(1)) {
    const tail = compact.at(-1);
    if (compact.length > 1 && point.time < cutoff && tail.time < cutoff &&
        Math.floor(point.time / 86400000) === Math.floor(tail.time / 86400000)) compact.pop();
    compact.push(point);
  }
  return { points: compact };
}

export function xpSeries(histories, members, range, now = Date.now()) {
  if (!Object.hasOwn(XP_RANGES, range)) throw new Error('Invalid XP range');
  const available = members.map(member => histories[member.key]?.points?.[0]?.time)
    .filter(time => time !== undefined && time <= now);
  const start = range === 'all' ? Math.min(now, ...available) : now - XP_RANGES[range];
  const series = members.map(member => {
    const points = (histories[member.key]?.points ?? []).filter(point => point.time <= now);
    if (!points.length) return { username: member.name, points: [], gained: 0, trackedSince: null };
    const baseline = points.filter(point => point.time <= start).at(-1) ?? points[0];
    const from = Math.max(start, points[0].time);
    const selected = points.filter(point => point.time > from);
    const sampled = [{ time: from, gained: 0 }];
    const bucketWidth = Math.max(1, (now - start) / 240);
    for (const point of selected) {
      const value = { time: point.time, gained: Math.max(0, point.gained - baseline.gained) };
      if (sampled.length > 1 &&
          Math.floor((sampled.at(-1).time - start) / bucketWidth) ===
          Math.floor((point.time - start) / bucketWidth)) sampled.pop();
      sampled.push(value);
    }
    const gained = Math.max(0, points.at(-1).gained - baseline.gained);
    sampled.push({ time: now, gained });
    return { username: member.name, points: sampled, gained, trackedSince: points[0].time,
      lastObservedAt: points.at(-1).time, partial: points[0].time > start };
  });
  return { range, start, end: now, series };
}
