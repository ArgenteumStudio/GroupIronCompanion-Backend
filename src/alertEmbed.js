import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeDiscord } from './bridge.js';
import { BRAND, BRAND_ICON, branding, brandIconFile, embedColor, embedTitle } from './branding.js';

const SKILL_ICONS = resolve(dirname(fileURLToPath(import.meta.url)), '../public/skill-icons');
export { BRAND };
const SPRITE_URL = id => `https://static.runelite.net/cache/item/icon/${id}.png`;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_LISTED = 10, MAX_GRID = 24, GRID_COLS = 6;

export const shortGp = value => value >= 1e9 ? `${+(value / 1e9).toFixed(2)}B`
  : value >= 1e6 ? `${+(value / 1e6).toFixed(2)}M`
    : value >= 1e3 ? `${+(value / 1e3).toFixed(1)}K` : `${value}`;
const number = value => value.toLocaleString('en-US');
const itemValue = item => Number.isInteger(item.price) ? item.price * item.qty : null;

export function lootTier(total) {
  const tiers = branding.discord.lootTiers;
  if (total == null) return 'loot';
  if (total >= tiers.legendary) return 'legendary';
  if (total >= tiers.rare) return 'rare';
  if (total >= tiers.valuable) return 'valuable';
  return 'loot';
}
export const lootColor = total => embedColor(lootTier(total));

// In-game sprites: the group's uploaded bank icons first, then RuneLite's item icon cache.
export function spriteLoader(iconsDir, fetchImpl = fetch) {
  const cache = new Map();
  return async id => {
    if (cache.has(id)) return cache.get(id);
    let png = null;
    const local = iconsDir && resolve(iconsDir, `${id}.png`);
    if (local && existsSync(local)) png = readFileSync(local);
    else {
      try {
        const res = await fetchImpl(SPRITE_URL(id), { signal: AbortSignal.timeout(5000) });
        const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
        if (body?.subarray(0, 8).equals(PNG) && body.length < 65536) png = body;
      } catch {
        png = null;
      }
    }
    if (png) cache.set(id, png);
    return png;
  };
}

// OSRS-style stack text: yellow, white K above 100K, green M above 10M.
function stackLabel(qty) {
  if (qty >= 10e6) return [`${Math.floor(qty / 1e6)}M`, '#00FF80'];
  if (qty >= 100e3) return [`${Math.floor(qty / 1e3)}K`, '#FFFFFF'];
  return [`${qty}`, '#FFFF00'];
}

