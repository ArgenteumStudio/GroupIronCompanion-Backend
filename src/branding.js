import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every group customises its own copy through branding.json; anything left out uses these defaults.
export const DEFAULTS = Object.freeze({
  clanName: '',
  logo: '',
  mapIcon: '',
  discord: {
    footer: '{clan} Clan Tracker',
    useLogoIcon: true,
    colors: {
      loot: '#57A65B', valuable: '#3B82F6', rare: '#A855F7', legendary: '#F59E0B',
      boss: '#C0392B', milestone: '#F59E0B', quest: '#3B82F6', diary: '#3B82F6', chat: '#1ABC9C',
      stats: '#C8AA6E', key: '#C8AA6E', success: '#57A65B', warning: '#F59E0B', error: '#C0392B',
    },
    titles: {
      loot: 'Loot Drop', valuable: 'Valuable Drop', rare: 'Rare Drop', legendary: 'Legendary Drop',
      boss: 'Boss Kill', milestone: 'Kill Count Milestone', quest: 'Quest Complete', diary: 'Achievement Diary',
      chat: 'Group Ironman Chat', stats: 'Player Stats', key: 'Access Key', verification: 'Verification',
    },
    lootTiers: { valuable: 1_000_000, rare: 10_000_000, legendary: 100_000_000 },
    milestones: { every: 50, largeFrom: 1000, largeEvery: 250 },
  },
  website: {
    title: 'Group Tracker',
    tagline: 'GROUP TRACKER',
    heading: 'Our group.\nOur progress.',
    intro: "Your group's banks, stats and adventures, all in one private place.",
    dashboardHeading: 'Group progress',
    dashboardSubtitle: 'Everyone\'s stats, banks and adventures in one place.',
    bankHeading: 'Group banks',
    activityHeading: 'Recent activity',
    footer: 'Made for the group.',
    colors: {
      background: '#141b1a', panel: '#1b2421', border: '#344039',
      text: '#f3ebd2', muted: '#a1afa3', accent: '#bdd988', highlight: '#e7bb72',
    },
  },
});

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = [
  ['image/png', b => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
  ['image/jpeg', b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF],
  ['image/gif', b => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Merge user settings onto defaults, rejecting unknown keys and wrong types so typos fail loudly.
function merge(defaults, user, path) {
  if (user === undefined) return structuredClone(defaults);
  if (!isObject(user)) throw new Error(`branding: ${path} must be an object`);
  const result = {};
  for (const key of Object.keys(user)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`branding: unknown setting ${path}.${key}`);
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = user[key], where = `${path}.${key}`;
    if (isObject(fallback)) result[key] = merge(fallback, value, where);
    else if (value === undefined) result[key] = fallback;
    else if (typeof value !== typeof fallback) throw new Error(`branding: ${where} must be a ${typeof fallback}`);
    else result[key] = value;
  }
  return result;
}

const color = (value, where) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`branding: ${where} must be a colour like #C8AA6E`);
  return value.toUpperCase();
};
const textSetting = (value, where, max) => {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`branding: ${where} must be ${max} characters or fewer`);
  return trimmed;
};
const positive = (value, where) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`branding: ${where} must be a whole number above 0`);
  return value;
};

export function resolveBranding(user = {}) {
  const b = merge(DEFAULTS, user, 'branding');
  b.clanName = textSetting(b.clanName, 'clanName', 40);
  b.logo = b.logo.trim();
  b.mapIcon = b.mapIcon.trim();
  for (const [key, value] of Object.entries(b.discord.colors)) b.discord.colors[key] = color(value, `discord.colors.${key}`);
  for (const [key, value] of Object.entries(b.website.colors)) b.website.colors[key] = color(value, `website.colors.${key}`);
  for (const [key, value] of Object.entries(b.discord.titles)) {
    b.discord.titles[key] = textSetting(value, `discord.titles.${key}`, 100) || DEFAULTS.discord.titles[key];
  }
  for (const [key, value] of Object.entries(b.discord.lootTiers)) positive(value, `discord.lootTiers.${key}`);
  for (const [key, value] of Object.entries(b.discord.milestones)) positive(value, `discord.milestones.${key}`);
  const { valuable, rare, legendary } = b.discord.lootTiers;
  if (!(valuable < rare && rare < legendary)) throw new Error('branding: lootTiers must increase: valuable < rare < legendary');
  b.discord.footer = textSetting(b.discord.footer.replaceAll('{clan}', b.clanName), 'discord.footer', 200)
    .replace(/\s+/g, ' ') || 'Clan Tracker';
  const site = b.website;
  for (const [key, max] of Object.entries({ title: 80, tagline: 40, heading: 120, intro: 300, dashboardHeading: 80,
    dashboardSubtitle: 200, bankHeading: 80, activityHeading: 80, footer: 200 })) {
    site[key] = textSetting(site[key], `website.${key}`, max) || DEFAULTS.website[key];
  }
  return b;
}

