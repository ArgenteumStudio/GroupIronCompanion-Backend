import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAX_CHARACTERS, characterOwner, escapeDiscord, memberCharacters, normalize, validateMembers } from './bridge.js';
import { brandedEmbed, brandFiles } from './alertEmbed.js';
import { embedColor, embedTitle } from './branding.js';
import { DEFAULT_PERMISSIONS, permissionsFor, validPermissions, withinPermissions } from './permissions.js';

const digest = key => createHash('sha256').update(key).digest('hex');

export function validateDiscordMembers(members) {
  validateMembers(members, { discord: true });
}

// Resolves a guild member (or null when they are not in the server). Concurrent lookups share one
// Discord request, and confirmed members are reused for ttlMillis so every dashboard request does not
// wait on Discord's rate-limited REST API. Absent members and errors are never cached.
export function discordMemberLookup(discord, guildId, { ttlMillis = 0, now = Date.now } = {}) {
  const cached = new Map();
  const inflight = new Map();
  const generation = new Map();
  const lookup = async discordId => {
    if (!discord.isReady()) throw new Error('Discord is disconnected');
    const guild = discord.guilds.cache.get(guildId);
    if (!guild || !guild.available) throw new Error('Configured Discord server is unavailable');
    const hit = cached.get(discordId);
    if (hit && hit.expires > now()) return hit.member;
    cached.delete(discordId);
    if (inflight.has(discordId)) return inflight.get(discordId);
    const started = generation.get(discordId) ?? 0;
    const request = (async () => {
      try {
        await null; // Ensure `request` is assigned before the finally block can run.
        const member = await guild.members.fetch({ user: discordId, force: true, cache: false });
        if (ttlMillis > 0 && (generation.get(discordId) ?? 0) === started) {
          cached.set(discordId, { member, expires: now() + ttlMillis });
        }
        return member;
      } catch (error) {
        if (error.code === 10007) return null; // Discord's Unknown Member response.
        throw error;
      } finally {
        if (inflight.get(discordId) === request) inflight.delete(discordId);
      }
    })();
    inflight.set(discordId, request);
    return request;
  };
  lookup.invalidate = discordId => {
    generation.set(discordId, (generation.get(discordId) ?? 0) + 1);
    cached.delete(discordId);
    inflight.delete(discordId);
  };
  return lookup;
}

export function discordMembership(discord, guildId, lookup = discordMemberLookup(discord, guildId)) {
  return async discordId => await lookup(discordId) !== null;
}

export function discordAdmin(discord, guildId, lookup = discordMemberLookup(discord, guildId)) {
  return async discordId => (await lookup(discordId))?.permissions.has('ManageGuild') === true;
}

export class DiscordAccess {
  constructor({ store, members, isMember, isAdmin = async () => false, now = Date.now }) {
    validateDiscordMembers(members);
    this.store = store;
    this.members = members;
    this.isMember = isMember;
    this.checkAdmin = isAdmin;
    this.now = now;
    this.pending = new Set();
    this.revoked = new Set();
    this.revokedMemberTokens = new Set();
    this.ownerEpoch = new Map();
    this.lastAttempt = new Map();
  }

  saveKeys(keys) {
    const previous = this.store.state.accessKeys;
    this.store.state.accessKeys = keys;
    try {
      this.store.save();
    } catch (error) {
      if (previous === undefined) delete this.store.state.accessKeys;
      else this.store.state.accessKeys = previous;
      throw error;
    }
  }

