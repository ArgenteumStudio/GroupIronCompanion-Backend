import { BOSS_NAMES } from './bosses.js';

const URL = name => `https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=${encodeURIComponent(name)}`;
const BOSSES = new Set(BOSS_NAMES.map(name => name.toLowerCase()));

// Official hiscore boss kill counts, cached briefly; failures return the last good result or nothing.
export function hiscoreLoader(fetchImpl = fetch, { ttlMillis = 10 * 60000, now = Date.now } = {}) {
  const cache = new Map();
  return async name => {
    const key = name.toLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.at < ttlMillis) return cached.counts;
    try {
      const res = await fetchImpl(URL(name), {
        headers: { 'User-Agent': 'GroupIronCompanion/1.0 (RuneLite group tracker)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const counts = {};
      for (const activity of Array.isArray(body?.activities) ? body.activities : []) {
        if (typeof activity?.name === 'string' && BOSSES.has(activity.name.toLowerCase()) &&
            Number.isInteger(activity.score) && activity.score > 0) counts[activity.name] = activity.score;
      }
      cache.set(key, { at: now(), counts });
      return counts;
    } catch {
      return cached?.counts ?? {};
    }
  };
}
