import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_ICON, brandIconFile } from './branding.js';
import { bossIconUrl, bossShortName } from './bosses.js';

const SKILL_ICONS = resolve(dirname(fileURLToPath(import.meta.url)), '../public/skill-icons');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const W = 400, PAD = 10, HEADER = 40, COLS = 2, GAP = 4, CELL_H = 34, FOOTER = 28, MAX_CELLS = 30;
const CELL_W = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
const ICON_BOX = 34, CELL_PAD = 10;
const GOLD = '#FFB83F', CELL = '#2B2A27', CELL_EDGE = '#1A1917';
const FONT = size => `bold ${size}px "Segoe UI", Verdana, Arial, sans-serif`;

// Hiscore boss icons from the OSRS Wiki, cached on disk; misses fall back to the slayer icon.
export function bossIconLoader(cacheDir, fetchImpl = fetch) {
  const cache = new Map();
  return async boss => {
    const slug = boss.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (cache.has(slug)) return cache.get(slug);
    const file = cacheDir && resolve(cacheDir, `${slug}.png`);
    let png = null;
    if (file && existsSync(file)) png = readFileSync(file);
    else {
      try {
        const res = await fetchImpl(bossIconUrl(boss), {
          headers: { 'User-Agent': 'GroupIronCompanion/1.0 (RuneLite group tracker)' },
          signal: AbortSignal.timeout(5000),
        });
        const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
        if (body?.subarray(0, 8).equals(PNG) && body.length < 65536) {
          png = body;
          if (file) {
            mkdirSync(cacheDir, { recursive: true });
            writeFileSync(file, png);
          }
        }
      } catch {
        png = null;
      }
    }
    png ??= readFileSync(resolve(SKILL_ICONS, 'slayer.png'));
    cache.set(slug, png);
    return png;
  };
}

function box(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function text(ctx, value, x, y, align, color = GOLD, size = 15) {
  ctx.font = FONT(size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(value, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function fit(ctx, value, width, size) {
  ctx.font = FONT(size);
  if (ctx.measureText(value).width <= width) return value;
  value = bossShortName(value);
  if (ctx.measureText(value).width <= width) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

async function drawIcon(ctx, png, cx, cy, size) {
  const image = await loadImage(png);
  const scale = Math.min(size / image.width, size / image.height, 1.2);
  const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
  ctx.drawImage(image, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}

const short = value => value >= 100000 ? `${Math.floor(value / 1000)}K` : value.toLocaleString('en-US');

export async function renderKcCard({ username, counts, total }, icon, scale = 2) {
  const shown = counts.slice(0, MAX_CELLS);
  const rows = Math.ceil(shown.length / COLS);
  const H = PAD + HEADER + PAD + rows * (CELL_H + GAP) - GAP + PAD + FOOTER + PAD;
  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;
  box(ctx, 0, 0, W, H, '#3E3529', '#0E0D0B');
  ctx.strokeStyle = '#5A4E3A';
  ctx.strokeRect(2.5, 2.5, W - 5, H - 5);

  box(ctx, PAD, PAD, W - PAD * 2, HEADER, CELL, CELL_EDGE);
  const ny = PAD + HEADER / 2;
  text(ctx, username, PAD + 12, ny, 'left', '#FFFFFF', 17);
  const kcText = total.toLocaleString('en-US');
  text(ctx, kcText, W - PAD - 12, ny, 'right', '#FFFFFF', 16);
  ctx.font = FONT(16);
  await drawIcon(ctx, readFileSync(resolve(SKILL_ICONS, 'combat.png')), W - PAD - 12 - ctx.measureText(kcText).width - 14, ny, 20);

  const top = PAD + HEADER + PAD;
  const pngs = await Promise.all(shown.map(value => icon(value.boss)));
  for (const [index, value] of shown.entries()) {
    const x = PAD + (index % COLS) * (CELL_W + GAP), y = top + Math.floor(index / COLS) * (CELL_H + GAP);
    box(ctx, x, y, CELL_W, CELL_H, CELL, CELL_EDGE);
    const mid = y + CELL_H / 2;
    await drawIcon(ctx, pngs[index], x + ICON_BOX / 2 + 2, mid, 24);
    const kc = short(value.kc);
    ctx.font = FONT(15);
    const kcWidth = ctx.measureText(kc).width;
    text(ctx, kc, x + CELL_W - CELL_PAD, mid, 'right', GOLD, 15);
    const nameX = x + ICON_BOX + 6;
    const nameWidth = x + CELL_W - CELL_PAD - kcWidth - 10 - nameX;
    text(ctx, fit(ctx, value.boss, nameWidth, 13), nameX, mid, 'left', '#E8DFC8', 13);
  }

  const fy = H - PAD - FOOTER;
  box(ctx, PAD, fy, W - PAD * 2, FOOTER, '#1F1E1B', '#B8913A');
  const more = counts.length > shown.length ? ` (+${counts.length - shown.length} more)` : '';
  text(ctx, `${counts.length} ${counts.length === 1 ? 'boss' : 'bosses'} tracked${more}`, W / 2, fy + FOOTER / 2, 'center', GOLD, 13);
  return canvas.toBuffer('image/png');
}

// Attach one card image per embed; embeds keep their text list if rendering fails.
export async function withKcCards({ cards = [], embeds = [], ...reply }, icon, render = renderKcCard) {
  if (!embeds.length) return reply;
  const files = [brandIconFile()];
  const branded = [];
  for (const [index, embed] of embeds.entries()) {
    const card = cards[index];
    const next = { ...embed, author: { ...embed.author, icon_url: `attachment://${BRAND_ICON}` },
      footer: { ...embed.footer, icon_url: `attachment://${BRAND_ICON}` } };
    if (card) {
      try {
        const name = `kc-${index}.png`;
        files.push({ attachment: await render(card, icon), name });
        next.image = { url: `attachment://${name}` };
        delete next.description;
      } catch (error) {
        console.error('KC image failed; sending text embed:', error);
      }
    }
    branded.push(next);
  }
  return { ...reply, embeds: branded, files };
}