  revoke(discordId) {
    this.ownerEpoch.set(discordId, (this.ownerEpoch.get(discordId) ?? 0) + 1);
    this.revoked.add(discordId);
    const previousTokens = this.store.state.memberTokens;
    const owned = Object.entries(previousTokens ?? {}).filter(([, record]) => record.createdBy === discordId);
    for (const [id] of owned) this.revokedMemberTokens.add(id);
    if (!Object.hasOwn(this.store.state.accessKeys ?? {}, discordId) && !owned.length) return;
    const keys = { ...this.store.state.accessKeys };
    delete keys[discordId];
    this.store.state.memberTokens = Object.fromEntries(
      Object.entries(previousTokens ?? {}).filter(([, record]) => record.createdBy !== discordId));
    try {
      this.saveKeys(keys);
    } catch (error) {
      if (previousTokens === undefined) delete this.store.state.memberTokens;
      else this.store.state.memberTokens = previousTokens;
      throw error;
    }
  }

  listMemberTokens() {
    return Object.entries(this.store.state.memberTokens ?? {}).map(([id, record]) => ({
      id, name: record.name, createdAt: record.createdAt, rotatedAt: record.rotatedAt ?? null,
      role: record.role ?? 'member', permissions: { ...DEFAULT_PERMISSIONS, ...record.permissions },
    }));
  }

  saveMemberTokens(tokens) {
    const previous = this.store.state.memberTokens;
    this.store.state.memberTokens = tokens;
    try {
      this.store.save();
    } catch (error) {
      if (previous === undefined) delete this.store.state.memberTokens;
      else this.store.state.memberTokens = previous;
      throw error;
    }
  }

  async managementRole(actor) {
    if (actor?.memberTokenId) {
      const current = this.store.state.memberTokens?.[actor.memberTokenId];
      return current && !this.revokedMemberTokens.has(actor.memberTokenId) &&
        current.hash === actor.tokenHash && current.role === 'manager' ? 'manager' : null;
    }
    return this.members.includes(actor) && !this.revoked.has(actor.discordId) &&
      await this.isMember(actor.discordId) && await this.isAdmin(actor) &&
      !this.revoked.has(actor.discordId) ? 'owner' : null;
  }

  async viewer(actor) {
    const role = await this.managementRole(actor);
    return { role: role ?? 'member', admin: role === 'owner', canManageGroup: Boolean(role), permissions: permissionsFor(actor) };
  }

  assertTarget(actor, role, record, { readsKey = false, permissions } = {}) {
    if (role === 'owner') {
      if (!this.members.includes(actor) || this.revoked.has(actor.discordId)) {
        throw new Error('member token: Owner access changed');
      }
      return;
    }
    if (role !== 'manager' || record?.role === 'manager') {
      throw new Error('member token: Only the owner can manage managers');
    }
    const current = this.store.state.memberTokens?.[actor.memberTokenId];
    if (!current || current.role !== 'manager' || current.hash !== actor.tokenHash) {
      throw new Error('member token: Manager access changed');
    }
    const ceiling = { ...DEFAULT_PERMISSIONS, ...current.permissions };
    if ((readsKey && !withinPermissions({ ...DEFAULT_PERMISSIONS, ...record?.permissions }, ceiling)) ||
        (permissions && !withinPermissions(permissions, ceiling))) {
      throw new Error('member token: Managers cannot grant or retrieve access beyond their own viewing permissions');
    }
  }

  async issueMemberToken(owner, name, tokenId) {
    const role = await this.managementRole(owner);
    if (!role) throw new Error('member token: Group management permission is required');
    const records = this.store.state.memberTokens ?? {};
    const existing = tokenId ? records[tokenId] : undefined;
    if (tokenId && !existing) throw new Error('member token: Token not found');
    this.assertTarget(owner, role, existing, { readsKey: Boolean(existing) });
    const character = existing?.name ?? (typeof name === 'string' ? name.trim() : '');
    if (!/^[a-zA-Z0-9 _-]{1,12}$/.test(character) || !normalize(character)) {
      throw new Error('member token: Enter a valid RuneScape character name (1-12 characters)');
    }
    if (!existing && characterOwner(this.store, this.members, character)) {
      throw new Error('member token: This character already has an owner; rotate its token instead');
    }
    if (!existing && Object.keys(records).length >= 25) {
      throw new Error('member token: Limit of 25 member tokens reached; revoke an unused token first');
    }
    const id = tokenId ?? randomBytes(16).toString('hex');
    const key = randomBytes(32).toString('hex');
    const record = {
      name: character, hash: digest(key),
      createdBy: role === 'owner' ? owner.discordId : records[owner.memberTokenId].createdBy,
      createdAt: existing?.createdAt ?? this.now(),
      role: existing?.role ?? 'member',
      permissions: existing?.permissions ?? (role === 'owner' ? { ...DEFAULT_PERMISSIONS }
        : { ...DEFAULT_PERMISSIONS, ...records[owner.memberTokenId].permissions }),
      ...(existing ? { rotatedAt: this.now() } : {}),
    };
    this.saveMemberTokens({ ...records, [id]: record });
    this.revokedMemberTokens.delete(id);
    return { id, name: character, key };
  }

