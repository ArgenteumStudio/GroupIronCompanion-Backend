import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_TILE_ORIGIN } from './worldMap.js';
import { LiveXp, validXpBatch } from './liveXp.js';
import { SKILLS } from '../public/skills.js';
import { recordXp, xpSeries, XP_RANGES } from '../public/xp.js';
import { permissionsFor } from './permissions.js';
import { bossName, isHiscoreBoss } from './bosses.js';

import { BRAND, branding, editableBranding, embedColor, embedTitle, renderSiteHtml, saveBranding, themeCss } from './branding.js';
export { BRAND };

export const normalize = name => name.replaceAll('\u00a0', ' ').replaceAll('_', ' ').trim().toLowerCase();
const validName = name => typeof name === 'string' && /^[a-zA-Z0-9 _-]{1,12}$/.test(name);
export const MAX_CHARACTERS = 5;
const integer = (value, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;
const text = (value, max = 200) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const itemsValid = (items, max = 2000) => Array.isArray(items) && items.length <= max &&
  items.every(item => item && integer(item.id, 1000000) && item.id > 0 &&
    integer(item.qty, 2147483647) && item.qty > 0 && text(item.name) &&
    (item.price == null || integer(item.price)) &&
    (item.highAlch == null || integer(item.highAlch, 2147483647)) &&
    (item.tab == null || integer(item.tab, 9)));
const skills = new Set([
  'ATTACK', 'DEFENCE', 'STRENGTH', 'HITPOINTS', 'RANGED', 'PRAYER', 'MAGIC',
  'COOKING', 'WOODCUTTING', 'FLETCHING', 'FISHING', 'FIREMAKING', 'CRAFTING',
  'SMITHING', 'MINING', 'HERBLORE', 'AGILITY', 'THIEVING', 'SLAYER', 'FARMING',
  'RUNECRAFT', 'HUNTER', 'CONSTRUCTION', 'SAILING',
]);

export function validIcons(icons) {
  if (!icons || typeof icons !== 'object' || Array.isArray(icons)) return false;
  const entries = Object.entries(icons);
  return entries.length > 0 && entries.length <= 32 && entries.every(([id, value]) => {
    if (!/^[1-9]\d{0,5}$/.test(id) || typeof value !== 'string' ||
        value.length > 16000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const png = Buffer.from(value, 'base64');
    return png.length >= 33 && png.toString('base64') === value &&
      png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      png.toString('ascii', 12, 16) === 'IHDR' &&
      png.readUInt32BE(16) === 36 && png.readUInt32BE(20) === 32;
  });
}

function validKillCounts(value) {
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 500 && entries.every(([boss, kc]) => text(boss, 80) && integer(kc, 2147483647));
}

function validBorrowedItems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 100 && entries.every(([id, quantity]) =>
    /^[1-9]\d{0,6}$/.test(id) && Number(id) <= 1000000 && integer(quantity, 2147483647) && quantity > 0);
}

export function validSnapshot(body) {
  if (!body || !validName(body.username) || !body.stats ||
      typeof body.stats !== 'object' || Array.isArray(body.stats)) return false;
  const entries = Object.entries(body.stats);
  if (entries.length < 23 || entries.some(([name, value]) => !skills.has(name) ||
      !value || !integer(value.level, 126) || value.level < 1 ||
      !integer(value.xp, 200000000))) return false;
  if (body.position !== null && (!body.position || !integer(body.position.x, 65535) ||
      !integer(body.position.y, 65535) || !integer(body.position.plane, 3) ||
      !integer(body.position.world, 10000))) return false;
  if (!integer(body.observedAt) || body.observedAt > Date.now() + 60000 ||
      Date.now() - body.observedAt > 300000) return false;
  if (typeof body.bankShared !== 'boolean') return false;
  if (body.questPoints != null && !integer(body.questPoints, 1000)) return false;
  if (body.killCounts != null && !validKillCounts(body.killCounts)) return false;
  if (Object.hasOwn(body, 'borrowedItemsShared') &&
      (typeof body.borrowedItemsShared !== 'boolean' ||
        (body.borrowedItemsShared ? !validBorrowedItems(body.borrowedItems) : body.borrowedItems != null))) return false;
  if (body.groupStorage != null && (!itemsValid(body.groupStorage) ||
      !integer(body.groupStorageUpdatedAt) || body.groupStorageUpdatedAt > body.observedAt)) return false;
  return body.bank === null || (itemsValid(body.bank) && integer(body.bankUpdatedAt) &&
    body.bankUpdatedAt <= Date.now() + 60000);
}

export function validEvent(event) {
  if (!event || !text(event.id, 80) || !validName(event.username)) return false;
  switch (event.type) {
    case 'chat': return text(event.message, 1000);
    case 'boss': return text(event.boss) && integer(event.kc, 2147483647) && event.kc > 0;
    case 'loot': return text(event.source) && itemsValid(event.items, 500) &&
      event.items.length > 0 && (event.kc == null || integer(event.kc, 2147483647));
    case 'quest': return text(event.quest);
    case 'diary': return text(event.diary);
    default: return false;
  }
}

function recordKc(kc, event) {
  const boss = event.type === 'boss' ? event.boss : event.type === 'loot' ? event.source : null;
  if (!boss || !Number.isInteger(event.kc) || event.kc < 1) return;
  const user = normalize(event.username);
  const counts = kc[user] ??= {};
  const key = normalize(boss);
  if (!counts[key] || event.kc >= counts[key].kc) counts[key] = { boss, kc: event.kc };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : { version: 1, members: {}, seen: {}, outbox: [], activity: [] };
    this.state.activity ??= [];
    this.state.xpHistory ??= {};
    this.state.links ??= {};
    if (!this.state.kc) {
      this.state.kc = {};
      for (const event of this.state.activity) recordKc(this.state.kc, event);
    }
    if (this.state.version !== 1 || !this.state.members || !this.state.seen ||
        !Array.isArray(this.state.outbox)) throw new Error('Unsupported or invalid state file');
  }

  link(discordId, name) {
    const previous = this.state.links[discordId];
    this.state.links[discordId] = [...(previous ?? []), name];
    try {
      this.save();
    } catch (error) {
      if (previous === undefined) delete this.state.links[discordId];
      else this.state.links[discordId] = previous;
      throw error;
    }
  }

  unlink(discordId, name) {
    const previous = this.state.links[discordId] ?? [];
    const remaining = previous.filter(value => normalize(value) !== normalize(name));
    if (remaining.length === previous.length) return false;
    this.state.links[discordId] = remaining;
    try {
      this.save();
    } catch (error) {
      this.state.links[discordId] = previous;
      throw error;
    }
    return true;
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }

  icons(ids) {
    const result = {};
    for (const id of new Set(ids)) {
      const path = resolve(dirname(this.file), 'icons', `${id}.png`);
      if (existsSync(path)) result[id] = readFileSync(path).toString('base64');
    }
    return result;
  }

  saveIcons(icons) {
    const directory = resolve(dirname(this.file), 'icons');
    mkdirSync(directory, { recursive: true });
    for (const [id, value] of Object.entries(icons)) {
      const path = resolve(directory, `${id}.png`);
      writeFileSync(`${path}.tmp`, Buffer.from(value, 'base64'), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    }
  }

  snapshot(body) {
    const key = normalize(body.username);
    const previous = this.state.members[key];
    if (previous && body.observedAt <= previous.updatedAt) return;
    const previousHistory = this.state.xpHistory[key];
    this.state.xpHistory[key] = recordXp(previousHistory, previous?.stats, body.stats, body.observedAt);
    this.state.members[key] = {
      username: body.username, stats: body.stats, position: body.position, updatedAt: body.observedAt,
      questPoints: body.questPoints ?? previous?.questPoints ?? null,
      killCounts: body.killCounts ?? previous?.killCounts ?? null,
      bank: !body.bankShared ? null : (body.bank ?? previous?.bank ?? null),
      bankUpdatedAt: !body.bankShared ? null : (body.bank === null ? previous?.bankUpdatedAt ?? null : body.bankUpdatedAt),
      groupStorage: !body.bankShared ? null :
        body.groupStorage != null && body.groupStorageUpdatedAt > (previous?.groupStorageUpdatedAt ?? -1)
          ? body.groupStorage : previous?.groupStorage ?? null,
      groupStorageUpdatedAt: !body.bankShared ? null :
        body.groupStorage != null && body.groupStorageUpdatedAt > (previous?.groupStorageUpdatedAt ?? -1)
          ? body.groupStorageUpdatedAt : previous?.groupStorageUpdatedAt ?? null,
      borrowedItemsShared: Object.hasOwn(body, 'borrowedItemsShared')
        ? body.borrowedItemsShared : previous?.borrowedItemsShared ?? false,
      borrowedItems: Object.hasOwn(body, 'borrowedItemsShared')
        ? (body.borrowedItemsShared ? body.borrowedItems : null) : previous?.borrowedItems ?? null,
      borrowedItemsUpdatedAt: Object.hasOwn(body, 'borrowedItemsShared')
        ? (body.borrowedItemsShared ? body.observedAt : null) : previous?.borrowedItemsUpdatedAt ?? null,
    };
    try {
      this.save();
    } catch (error) {
      if (previous === undefined) delete this.state.members[key];
      else this.state.members[key] = previous;
      if (previousHistory === undefined) delete this.state.xpHistory[key];
      else this.state.xpHistory[key] = previousHistory;
      throw error;
    }
  }

  event(event) {
    const now = Date.now();
    const key = `${normalize(event.username)}:${event.id}`;
    if (this.state.seen[key]) return false;
    if (this.state.outbox.length >= 10000) throw new Error('Discord outbox full');
    this.state.outbox.push(event);
    const previousActivity = this.state.activity;
    this.state.activity = [...previousActivity, { ...event, receivedAt: now }].slice(-300);
    this.state.seen[key] = now;
    const user = normalize(event.username);
    const previousKc = this.state.kc[user];
    this.state.kc[user] = { ...previousKc };
    recordKc(this.state.kc, event);
    for (const [id, time] of Object.entries(this.state.seen)) {
      if (now - time > 7 * 86400000) delete this.state.seen[id];
    }
    try {
      this.save();
    } catch (error) {
      this.state.outbox.pop();
      this.state.activity = previousActivity;
      delete this.state.seen[key];
      if (previousKc === undefined) delete this.state.kc[user];
      else this.state.kc[user] = previousKc;
      throw error;
    }
    return true;
  }
}

function authenticate(header, members) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const supplied = Buffer.from(header.slice(7));
  return members.find(member => {
    const expected = Buffer.from(member.token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

// A member's characters: the optional name from members.json plus any linked automatically.
export function memberCharacters(store, member) {
  const names = validName(member.name) ? [member.name] : [];
  for (const name of member.discordId ? store.state.links?.[member.discordId] ?? [] : []) {
    if (!names.some(value => normalize(value) === normalize(name))) names.push(name);
  }
  return names;
}

export function groupIdentities(store, members) {
  const generated = Object.entries(store.state.memberTokens ?? {})
    .filter(([, record]) => members.some(member => member.discordId === record.createdBy))
    .map(([memberTokenId, record]) => ({ name: record.name, memberTokenId }));
  return [...members, ...generated];
}

export const allCharacters = (store, members) =>
  groupIdentities(store, members).flatMap(member => memberCharacters(store, member));

export function characterOwner(store, members, name) {
  return groupIdentities(store, members)
    .find(member => memberCharacters(store, member).some(value => normalize(value) === normalize(name)));
}

export function validateMembers(members, { discord = false } = {}) {
  if (!Array.isArray(members) || !members.length || members.length > 5) {
    throw new Error('Configure one to five group members');
  }
  const names = new Set();
  const tokens = new Set();
  for (const member of members) {
    if (discord) {
      if (!member || (member.name !== undefined && !validName(member.name)) || typeof member.discordId !== 'string' ||
          !/^[1-9]\d{16,19}$/.test(member.discordId) ||
          member.token !== undefined || (member.name !== undefined && names.has(normalize(member.name))) ||
          tokens.has(member.discordId)) {
        throw new Error('Members need unique Discord user IDs (and unique RS names if set); remove legacy token fields');
      }
      if (member.name !== undefined) names.add(normalize(member.name));
      tokens.add(member.discordId);
      continue;
    }
    if (!validName(member.name) || typeof member.token !== 'string' ||
        member.token.length < 32 || /REPLACE|YOUR_TOKEN/i.test(member.token) ||
        names.has(normalize(member.name)) || tokens.has(member.token)) {
      throw new Error('Members need unique RS names and unique random tokens of at least 32 characters');
    }
    names.add(normalize(member.name));
    tokens.add(member.token);
  }
}

export function createBridge({ store, members, access, isAdmin = member => access?.isAdmin(member) ?? false, logger = console, worldMap = null }) {
  const liveXp = new LiveXp();
  validateMembers(members, { discord: Boolean(access) });
  const allowedNames = () => new Set(allCharacters(store, members).map(normalize));
  const claimCharacter = (member, username) => {
    const mine = memberCharacters(store, member);
    if (mine.some(name => normalize(name) === normalize(username))) return null;
    const shown = username.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 12);
    if (!member.discordId) return `This key belongs to ${mine.join(', ')}, but you are logged in as ${shown}`;
    if (characterOwner(store, members, username)) return `${shown} is already linked to another group member`;
    if (mine.length >= MAX_CHARACTERS) {
      return `You already have ${MAX_CHARACTERS} characters linked. Use !unlink <name> in Discord to free a slot`;
    }
    store.link(member.discordId, username);
    logger.log?.(`Linked character ${shown} to a group member`);
    return null;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:${worldMap ? ` ${MAP_TILE_ORIGIN}` : ''}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const respond = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      const assets = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/settings.js': ['settings.js', 'text/javascript; charset=utf-8'],
        '/xp.js': ['xp.js', 'text/javascript; charset=utf-8'],
        '/world-map.js': ['world-map.js', 'text/javascript; charset=utf-8'],
        '/world-map.css': ['world-map.css', 'text/css; charset=utf-8'],
        '/members.js': ['members.js', 'text/javascript; charset=utf-8'],
        '/bank-tooltips.js': ['bank-tooltips.js', 'text/javascript; charset=utf-8'],
        '/tab-session.js': ['tab-session.js', 'text/javascript; charset=utf-8'],
        '/member-access.js': ['member-access.js', 'text/javascript; charset=utf-8'],
        '/bank-info.js': ['bank-info.js', 'text/javascript; charset=utf-8'],
        '/bank-tab-collapse.js': ['bank-tab-collapse.js', 'text/javascript; charset=utf-8'],
        '/members.css': ['members.css', 'text/css; charset=utf-8'],
        '/skills.js': ['skills.js', 'text/javascript; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/demo-icons/385.png': ['demo-icons/385.png', 'image/png'],
        '/demo-icons/554.png': ['demo-icons/554.png', 'image/png'],
        '/demo-icons/995.png': ['demo-icons/995.png', 'image/png'],
        '/demo-icons/2347.png': ['demo-icons/2347.png', 'image/png'],
      };
      const path = req.url.split('?')[0];
      const skillIcon = /^\/skill-icons\/([a-z]+)\.png$/.exec(path);
      if (req.method === 'GET' && skillIcon && SKILLS.includes(skillIcon[1].toUpperCase())) {
        const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/skill-icons', `${skillIcon[1]}.png`));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(bytes);
      }
      if (req.method === 'GET' && path === '/logo') {
        res.writeHead(200, { 'Content-Type': branding.logoImage.type, 'Cache-Control': 'no-cache' });
        return res.end(branding.logoImage.bytes);
      }
      if (req.method === 'GET' && path === '/map-icon') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        return res.end(branding.mapIconImage.bytes);
      }
      if (req.method === 'GET' && path === '/map-config') return respond(200, worldMap?.config() ?? { tiles: null });
      if (req.method === 'GET' && path === '/theme.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(themeCss());
      }
      if (req.method === 'GET' && Object.hasOwn(assets, req.url)) {
        const [file, type] = assets[req.url];
        let bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public', file));
        if (file === 'index.html') bytes = renderSiteHtml(bytes.toString('utf8'));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(bytes);
      }
      let member;
      if (access) {
        try {
          member = await access.authenticate(req.headers.authorization);
        } catch (error) {
          logger.error('Discord access check failed:', error);
          return respond(503, { error: 'Discord verification unavailable. Try again shortly.' });
        }
      } else {
        member = authenticate(req.headers.authorization, members);
      }
      if (!member) return respond(401, { error: 'Unauthorized' });
      let permissions = permissionsFor(member);
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/v1/live-xp') {
        if (!permissions.stats) return respond(403, { error: 'Stats and XP viewing is disabled for this member' });
        if (liveXp.waiters.size >= 50) return respond(429, { error: 'Too many live XP viewers; retry shortly' });
        const controller = new AbortController();
        const onClose = () => controller.abort();
        res.once('close', onClose);
        let result;
        try {
          result = await liveXp.poll(url.searchParams.get('after'), controller.signal);
        } finally {
          res.removeListener('close', onClose);
        }
        if (res.destroyed) return;
        if (access) {
          try {
            const current = await access.authenticate(req.headers.authorization);
            if (!current) return respond(401, { error: 'Unauthorized' });
            permissions = permissionsFor(current);
            if (!permissions.stats) return respond(403, { error: 'Stats and XP viewing is disabled for this member' });
          } catch (error) {
            logger.error('Live XP Discord access check failed:', error);
            return respond(503, { error: 'Discord verification unavailable. Try again shortly.' });
          }
        }
        const allowed = allowedNames();
        return respond(200, { ...result, drops: result.drops.filter(drop => allowed.has(normalize(drop.username))) });
      }
      const readJson = async limit => {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) {
            respond(413, { error: 'Body too large' });
            return undefined;
          }
          chunks.push(chunk);
        }
        try {
          return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        } catch {
          respond(400, { error: 'Invalid JSON' });
          return undefined;
        }
      };
      const tokenRoute = /^\/v1\/member-tokens(?:\/([a-f0-9]{32}))?$/.exec(url.pathname);
      if (tokenRoute) {
        const role = access && await access.managementRole(member);
        if (!role) {
          return respond(403, { error: 'Group management permission is required' });
        }
        const tokenId = tokenRoute[1];
        if (req.method === 'GET' && !tokenId) return respond(200, { tokens: access.listMemberTokens() });
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
            (req.method === 'POST' ? Boolean(tokenId) : !tokenId)) {
          return respond(405, { error: 'Unsupported token operation' });
        }
        try {
          if (req.method === 'DELETE') {
            access.removeMemberToken(tokenId, member, role);
            return respond(200, { ok: true });
          }
          const parsed = await readJson(4096);
          if (!parsed) return;
          if (req.method === 'PATCH') {
            access.updateMemberToken(tokenId, member, role, parsed.body);
            return respond(200, { ok: true });
          }
          const result = await access.issueMemberToken(member, parsed.body?.name, tokenId);
          return respond(req.method === 'POST' ? 201 : 200, result);
        } catch (error) {
          if (!error.message.startsWith('member token:')) throw error;
          return respond(400, { error: error.message.slice('member token: '.length) });
        }
      }
      if (url.pathname === '/v1/me' || url.pathname === '/v1/settings') {
        let admin;
        try {
          admin = await isAdmin(member);
        } catch (error) {
          logger.error('Discord admin check failed:', error);
          return respond(503, { error: 'Discord permission check unavailable. Try again shortly.' });
        }
        if (req.method === 'GET' && url.pathname === '/v1/me') {
          const characters = memberCharacters(store, member);
          return respond(200, { name: characters[0] ?? null, characters, admin,
            ...(access ? await access.viewer(member) : { role: admin ? 'owner' : 'member', admin, canManageGroup: admin, permissions }) });
        }
        if (url.pathname === '/v1/settings' && !['GET', 'PUT'].includes(req.method)) return respond(404, { error: 'Not found' });
        if (!admin) return respond(403, { error: 'Only Discord members with Manage Server permission can change settings' });
        if (req.method === 'GET') return respond(200, editableBranding());
        const parsed = await readJson(10 * 1024 * 1024);
        if (!parsed) return;
        try {
          const result = await saveBranding({
            settings: parsed.body?.settings, logo: parsed.body?.logo, removeLogo: parsed.body?.removeLogo === true,
            mapIcon: parsed.body?.mapIcon, removeMapIcon: parsed.body?.removeMapIcon === true,
          });
          logger.log(`Settings updated by ${memberCharacters(store, member)[0] ?? 'a group admin'}`);
          return respond(200, result);
        } catch (error) {
          if (!error.message.startsWith('branding:')) throw error;
          return respond(400, { error: error.message.replace(/^branding: /, '') });
        }
      }
      if (req.method === 'GET' && url.pathname === '/v1/xp') {
        if (!permissions.stats) return respond(403, { error: 'Stats and XP viewing is disabled for this member' });
        const range = url.searchParams.get('range') ?? '24h';
        if (!Object.hasOwn(XP_RANGES, range)) return respond(400, { error: 'Invalid XP range' });
        return respond(200, xpSeries(store.state.xpHistory ?? {},
          allCharacters(store, members).map(name => ({ name, key: normalize(name) })), range));
      }
      if (req.method === 'GET' && req.url === '/v1/group') {
        const allowed = allowedNames();
        const group = Object.values(store.state.members).filter(value => allowed.has(normalize(value.username)));
        const shared = group.filter(value => value.groupStorage != null)
          .sort((a, b) => b.groupStorageUpdatedAt - a.groupStorageUpdatedAt)[0];
        return respond(200, {
          members: group.map(value => ({
            username: value.username, updatedAt: value.updatedAt,
            ...(permissions.stats ? { stats: value.stats, questPoints: value.questPoints } : {}),
            position: permissions.locations ? value.position : null,
            bank: permissions.banks ? value.bank : null,
            bankUpdatedAt: permissions.banks ? value.bankUpdatedAt : null,
            borrowedItems: permissions.storage && value.borrowedItemsShared &&
              value.borrowedItemsUpdatedAt != null && Date.now() - value.borrowedItemsUpdatedAt <= 120000
                ? value.borrowedItems : null,
          })),
          groupStorage: permissions.storage && shared ? { items: shared.groupStorage, updatedAt: shared.groupStorageUpdatedAt, username: shared.username } : null,
          icons: store.icons([
            ...(permissions.banks ? group.flatMap(value => (value.bank ?? []).map(item => item.id)) : []),
            ...(permissions.storage && shared ? shared.groupStorage.map(item => item.id) : []),
          ]),
          activity: permissions.activity ? store.state.activity.filter(event => allowed.has(normalize(event.username))).slice().reverse() : [],
          viewer: access ? await access.viewer(member) : { role: 'member', canManageGroup: false, admin: false, permissions },
          groupSize: Math.max(members.length, allowed.size),
          pendingDiscord: store.state.outbox.length,
        });
      }
      if (req.method !== 'POST' || !['/v1/snapshot', '/v1/events', '/v1/icons', '/v1/xp-drops'].includes(req.url)) {
        return respond(404, { error: 'Not found' });
      }
      const parsed = await readJson(524288);
      if (!parsed) return;
      const { body } = parsed;
      const username = typeof body?.username === 'string' ? body.username : '';
      if (req.url === '/v1/xp-drops') {
        if (!validXpBatch(body)) return respond(400, { error: 'Invalid XP drops (only recent positive skill XP events are accepted)' });
        if (!memberCharacters(store, member).some(name => normalize(name) === normalize(username))) {
          return respond(403, { error: 'XP drops can only be uploaded for your own linked character; sync a snapshot first' });
        }
        return respond(200, { ok: true, accepted: liveXp.publish(username, body.drops) });
      }
      if (req.url === '/v1/icons') {
        if (!memberCharacters(store, member).some(name => normalize(name) === normalize(username))) {
          return respond(403, { error: 'Icons can only be uploaded for your own linked character' });
        }
        if (!validIcons(body.icons)) return respond(400, { error: 'Invalid item icons' });
        const saved = store.state.members[normalize(username)];
        const bankIds = new Set([...(saved?.bank ?? []), ...(saved?.groupStorage ?? [])].map(item => String(item.id)));
        if (Object.keys(body.icons).some(id => !bankIds.has(id))) {
          return respond(403, { error: 'Only icons from your shared bank can be uploaded' });
        }
        store.saveIcons(body.icons);
        return respond(200, { ok: true });
      }
      const snapshotRequest = req.url === '/v1/snapshot';
      if (!(snapshotRequest ? validSnapshot(body) : validEvent(body))) {
        return respond(400, { error: snapshotRequest ? 'Invalid snapshot' : 'Invalid event' });
      }
      const denied = claimCharacter(member, username);
      if (denied) return respond(403, { error: denied });
      if (snapshotRequest) {
        store.snapshot(body);
        return respond(200, { ok: true });
      }
      const accepted = store.event(body);
      return respond(200, { ok: true, accepted });
    } catch (error) {
      logger.error('Bridge request failed:', error);
      if (!res.headersSent) respond(500, { error: 'Server failed to persist request' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.once('close', () => liveXp.close());
  return server;
}

export const escapeDiscord = value => String(value).replace(/([\\`*_~|>])/g, '\\$1')
  .replaceAll('@', '@\u200b');

export function formatEvent(event) {
  const name = escapeDiscord(event.username);
  switch (event.type) {
    case 'chat': return `[GIM] **${name}:** ${escapeDiscord(event.message)}`;
    case 'boss': return `**${name}** defeated **${escapeDiscord(event.boss)}** - KC **${event.kc.toLocaleString('en-US')}**`;
    case 'quest': return `**${name}** completed **${escapeDiscord(event.quest)}**!`;
    case 'diary': return `**${name}** completed the **${escapeDiscord(event.diary)}** Achievement Diary!`;
    case 'loot': {
      const drops = event.items.map(item => `${item.qty.toLocaleString('en-US')} x ${escapeDiscord(item.name)}`).join(', ');
      return `**${name}** received ${drops} from **${escapeDiscord(event.source)}**${event.kc == null ? '' : ` (KC ${event.kc})`}`;
    }
    default: throw new Error('Unknown event type');
  }
}

// Columns in the same order as the in-game skills tab.
const SKILL_TAB = [
  ['ATTACK', 'STRENGTH', 'DEFENCE', 'RANGED', 'PRAYER', 'MAGIC', 'RUNECRAFT', 'CONSTRUCTION'],
  ['HITPOINTS', 'AGILITY', 'HERBLORE', 'THIEVING', 'CRAFTING', 'FLETCHING', 'SLAYER', 'HUNTER'],
  ['MINING', 'SMITHING', 'FISHING', 'COOKING', 'FIREMAKING', 'WOODCUTTING', 'FARMING', 'SAILING'],
];
export const DEFAULT_SKILL_EMOJIS = Object.freeze({
  ATTACK: '⚔️', STRENGTH: '💪', DEFENCE: '🛡️', RANGED: '🏹', PRAYER: '🙏', MAGIC: '🔮',
  RUNECRAFT: '🌀', CONSTRUCTION: '🔨', HITPOINTS: '❤️', AGILITY: '🏃', HERBLORE: '🌿',
  THIEVING: '💰', CRAFTING: '✂️', FLETCHING: '🪶', SLAYER: '💀', HUNTER: '🐾', MINING: '⛏️',
  SMITHING: '⚒️', FISHING: '🎣', COOKING: '🍳', FIREMAKING: '🔥', WOODCUTTING: '🪓',
  FARMING: '🌱', SAILING: '⛵', TOTAL: '📊', COMBAT: '⚔️', QUEST: '🔵',
});

export function validateSkillEmojis(emojis) {
  if (!emojis || typeof emojis !== 'object' || Array.isArray(emojis)) throw new Error('Skill emojis must be a JSON object');
  for (const [name, value] of Object.entries(emojis)) {
    if (!Object.hasOwn(DEFAULT_SKILL_EMOJIS, name)) throw new Error(`Unknown skill emoji ${name}`);
    if (typeof value !== 'string' || !/^(<a?:\w{2,32}:\d{17,20}>|[^\s<>@#`]{1,16})$/u.test(value)) {
      throw new Error(`Skill emoji ${name} must be a Discord emoji like <:attack:123456789012345678>`);
    }
  }
  return emojis;
}

