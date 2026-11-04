// World map tiles come from the OSRS Wiki map server (https://maps.runescape.wiki, licence:
// https://weirdgloop.org/licensing/). Viewers' browsers load tiles directly; no group data is sent.
export const MAP_TILE_ORIGIN = 'https://maps.runescape.wiki';
export const FALLBACK_MAP_VERSION = '2026-10-20_a';
const VERSION = /^\d{4}-\d{2}-\d{2}_[a-z0-9]{1,8}$/;
const REFRESH_MILLIS = 12 * 60 * 60 * 1000;
const RETRY_MILLIS = 30 * 60 * 1000;
// Rendering a tiny map frame is the wiki's supported way to learn the current tile version.
const PROBE_URL = 'https://oldschool.runescape.wiki/api.php?action=parse&format=json&formatversion=2' +
  '&prop=text&disablelimitreport=1&contentmodel=wikitext&text=' +
  encodeURIComponent('<mapframe x=3222 y=3218 zoom=1 width=10 height=10 />');

export const validMapVersion = value => typeof value === 'string' && VERSION.test(value);

export function tileTemplate(version) {
  return `${MAP_TILE_ORIGIN}/osrs/versions/${version}/tiles/rendered/-1/{z}/{p}_{x}_{y}.png`;
}

export function createWorldMap({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, logger = console } = {}) {
  const mode = (env.WORLD_MAP ?? 'on').trim().toLowerCase();
  if (['off', 'false', '0', 'no'].includes(mode)) return { config: () => ({ tiles: null }) };
  const pinned = env.MAP_VERSION?.trim();
  if (pinned && !validMapVersion(pinned)) throw new Error('MAP_VERSION must look like 2026-10-20_a');
  let version = pinned || FALLBACK_MAP_VERSION;
  let nextCheck = 0;
  let pending = null;
  const refresh = async () => {
    try {
      const response = await fetchImpl(PROBE_URL, {
        headers: { 'User-Agent': 'BowlsofMayo-ClanTracker (self-hosted group site)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const found = /versions\/(\d{4}-\d{2}-\d{2}_[a-z0-9]{1,8})\//.exec(await response.text())?.[1];
      if (!validMapVersion(found)) throw new Error('no map version in response');
      version = found;
      nextCheck = now() + REFRESH_MILLIS;
    } catch (error) {
      logger.error?.(`World map version check failed (${error.message}); using ${version}`);
      nextCheck = now() + RETRY_MILLIS;
    } finally {
      pending = null;
    }
  };
  return {
    config() {
      if (!pinned && now() >= nextCheck && !pending) pending = refresh();
      return { tiles: tileTemplate(version) };
    },
    ready: () => pending ?? Promise.resolve(),
  };
}