  removeMemberToken(id, actor, role) {
    if (!Object.hasOwn(this.store.state.memberTokens ?? {}, id)) {
      throw new Error('member token: Token not found');
    }
    if (actor) this.assertTarget(actor, role, this.store.state.memberTokens[id]);
    this.revokedMemberTokens.add(id);
    const records = { ...this.store.state.memberTokens };
    delete records[id];
    this.saveMemberTokens(records);
  }

  updateMemberToken(id, actor, role, changes) {
    const record = this.store.state.memberTokens?.[id];
    if (!record) throw new Error('member token: Token not found');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
        Object.keys(changes).some(key => !['role', 'permissions'].includes(key)) ||
        !Object.keys(changes).length ||
        (changes.role !== undefined && !['member', 'manager'].includes(changes.role)) ||
        (changes.permissions !== undefined && !validPermissions(changes.permissions))) {
      throw new Error('member token: Supply a valid role and/or all five viewing permissions');
    }
    this.assertTarget(actor, role, record, { permissions: changes.permissions });
    if (changes.role !== undefined && role !== 'owner') {
      throw new Error('member token: Only the owner can promote or demote managers');
    }
    this.saveMemberTokens({ ...this.store.state.memberTokens, [id]: { ...record, ...changes } });
  }

  async issue(discordId, sendPrivate) {
    const last = this.lastAttempt.get(discordId);
    if (this.pending.has(discordId) || (last !== undefined && this.now() - last < 60000)) {
      throw new Error('Wait one minute before requesting another key.');
    }
    this.lastAttempt.set(discordId, this.now());
    for (const [id, time] of this.lastAttempt) if (this.now() - time >= 60000) this.lastAttempt.delete(id);
    const member = this.members.find(value => value.discordId === discordId);
    if (!member) throw new Error('Your Discord account is not approved. Ask the group owner to add your Discord ID.');
    const epoch = this.ownerEpoch.get(discordId) ?? 0;
    this.pending.add(discordId);
    try {
      if (!await this.isMember(discordId)) {
        this.revoke(discordId);
        throw new Error('You must be in the configured Discord server to verify.');
      }
      if (!await this.isAdmin(member)) {
        this.revoke(discordId);
        throw new Error('Only the configured group owner with Manage Server permission can verify. Members need an owner-issued token.');
      }
      const key = randomBytes(32).toString('hex');
      await sendPrivate({ key, characters: memberCharacters(this.store, member) });
      // Recheck after DM delivery so a leave during verification cannot create a new key.
      if (!await this.isMember(discordId) || !await this.isAdmin(member) ||
          (this.ownerEpoch.get(discordId) ?? 0) !== epoch) {
        this.revoke(discordId);
        throw new Error('Discord membership changed. Verification was not completed.');
      }
      this.saveKeys({
        ...this.store.state.accessKeys,
        [discordId]: { hash: digest(key) },
      });
      this.revoked.delete(discordId);
    } finally {
      this.pending.delete(discordId);
    }
  }

  // Group admins are verified members with Discord's "Manage Server" permission.
  async isAdmin(member) {
    return Boolean(member?.discordId) && await this.checkAdmin(member.discordId) === true;
  }

  async authenticate(header) {
    if (typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) return undefined;
    const supplied = Buffer.from(digest(header.slice(7)), 'hex');
    const member = this.members.find(value => {
      if (this.revoked.has(value.discordId)) return false;
      const record = this.store.state.accessKeys?.[value.discordId];
      return typeof record?.hash === 'string' && /^[a-f0-9]{64}$/.test(record.hash) &&
        timingSafeEqual(supplied, Buffer.from(record.hash, 'hex'));
    });
    if (!member) {
      const match = Object.entries(this.store.state.memberTokens ?? {}).find(([id, record]) =>
        !this.revokedMemberTokens.has(id) && typeof record.hash === 'string' &&
        /^[a-f0-9]{64}$/.test(record.hash) &&
        timingSafeEqual(supplied, Buffer.from(record.hash, 'hex')));
      if (!match) return undefined;
      const [id, record] = match;
      const owner = this.members.find(value => value.discordId === record.createdBy);
      if (!owner || this.revoked.has(record.createdBy)) return undefined;
      if (!await this.isMember(owner.discordId)) {
        this.revoke(owner.discordId);
        return undefined;
      }
      if (!await this.isAdmin(owner)) {
        this.revoke(owner.discordId);
        return undefined;
      }
      return !this.revoked.has(owner.discordId) && !this.revokedMemberTokens.has(id) &&
        this.members.includes(owner) && this.store.state.memberTokens?.[id] === record
        ? { name: record.name, memberTokenId: id, tokenHash: record.hash,
          role: record.role ?? 'member', permissions: { ...DEFAULT_PERMISSIONS, ...record.permissions } } : undefined;
    }
    let present;
    try {
      present = await this.isMember(member.discordId);
    } catch (cause) {
      throw new Error('Discord membership could not be checked', { cause });
    }
    if (!present || !await this.isAdmin(member)) {
      this.revoke(member.discordId);
      return undefined;
    }
    // Rotation or a removal event may have happened while the membership request was pending.
    const record = this.store.state.accessKeys?.[member.discordId];
    return !this.revoked.has(member.discordId) &&
      record?.hash === supplied.toString('hex')
      ? member : undefined;
  }
}