export function readLogo(file, baseDir) {
  const path = resolve(baseDir, file);
  if (!existsSync(path)) throw new Error(`branding: logo file not found: ${path}`);
  if (statSync(path).size > MAX_LOGO_BYTES) throw new Error(`branding: logo must be 5 MB or smaller: ${path}`);
  const bytes = readFileSync(path);
  const type = IMAGE_TYPES.find(([, test]) => test(bytes))?.[0];
  if (!type) throw new Error(`branding: logo must be a PNG, JPEG, GIF or WebP image: ${path}`);
  return { bytes, type };
}

export const initials = name => {
  const words = name.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [];
  return (words.slice(0, 3).map(word => word[0]).join('') || 'CT').toUpperCase();
};

export function badgeLogo(name, accent = DEFAULTS.website.colors.highlight) {
  const size = 320, c = size / 2, canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  ctx.beginPath(); ctx.arc(c, c, c - 8, 0, Math.PI * 2);
  ctx.fillStyle = '#2A241C'; ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = accent; ctx.stroke();
  const text = initials(name);
  ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${text.length > 2 ? 96 : 128}px sans-serif`;
  ctx.fillText(text, c, c + 6);
  return { bytes: canvas.toBuffer('image/png'), type: 'image/png' };
}

// Small square PNG of the logo for Discord author/footer icons.
export async function logoIcon(logo, size = 128) {
  const image = await loadImage(logo.bytes);
  const scale = Math.min(size / image.width, size / image.height);
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toBuffer('image/png');
}

const brandingPath = ({ file, baseDir = process.cwd() } = {}) =>
  resolve(baseDir, file ?? process.env.BRANDING_FILE ?? 'branding.json');

export function defaultMapIcon() {
  const canvas = createCanvas(16, 16), ctx = canvas.getContext('2d');
  ctx.beginPath(); ctx.arc(8, 8, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#00FFFF'; ctx.fill();
  ctx.strokeStyle = '#000000'; ctx.stroke();
  return { bytes: canvas.toBuffer('image/png'), type: 'image/png' };
}

async function build(raw, path, logo, mapIcon) {
  const settings = resolveBranding(raw);
  logo ??= settings.logo ? readLogo(settings.logo, dirname(path)) : badgeLogo(settings.clanName, settings.website.colors.highlight);
  const icon = settings.discord.useLogoIcon && settings.logo ? await logoIcon(logo) : null;
  mapIcon ??= settings.mapIcon
    ? { bytes: await logoIcon(readLogo(settings.mapIcon, dirname(path)), 32), type: 'image/png' }
    : defaultMapIcon();
  return { ...settings, logoImage: logo, discordIcon: icon, mapIconImage: mapIcon };
}

export async function loadBranding(options) {
  const path = brandingPath(options);
  return build(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}, path);
}

const SKILL_ICONS = resolve(dirname(fileURLToPath(import.meta.url)), '../public/skill-icons');
const fallbackIcon = () => readFileSync(resolve(SKILL_ICONS, 'overall.png'));

// Live settings object shared by the website and Discord embeds; replaced in place when an admin saves.
export const branding = {};
export let BRAND = 'Clan Tracker';
let state = { path: null, raw: {} };
function apply(loaded, path, raw) {
  for (const key of Object.keys(branding)) delete branding[key];
  Object.assign(branding, loaded);
  BRAND = branding.discord.footer;
  state = { path, raw };
}

export async function initBranding(options) {
  const path = brandingPath(options);
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  apply(await build(raw, path), path, raw);
}

// Under `node --test` the defaults are used (and nothing is saved) so output is reproducible.
if (process.env.NODE_TEST_CONTEXT) apply({ ...resolveBranding(), logoImage: badgeLogo(''), discordIcon: null, mapIconImage: defaultMapIcon() }, null, {});
else await initBranding();

const withoutLogo = ({ logo, mapIcon, ...rest }) => rest;
const differences = (defaults, value) => {
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (isObject(fallback)) {
      const nested = differences(fallback, value[key]);
      if (Object.keys(nested).length) result[key] = nested;
    } else if (value[key] !== fallback) result[key] = value[key];
  }
  return result;
};

// Raw (unresolved) settings for the website editor; `{clan}` placeholders are kept.
export function editableBranding() {
  return {
    settings: withoutLogo(merge(DEFAULTS, state.raw, 'branding')),
    defaults: withoutLogo(structuredClone(DEFAULTS)),
    customLogo: Boolean(state.raw.logo),
    customMapIcon: Boolean(state.raw.mapIcon),
    editable: Boolean(state.path),
  };
}

const writeAtomic = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, data, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
};
const LOGO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
let saving = Promise.resolve();

// Validates and persists settings from the website editor, then applies them without a restart.
// `logo` is an uploaded image as base64; `removeLogo` switches back to the initials badge.
export function saveBranding({ settings, logo, removeLogo = false, mapIcon, removeMapIcon = false }) {
  const run = async () => {
    if (!state.path) throw new Error('branding: settings cannot be saved in this mode');
    if (!isObject(settings)) throw new Error('branding: settings must be an object');
    if (Object.hasOwn(settings, 'logo')) throw new Error('branding: upload the logo as an image instead');
    if (Object.hasOwn(settings, 'mapIcon')) throw new Error('branding: upload the map icon as an image instead');
    let mapUpload;
    if (mapIcon !== undefined && mapIcon !== null) {
      if (typeof mapIcon !== 'string' || mapIcon.length > Math.ceil(1024 * 1024 / 3) * 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(mapIcon)) {
        throw new Error('branding: map icon must be a PNG, JPEG, GIF or WebP image of 1 MB or smaller');
      }
      const bytes = Buffer.from(mapIcon, 'base64');
      if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== mapIcon ||
          !IMAGE_TYPES.some(([, test]) => test(bytes))) {
        throw new Error('branding: map icon must be a PNG, JPEG, GIF or WebP image of 1 MB or smaller');
      }
      let image;
      try {
        image = await loadImage(bytes);
      } catch {
        throw new Error('branding: map icon image could not be read');
      }
      if (image.width > 2048 || image.height > 2048) throw new Error('branding: map icon dimensions must be 2048 x 2048 or smaller');
      const png = await logoIcon({ bytes }, 32);
      const visible = await loadImage(png);
      const canvas = createCanvas(32, 32), ctx = canvas.getContext('2d');
      ctx.drawImage(visible, 0, 0);
      if (!ctx.getImageData(0, 0, 32, 32).data.some((value, index) => index % 4 === 3 && value > 0)) {
        throw new Error('branding: map icon must not be fully transparent');
      }
      mapUpload = { bytes: png, type: 'image/png' };
    }
    let upload = null;
    if (logo !== undefined && logo !== null) {
      if (typeof logo !== 'string' || logo.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(logo)) {
        throw new Error('branding: logo must be a PNG, JPEG, GIF or WebP image of 5 MB or smaller');
      }
      const bytes = Buffer.from(logo, 'base64');
      const type = IMAGE_TYPES.find(([, test]) => test(bytes))?.[0];
      if (!type) throw new Error('branding: logo must be a PNG, JPEG, GIF or WebP image');
      try {
        await loadImage(bytes);
      } catch {
        throw new Error('branding: logo image could not be read');
      }
      upload = { bytes, type };
    }
    const logoPath = upload ? `branding/logo.${LOGO_EXT[upload.type]}` : removeLogo ? '' : state.raw.logo ?? '';
    const mapPath = mapUpload ? `branding/map-${createHash('sha256').update(mapUpload.bytes).digest('hex')}.png`
      : removeMapIcon ? '' : state.raw.mapIcon ?? '';
    const merged = merge(DEFAULTS, { ...settings, logo: logoPath, mapIcon: mapPath }, 'branding');
    const loaded = await build(merged, state.path, upload ?? undefined, mapUpload ?? (removeMapIcon ? defaultMapIcon() : branding.mapIconImage));
    const raw = differences(DEFAULTS, merged);
    if (upload) writeAtomic(resolve(dirname(state.path), logoPath), upload.bytes);
    if (mapUpload) writeAtomic(resolve(dirname(state.path), mapPath), mapUpload.bytes);
    writeAtomic(state.path, `${JSON.stringify(raw, null, 2)}\n`);
    apply(loaded, state.path, raw);
    return editableBranding();
  };
  const result = saving.then(run, run);
  saving = result.catch(() => {});
  return result;
}
export const hexColor = value => Number.parseInt(value.slice(1), 16);
export const embedColor = name => hexColor(branding.discord.colors[name]);
export const embedTitle = name => branding.discord.titles[name];
export const BRAND_ICON = 'brand.png';
export const brandIconFile = () => ({ attachment: branding.discordIcon ?? fallbackIcon(), name: BRAND_ICON });

const escapeHtml = value => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function renderSiteHtml(html, b = branding) {
  const site = b.website;
  const values = {
    CLAN_NAME: escapeHtml(b.clanName || 'Clan'),
    SITE_TITLE: escapeHtml(site.title),
    TAGLINE: escapeHtml(site.tagline),
    HEADING: escapeHtml(site.heading).replaceAll('\n', '<br>'),
    INTRO: escapeHtml(site.intro),
    DASHBOARD_HEADING: escapeHtml(site.dashboardHeading),
    DASHBOARD_SUBTITLE: escapeHtml(site.dashboardSubtitle),
    BANK_HEADING: escapeHtml(site.bankHeading),
    ACTIVITY_HEADING: escapeHtml(site.activityHeading),
    FOOTER: escapeHtml(site.footer),
  };
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => values[key] ?? match);
}
export function themeCss(b = branding) {
  const c = b.website.colors;
  return `:root{--bg:${c.background};--panel:${c.panel};--border:${c.border};--cream:${c.text};` +
    `--muted:${c.muted};--green:${c.accent};--gold:${c.highlight}}\n`;
}
