import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BRAND_ICON, brandIconFile } from './branding.js';

const ICONS = resolve(dirname(fileURLToPath(import.meta.url)), '../public/skill-icons');
// Rows in the same order as the in-game skills tab.
const GRID = [
  ['ATTACK', 'HITPOINTS', 'MINING'],
  ['STRENGTH', 'AGILITY', 'SMITHING'],
  ['DEFENCE', 'HERBLORE', 'FISHING'],
  ['RANGED', 'THIEVING', 'COOKING'],
  ['PRAYER', 'CRAFTING', 'FIREMAKING'],
  ['MAGIC', 'FLETCHING', 'WOODCUTTING'],
  ['RUNECRAFT', 'SLAYER', 'FARMING'],
  ['CONSTRUCTION', 'HUNTER', 'SAILING'],
];
const W = 320, PAD = 8, HEADER = 36, CELL_W = 100, CELL_H = 35, GAP = 2, FOOTER = 34;
const H = PAD + HEADER + PAD + GRID.length * (CELL_H + GAP) - GAP + PAD + FOOTER + PAD;
const GOLD = '#FFB83F', BORDER = '#4A4332', CELL = '#2B2A27', CELL_EDGE = '#1A1917';
const FONT = 'bold 15px "Segoe UI", Verdana, Arial, sans-serif';

const icons = new Map();
async function icon(name) {
  if (!icons.has(name)) icons.set(name, await loadImage(resolve(ICONS, `${name.toLowerCase()}.png`)));
  return icons.get(name);
}

function box(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawIcon(ctx, image, cx, cy, size) {
  const scale = Math.min(size / image.width, size / image.height);
  const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
  ctx.drawImage(image, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}

function text(ctx, value, x, y, align, color = GOLD) {
  ctx.font = FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(value, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

export async function renderStatsCard({ username, stats, combat, total, questPoints = null }, scale = 2) {
  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;
  box(ctx, 0, 0, W, H, '#3E3529', '#0E0D0B');
  ctx.strokeStyle = '#5A4E3A';
  ctx.strokeRect(2.5, 2.5, W - 5, H - 5);

  box(ctx, PAD, PAD, W - PAD * 2, HEADER, CELL, CELL_EDGE);
  const ny = PAD + HEADER / 2;
  text(ctx, username, PAD + 10, ny, 'left', '#FFFFFF');
  let x = W - PAD - 10;
  for (const [name, value] of [['QUEST', questPoints], ['COMBAT', combat]]) {
    if (value === null || value === undefined) continue;
    text(ctx, String(value), x, ny, 'right', '#FFFFFF');
    ctx.font = FONT;
    x -= ctx.measureText(String(value)).width + 13;
    drawIcon(ctx, await icon(name), x, ny, 18);
    x -= 20;
  }

  const top = PAD + HEADER + PAD;
  for (const [row, skills] of GRID.entries()) {
    for (const [col, skill] of skills.entries()) {
      const cx = PAD + col * (CELL_W + GAP), cy = top + row * (CELL_H + GAP);
      box(ctx, cx, cy, CELL_W, CELL_H, CELL, CELL_EDGE);
      drawIcon(ctx, await icon(skill), cx + 20, cy + CELL_H / 2, 26);
      text(ctx, String(stats[skill]?.level ?? 1), cx + CELL_W - 10, cy + CELL_H / 2, 'right');
    }
  }

  const fy = H - PAD - FOOTER;
  box(ctx, PAD, fy, W - PAD * 2, FOOTER, '#1F1E1B', '#B8913A');
  text(ctx, `Total: ${total.toLocaleString('en-US')}`, W / 2, fy + FOOTER / 2, 'center');
  return canvas.toBuffer('image/png');
}

// Swap the emoji grid for the skills-tab image; keep the emoji embed if rendering fails.
export async function withStatsCard({ card, summaryFields, ...reply }, render = renderStatsCard) {
  if (!card) return reply;
  try {
    const png = await render(card);
    const [embed] = reply.embeds;
    return {
      files: [{ attachment: png, name: 'stats.png' }, brandIconFile()],
      embeds: [{ ...embed, author: { ...embed.author, icon_url: `attachment://${BRAND_ICON}` },
        footer: { ...embed.footer, icon_url: `attachment://${BRAND_ICON}` },
        fields: summaryFields, image: { url: 'attachment://stats.png' } }],
    };
  } catch (error) {
    console.error('Stats image failed; sending text embed:', error);
    return reply;
  }
}