const VERIFY_COLORS = { ok: 'success', warn: 'warning', error: 'error', key: 'key' };

export function keyMessage({ key, characters = [] }, now = Date.now()) {
  const linked = characters.length
    ? `Linked characters: **${characters.map(escapeDiscord).join(', ')}**`
    : `Your characters link automatically the first time you log in with the plugin (up to ${MAX_CHARACTERS}, alts included).`;
  return {
    embeds: [{
      ...brandedEmbed({ category: embedTitle('key'), color: embedColor(VERIFY_COLORS.key), timestamp: now }),
      title: 'Your private access key',
      description: `${linked}\n\`\`\`\n${key}\n\`\`\``,
      fields: [
        { name: '1. RuneLite plugin', value: 'Configuration → **Group Iron Companion** plugin → paste into **Member token**.' },
        { name: '2. Group website', value: 'Paste into the **Access key** field when prompted.' },
        { name: 'Keep it secret', value: 'Anyone with this key can view group data and sync as you. ' +
          'Your previous key, if any, stops working now. Leaving the Discord server revokes it. ' +
          'Run `!verify` again any time to rotate it.' },
        { name: 'Never share', value: 'Staff will never ask for this key or your RuneScape password.' },
        { name: 'Group owners', value: 'Keep this owner key private. With Manage Server permission, open the website Manage group tab to generate separate character-specific tokens, set viewing permissions and promote managers. Members do not need Discord verification.' },
      ],
    }],
    files: brandFiles(),
  };
}