export function combatLevel(stats) {
  const level = skill => stats[skill]?.level ?? (skill === 'HITPOINTS' ? 10 : 1);
  const base = 0.25 * (level('DEFENCE') + level('HITPOINTS') + Math.floor(level('PRAYER') / 2));
  const melee = 0.325 * (level('ATTACK') + level('STRENGTH'));
  const range = 0.325 * Math.floor(level('RANGED') * 1.5);
  const mage = 0.325 * Math.floor(level('MAGIC') * 1.5);
  return Math.floor(base + Math.max(melee, range, mage));
}

export function statsReply(content, state, memberNames, emojis = {}) {
  const match = /^!stats(?:\s+(.+?))?\s*$/i.exec(content);
  if (!match) return null;
  if (!match[1]) return { content: 'Usage: !stats playername' };
  const name = normalize(match[1]);
  if (!memberNames.some(member => normalize(member) === name)) return { content: 'That player is not in this private group.' };
  const member = state.members[name];
  if (!member) return { content: 'No synced stats yet. That player must log in with the plugin connected.' };
  const icon = skill => emojis[skill] ?? DEFAULT_SKILL_EMOJIS[skill];
  const stats = member.stats;
  const values = Object.values(stats);
  const total = values.reduce((sum, value) => sum + value.level, 0);
  const totalXp = values.reduce((sum, value) => sum + value.xp, 0);
  const combat = combatLevel(stats);
  const questPoints = Number.isInteger(member.questPoints) ? member.questPoints : null;
  const skillFields = SKILL_TAB.map(column => ({
    name: '\u200b',
    value: column.filter(skill => stats[skill])
      .map(skill => `${icon(skill)} **${stats[skill].level}**`).join('\n') || '\u200b',
    inline: true,
  }));
  const maxed = values.filter(value => value.level >= 99).length;
  const pill = value => `\`\u2002${value}\u2002\``;
  const summaryFields = [
    { name: 'Combat Level', value: pill(combat), inline: true },
    { name: 'Total Level', value: pill(total.toLocaleString('en-US')), inline: true },
    { name: 'Quest Points', value: pill(questPoints === null ? '—' : questPoints), inline: true },
    { name: 'Total Experience', value: pill(totalXp.toLocaleString('en-US')), inline: true },
    { name: 'Skills at 99', value: pill(`${maxed} / ${values.length}`), inline: true },
    { name: 'Last Synced', value: `<t:${Math.floor(member.updatedAt / 1000)}:R>`, inline: true },
  ];
  return {
    card: { username: member.username, stats, combat, total, questPoints },
    summaryFields,
    embeds: [{
      author: { name: embedTitle('stats') },
      title: member.username,
      color: embedColor('stats'),
      fields: [...summaryFields, ...skillFields],
      footer: { text: BRAND },
      timestamp: new Date(member.updatedAt).toISOString(),
    }],
  };
}