async function drawSprite(ctx, png, item, x, y, scale) {
  if (png) {
    const image = await loadImage(png);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, x + Math.round((36 - image.width) / 2) * scale,
      y + Math.round((32 - image.height) / 2) * scale, image.width * scale, image.height * scale);
  }
  if (item.qty > 1) {
    const [label, color] = stackLabel(item.qty);
    ctx.font = `bold ${9 * scale}px "Segoe UI", Verdana, Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + scale, y + scale);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  }
}

export async function renderItemSprite(item, sprite, scale = 3) {
  const png = await sprite(item.id);
  if (!png) return null;
  const canvas = createCanvas(36 * scale, 32 * scale);
  await drawSprite(canvas.getContext('2d'), png, item, 0, 0, scale);
  return canvas.toBuffer('image/png');
}

export async function renderLootGrid(items, sprite, scale = 2) {
  const shown = items.slice(0, MAX_GRID);
  const pngs = await Promise.all(shown.map(item => sprite(item.id)));
  if (!pngs.some(Boolean)) return null;
  const pad = 6, cols = Math.min(GRID_COLS, shown.length), rows = Math.ceil(shown.length / GRID_COLS);
  const canvas = createCanvas((pad * 2 + cols * 40) * scale, (pad * 2 + rows * 36) * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1F1E1B';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#4A4332';
  ctx.lineWidth = scale;
  ctx.strokeRect(scale / 2, scale / 2, canvas.width - scale, canvas.height - scale);
  for (const [index, item] of shown.entries()) {
    const x = (pad + (index % GRID_COLS) * 40 + 2) * scale, y = (pad + Math.floor(index / GRID_COLS) * 36 + 2) * scale;
    await drawSprite(ctx, pngs[index], item, x, y, scale);
  }
  return canvas.toBuffer('image/png');
}

// Discord embed limits; titles, author names, field names and footers do not render Markdown.
export const clip = (value, max) => {
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};
const plain = value => clip(String(value).replace(/\s+/g, ' ').trim(), 256);
export const wikiUrl = page => `https://oldschool.runescape.wiki/w/Special:Search?search=${
  encodeURIComponent(page).replace(/[()'*!]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}&go=Go`;
const iconFile = name => ({ attachment: readFileSync(resolve(SKILL_ICONS, `${name}.png`)), name: `${name}.png` });
const link = text => `[${escapeDiscord(clip(text, 200)).replace(/[[\]]/g, '\\$&')}](${wikiUrl(text)})`;

export function brandedEmbed({ category, color, timestamp }) {
  return {
    author: { name: category, icon_url: `attachment://${BRAND_ICON}` },
    color,
    footer: { text: BRAND, icon_url: `attachment://${BRAND_ICON}` },
    timestamp: new Date(timestamp).toISOString(),
  };
}
export const brandFiles = () => [brandIconFile()];

export function isMilestone(kc) {
  const { every, largeFrom, largeEvery } = branding.discord.milestones;
  return kc === 1 || (kc > 0 && (kc < largeFrom ? kc % every === 0 : kc % largeEvery === 0));
}

async function lootMessage(event, sprite, time) {
  const items = [...event.items].sort((a, b) => (itemValue(b) ?? -1) - (itemValue(a) ?? -1));
  const priced = items.every(item => itemValue(item) != null);
  const total = priced ? items.reduce((sum, item) => sum + itemValue(item), 0) : null;
  const top = items[0];
  const lines = items.slice(0, MAX_LISTED).map(item => {
    const value = itemValue(item);
    return `\`${number(item.qty)}×\` ${link(item.name)}${value == null ? '' : `  —  **${shortGp(value)}**`}`;
  });
  if (items.length > MAX_LISTED) lines.push(`*…and ${items.length - MAX_LISTED} more*`);
  const tier = lootTier(total);
  const embed = {
    ...brandedEmbed({ category: embedTitle(tier), color: embedColor(tier), timestamp: time }),
    title: plain(items.length === 1 ? `${event.username} received ${top.name}`
      : `${event.username} received loot from ${event.source}`),
    url: wikiUrl(items.length === 1 ? top.name : event.source),
    description: clip(lines.join('\n'), 4096),
    fields: [
      { name: 'Source', value: link(event.source), inline: true },
      { name: 'Total Value', value: total == null ? '`Unknown`' : `\`${number(total)} gp\``, inline: true },
      { name: 'Kill Count', value: event.kc == null ? '`—`' : `\`${number(event.kc)}\``, inline: true },
    ],
  };
  const files = brandFiles();
  const icon = await renderItemSprite(top, sprite).catch(() => null);
  if (icon) {
    files.push({ attachment: icon, name: 'item.png' });
    embed.thumbnail = { url: 'attachment://item.png' };
  } else embed.thumbnail = { url: SPRITE_URL(top.id) };
  if (items.length > 1) {
    const grid = await renderLootGrid(items, sprite).catch(() => null);
    if (grid) {
      files.push({ attachment: grid, name: 'loot.png' });
      embed.image = { url: 'attachment://loot.png' };
    }
  }
  return { embeds: [embed], files };
}

function bossMessage(event, time) {
  const milestone = isMilestone(event.kc);
  const title = event.kc === 1 ? `${event.username} defeated ${event.boss} for the first time!`
    : milestone ? `${event.username} reached ${number(event.kc)} ${event.boss} kills!`
      : `${event.username} defeated ${event.boss}`;
  return {
    embeds: [{
      ...brandedEmbed({ category: embedTitle(milestone ? 'milestone' : 'boss'),
        color: embedColor(milestone ? 'milestone' : 'boss'), timestamp: time }),
      title: plain(title),
      url: wikiUrl(event.boss),
      thumbnail: { url: 'attachment://combat.png' },
      fields: [
        { name: 'Boss', value: link(event.boss), inline: true },
        { name: 'Kill Count', value: `\`${number(event.kc)}\``, inline: true },
      ],
    }],
    files: [...brandFiles(), iconFile('combat')],
  };
}

export async function alertMessage(event, { sprite = spriteLoader(null), now = Date.now() } = {}) {
  const time = event.receivedAt ?? now;
  switch (event.type) {
    case 'loot': return lootMessage(event, sprite, time);
    case 'boss': return bossMessage(event, time);
    case 'quest': return {
      embeds: [{
        ...brandedEmbed({ category: embedTitle('quest'), color: embedColor('quest'), timestamp: time }),
        title: plain(event.quest),
        url: wikiUrl(event.quest),
        description: `**${escapeDiscord(event.username)}** has completed **${escapeDiscord(event.quest)}**.`,
        thumbnail: { url: 'attachment://quest.png' },
      }],
      files: [...brandFiles(), iconFile('quest')],
    };
    case 'chat': return {
      embeds: [{
        ...brandedEmbed({ category: embedTitle('chat'), color: embedColor('chat'), timestamp: time }),
        title: plain(event.username),
        description: clip(escapeDiscord(event.message), 4096),
      }],
      files: brandFiles(),
    };
    default: throw new Error('Unknown event type');
  }
}