function statusMessage(title, description, color) {
  return {
    embeds: [{ ...brandedEmbed({ category: embedTitle('verification'), color: embedColor(color), timestamp: Date.now() }), title, description }],
    files: brandFiles(),
  };
}

export async function verifyCommand(message, access, logger = console) {
  if (!/^!verify\s*$/i.test(message.content)) return false;
  let reply;
  try {
    await access.issue(message.author.id, async details => {
      await message.author.send({ ...keyMessage(details), allowedMentions: { parse: [] } });
    });
    reply = statusMessage('Verification complete',
      'Your private access key has been sent to your **direct messages**.', VERIFY_COLORS.ok);
  } catch (error) {
    // Discord API errors can include the DM request body containing the private key.
    logger.error('Discord verification failed:', {
      name: error.name, code: error.code,
      message: error.code === undefined ? error.message : 'Discord rejected the verification request',
    });
    reply = error.code === 50007
      ? statusMessage('Unable to send direct message',
        'Enable **Direct Messages** from server members (Server name → Privacy Settings), ' +
        'then run `!verify` again in one minute.', VERIFY_COLORS.warn)
      : /one minute/.test(error.message)
        ? statusMessage('Please wait', 'You can request a new key once per minute.', VERIFY_COLORS.warn)
        : statusMessage('Verification failed',
          'Owner verification requires an approved Discord account in this server with Manage Server permission. Members should ask the owner for a character token. ' +
          'Wait one minute and try again; if it still fails, contact the group owner.', VERIFY_COLORS.error);
  }
  await message.reply({ ...reply, allowedMentions: { parse: [], repliedUser: false } });
  return true;
}

// !characters lists your linked characters; !unlink <name> frees one (admins can unlink anyone's).
export async function linksCommand(message, access, logger = console) {
  const list = /^!characters\s*$/i.test(message.content);
  const unlink = /^!unlink\s+(.+?)\s*$/i.exec(message.content);
  if (!list && !unlink) return false;
  const { store, members } = access;
  const self = members.find(value => value.discordId === message.author.id);
  let reply;
  try {
    if (list) {
      const names = self ? memberCharacters(store, self) : [];
      reply = statusMessage('Linked characters', self
        ? names.length ? names.map(name => `• **${escapeDiscord(name)}**`).join('\n') +
          `\n\n${names.length} / ${MAX_CHARACTERS} slots used.`
          : 'None yet. Log in with the plugin connected and your character links automatically.'
        : 'Your Discord account is not part of this group.', self ? VERIFY_COLORS.ok : VERIFY_COLORS.error);
    } else {
      const name = unlink[1];
      const owner = characterOwner(store, members, name);
      const allowed = owner && (owner === self || await access.isAdmin(self));
      if (!owner) reply = statusMessage('Not linked', 'No group member has that character linked.', VERIFY_COLORS.warn);
      else if (!allowed) reply = statusMessage('Not allowed', 'You can only unlink your own characters.', VERIFY_COLORS.error);
      else if (owner.memberTokenId) {
        reply = statusMessage('Owner-issued token', 'Kick this character in the website Manage group tab to revoke its token.', VERIFY_COLORS.warn);
      } else if (owner.name !== undefined && normalize(owner.name) === normalize(name)) {
        reply = statusMessage('Set by the owner', 'That name is set in members.json; the group owner must change it there.', VERIFY_COLORS.warn);
      } else {
        store.unlink(owner.discordId, name);
        reply = statusMessage('Character unlinked', `**${escapeDiscord(name)}** is no longer linked. ` +
          'Logging in on it with the plugin will link it again.', VERIFY_COLORS.ok);
      }
    }
  } catch (error) {
    logger.error('Character link command failed:', error.message);
    reply = statusMessage('Something went wrong', 'Try again shortly.', VERIFY_COLORS.error);
  }
  await message.reply({ ...reply, allowedMentions: { parse: [], repliedUser: false } });
  return true;
}