// Saved RuneLite kill counts merged with kills the plugin has observed, keyed by hiscore boss name.
export function killCountsFor(state, name) {
  const key = normalize(name);
  const counts = new Map();
  const add = (raw, kc) => {
    const boss = bossName(raw);
    const previous = counts.get(normalize(boss));
    if (!previous || kc > previous.kc) counts.set(normalize(boss), { boss, kc });
  };
  for (const [boss, kc] of Object.entries(state.members?.[key]?.killCounts ?? {})) {
    if (isHiscoreBoss(boss)) add(boss, kc);
  }
  for (const [boss, kc] of Object.entries(state.hiscores?.[key] ?? {})) add(boss, kc);
  for (const value of Object.values(state.kc?.[key] ?? {})) add(value.boss, value.kc);
  return [...counts.values()].sort((a, b) => b.kc - a.kc || a.boss.localeCompare(b.boss));
}

const KC_USAGE = 'Usage: `!kc`, `!kc player`, `!kc boss` or `!kc player boss`';

export function kcReply(content, state, memberNames, authorNames = []) {
  const match = /^!kc(?:\s+(.+?))?\s*$/i.exec(content);
  if (!match) return null;
  const words = (match[1] ?? '').split(/\s+/).filter(Boolean);
  // The longest leading run of words that names a group character selects the player.
  let player = null;
  let rest = words;
  for (let size = words.length; size > 0 && !player; size--) {
    const candidate = normalize(words.slice(0, size).join(' '));
    player = memberNames.find(name => normalize(name) === candidate) ?? null;
    if (player) rest = words.slice(size);
  }
  const boss = rest.join(' ');
  const players = player ? [player] : authorNames;
  if (players.length === 0) {
    return { content: words.length ? `That player is not in this private group. ${KC_USAGE}`
      : `No linked character found. ${KC_USAGE}` };
  }
  const embeds = [], cards = [];
  for (const name of players.slice(0, 5)) {
    const member = state.members?.[normalize(name)];
    const username = member?.username ?? name;
    const all = killCountsFor(state, name);
    let counts = all;
    if (boss) {
      const wanted = normalize(bossName(boss));
      const exact = all.filter(value => normalize(value.boss) === wanted);
      counts = exact.length ? exact : all.filter(value => normalize(value.boss).includes(normalize(boss)));
    }
    const total = counts.reduce((sum, value) => sum + value.kc, 0);
    const lines = counts.map(value => `**${escapeDiscord(value.boss)}** — ${value.kc.toLocaleString('en-US')}`);
    let description = '';
    let shown = 0;
    for (const line of lines) {
      if (description.length + line.length + 40 > 4000) break;
      description += `${line}\n`;
      shown++;
    }
    if (shown < lines.length) description += `…and ${lines.length - shown} more`;
    const pill = value => `\`\u2002${value}\u2002\``;
    let fields = [];
    if (counts.length === 0) {
      description = boss ? `No kill count found for **${escapeDiscord(boss)}**.`
        : 'No kill counts synced yet. Log in with the plugin connected and **Boss KC alerts** enabled.';
    } else if (boss && counts.length === 1) {
      fields = [{ name: counts[0].boss, value: pill(counts[0].kc.toLocaleString('en-US')), inline: true }];
    } else {
      fields = [
        { name: boss ? 'Matching KC' : 'Total KC', value: pill(total.toLocaleString('en-US')), inline: true },
        { name: 'Top Boss', value: pill(`${counts[0].boss} · ${counts[0].kc.toLocaleString('en-US')}`), inline: true },
      ];
    }
    if (member?.updatedAt) fields.push({ name: 'Last Synced', value: `<t:${Math.floor(member.updatedAt / 1000)}:R>`, inline: true });
    embeds.push({
      author: { name: 'Kill Counts' },
      title: username,
      description,
      fields,
      color: embedColor('boss'),
      footer: { text: BRAND },
      ...(member?.updatedAt ? { timestamp: new Date(member.updatedAt).toISOString() } : {}),
    });
    cards.push(counts.length ? { username, counts, total, filtered: Boolean(boss) } : null);
  }
  return { embeds, cards };
}

