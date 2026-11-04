import { readFileSync, existsSync } from 'node:fs';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { BRAND, Store, allCharacters, createBridge, deliverPending, statsReply, alertChannelIds, validateSkillEmojis } from './bridge.js';
import { DiscordAccess, discordAdmin, discordMemberLookup, discordMembership, linksCommand, validateDiscordMembers, verifyCommand } from './access.js';
import { withStatsCard } from './statsCard.js';
import { createWorldMap } from './worldMap.js';
import { alertMessage, spriteLoader } from './alertEmbed.js';
import { dirname, resolve } from 'node:path';

const required = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name} in .env`);
}
const members = JSON.parse(readFileSync(process.env.MEMBERS_FILE ?? 'members.json', 'utf8'));
validateDiscordMembers(members);
const alertChannels = alertChannelIds(process.env);
const statsChannelId = process.env.DISCORD_STATS_CHANNEL_ID?.trim() || process.env.DISCORD_CHANNEL_ID;
if (!/^\d{17,20}$/.test(statsChannelId)) throw new Error('DISCORD_STATS_CHANNEL_ID must be a Discord channel ID or blank');
const skillEmojiFile = process.env.SKILL_EMOJIS_FILE ?? 'skill-emojis.json';
const skillEmojis = existsSync(skillEmojiFile)
  ? validateSkillEmojis(JSON.parse(readFileSync(skillEmojiFile, 'utf8'))) : {};
const store = new Store(process.env.DATA_FILE ?? 'data/state.json');
const sprite = spriteLoader(resolve(dirname(store.file), 'icons'));
const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [], repliedUser: false },
});
const memberLookup = discordMemberLookup(discord, process.env.DISCORD_GUILD_ID, { ttlMillis: 30_000 });
const access = new DiscordAccess({
  store, members,
  isMember: discordMembership(discord, process.env.DISCORD_GUILD_ID, memberLookup),
  isAdmin: discordAdmin(discord, process.env.DISCORD_GUILD_ID, memberLookup),
});
discord.on(Events.GuildMemberUpdate, (_, member) => {
  if (member.guild.id === process.env.DISCORD_GUILD_ID) memberLookup.invalidate(member.id);
});
discord.on(Events.GuildMemberRemove, member => {
  if (member.guild.id !== process.env.DISCORD_GUILD_ID) return;
  memberLookup.invalidate(member.id);
  try {
    access.revoke(member.id);
  } catch (error) {
    console.error('Failed to persist Discord access revocation:', error);
  }
});
discord.on(Events.Error, error => console.error('Discord error:', error));
discord.on(Events.MessageCreate, async message => {
  if (message.author.bot || message.guildId !== process.env.DISCORD_GUILD_ID) return;
  try {
    if (message.channelId === process.env.DISCORD_CHANNEL_ID && await verifyCommand(message, access)) return;
    if ([process.env.DISCORD_CHANNEL_ID, statsChannelId].includes(message.channelId) &&
        await linksCommand(message, access)) return;
    if (message.channelId !== statsChannelId) return;
    if (!members.some(member => member.discordId === message.author.id)) return;
    const reply = statsReply(message.content, store.state, allCharacters(store, members), skillEmojis);
    if (reply === null) return;
    await message.reply({ ...await withStatsCard(reply), allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) {
    console.error('Failed to answer Discord command:', error);
  }
});

await discord.login(process.env.DISCORD_TOKEN);
if (!discord.isReady()) await new Promise(resolve => discord.once(Events.ClientReady, resolve));
const channels = new Map();
for (const id of new Set(Object.values(alertChannels))) {
  const channel = await discord.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable() || channel.guildId !== process.env.DISCORD_GUILD_ID) {
    discord.destroy();
    throw new Error(`Discord channel ${id} must be a sendable channel in the configured guild`);
  }
  channels.set(id, channel);
}
const bridge = createBridge({ store, members, access, worldMap: createWorldMap() });
const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
bridge.on('error', error => {
  console.error('HTTP server failed:', error);
  discord.destroy();
  process.exitCode = 1;
});
bridge.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`${BRAND} bridge listening on ${process.env.HOST ?? '127.0.0.1'}:${port}`);
});

let stopping = false;
let timer;
async function drain() {
  let delay = 1000;
  try {
    if (await deliverPending(store, async (content, event) => {
      const message = await alertMessage(event, { sprite }).catch(error => {
        console.error('Alert embed failed; sending plain text:', error);
        return { content: content.length > 1900 ? `${content.slice(0, 1870)}... (truncated)` : content };
      });
      return channels.get(alertChannels[event.type]).send({ ...message, allowedMentions: { parse: [] } });
    })) delay = 250;
  } catch (error) {
    console.error('Discord notification failed; event retained for retry:', error);
    delay = 15000;
  }
  if (!stopping) timer = setTimeout(drain, delay);
}
void drain();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true;
    clearTimeout(timer);
    bridge.close();
    discord.destroy();
  });
}