export const ALERT_CHANNEL_SETTINGS = Object.freeze({
  loot: 'DISCORD_DROPS_CHANNEL_ID',
  boss: 'DISCORD_KILLS_CHANNEL_ID',
  quest: 'DISCORD_QUESTS_CHANNEL_ID',
  // Achievement diaries share the quest channel until they get their own.
  diary: 'DISCORD_QUESTS_CHANNEL_ID',
  chat: 'DISCORD_CHAT_CHANNEL_ID',
});

// Blank per-alert settings fall back to the main DISCORD_CHANNEL_ID.
export function alertChannelIds(env) {
  const main = env.DISCORD_CHANNEL_ID?.trim();
  if (!/^\d{17,20}$/.test(main ?? '')) throw new Error('DISCORD_CHANNEL_ID must be a Discord channel ID');
  const channels = {};
  for (const [type, setting] of Object.entries(ALERT_CHANNEL_SETTINGS)) {
    const value = env[setting]?.trim();
    if (value && !/^\d{17,20}$/.test(value)) throw new Error(`${setting} must be a Discord channel ID or blank`);
    channels[type] = value || main;
  }
  return channels;
}

export async function deliverPending(store, send) {
  const event = store.state.outbox[0];
  if (!event) return false;
  await send(formatEvent(event), event);
  store.state.outbox.shift();
  try {
    store.save();
  } catch (error) {
    store.state.outbox.unshift(event);
    throw error;
  }
  return true;
}
