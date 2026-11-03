import { xpSeries, smoothXpPath } from './xp.js';
import { initSettings } from './settings.js';
import { initWorldMap } from './world-map.js';
import { initMembers } from './members.js';
import { SKILLS, xpAtLevel } from './skills.js';
import { initBankTooltips } from './bank-tooltips.js';
import { tabSession } from './tab-session.js';
import { bankSummary, itemBankInfo } from './bank-info.js';
import { initMemberAccess } from './member-access.js';

const $ = id => document.getElementById(id);
const worldMap = initWorldMap({
  viewport: $('world-map'), tileLayer: $('map-tiles'), markerLayer: $('map-markers'),
  status: $('map-status'), planeSelect: $('map-plane'), zoomIn: $('map-zoom-in'),
  zoomOut: $('map-zoom-out'), fit: $('map-fit'), retry: $('map-retry'),
});
let xpRange = '24h';
let xpRequest = 0;
let token = '';
let mode = 'locked';
let data = { members: [], activity: [], groupSize: 5, pendingDiscord: 0 };
let generation = 0;
let canEditSettings = false;
let canManageGroup = false;
let accessSignature = '';
let session;
function clearTabSession() {
  try { session?.clear(); }
  catch (error) { showError(`Could not clear saved tab access: ${error.message}. Close this tab to end its session.`); }
}
const memberCards = initMembers({
  container: $('members'), status: $('live-xp-status'),
  authHeader: () => ({ Authorization: `Bearer ${token}` }), onUnauthorized: () => {
    lock();
    showError('Live access expired. Ask the owner for a valid member token, or verify again if you are the owner.');
  },
});
const bankTooltips = initBankTooltips($('bank-rows'));
const settings = initSettings({ authHeader: () => ({ Authorization: `Bearer ${token}` }), onError: message => showError(message) });
const groupManagement = initMemberAccess({ authHeader: () => ({ Authorization: `Bearer ${token}` }) });
const number = value => Number(value ?? 0).toLocaleString('en-US');
function stackQuantity(qty) {
  if (qty >= 10000000) return `${Math.floor(qty / 1000000)}M`;
  if (qty >= 100000) return `${Math.floor(qty / 1000)}K`;
  return String(qty);
}
const fresh = member => Date.now() - member.updatedAt < 30000;
const total = member => Object.values(member.stats ?? {}).reduce((sum, skill) => sum + skill.level, 0);
const allowed = key => data.viewer?.permissions?.[key] !== false;
function applyAccess(viewer) {
  viewer = { role: viewer?.role, admin: Boolean(viewer?.admin),
    canManageGroup: Boolean(viewer?.canManageGroup), permissions: viewer?.permissions };
  const signature = JSON.stringify(viewer);
  if (signature === accessSignature) return;
  accessSignature = signature;
  canEditSettings = Boolean(viewer?.admin);
  canManageGroup = Boolean(viewer?.canManageGroup);
  if (canEditSettings) void settings.show();
  else settings.hide();
  if (canManageGroup) void groupManagement.show(viewer);
  else groupManagement.hide();
  showView(false);
}
const age = time => {
  if (!time) return 'Not synced';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};
function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function unlock() {
  $('login').hidden = true;
  $('dashboard').hidden = false;
  $('logout').hidden = false;
  $('refresh').hidden = mode !== 'live';
  $('demo-banner').hidden = mode !== 'demo';
  showView(false);
}
function lock() {
  generation++;
  xpRequest++;
  mode = 'locked';
  token = '';
  canEditSettings = false;
  canManageGroup = false;
  accessSignature = '';
  groupManagement.hide();
  settings.hide();
  $('dashboard-view').hidden = false;
  data = { members: [], activity: [], groupSize: 5, pendingDiscord: 0 };
  worldMap.clear();
  memberCards.clear();
  bankTooltips.hide();
  showView(false);
  $('dashboard').hidden = true;
  $('login').hidden = false;
  $('logout').hidden = true;
  $('refresh').hidden = true;
  for (const id of ['members', 'bank-rows', 'bank-ge', 'bank-alch', 'bank-value-note', 'bank-xp', 'bank-xp-note',
    'location-list', 'map-markers', 'activity-list', 'xp-chart', 'xp-legend']) $(id).replaceChildren();
  $('token').value = '';
  showError('');
  clearTabSession();
}
async function refresh(expected = generation) {
  try {
    const response = await fetch('/v1/group', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (expected !== generation) return;
    if (response.status === 401) {
      lock();
      showError('Access key not accepted. Members: ask the owner for a new character token. Owners: stay in the configured Discord server and use !verify for a new owner key.');
      return;
    }
    if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);
    const body = await response.json();
    if (expected !== generation) return;
    data = body;
    mode = 'live';
    applyAccess(body.viewer);
    unlock();
    showError('');
    try {
      session ??= tabSession(window.sessionStorage);
      session.save(token);
    }
    catch (error) { showError(`Connected, but refresh sign-in could not be saved: ${error.message}`); }
    render();
  } catch (error) {
    if (expected !== generation) return;
    showError(`Could not sync: ${error.message}. Displayed data may be stale.`);
    $('connection').textContent = 'Connection lost';
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  token = $('token').value.trim();
  $('token').value = '';
  generation++;
  mode = 'connecting';
  const button = event.submitter;
  button.disabled = true;
  await refresh();
  button.disabled = false;
  if (mode === 'live') await checkAdmin(generation);
});
async function checkAdmin(expected) {
  try {
    const response = await fetch('/v1/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok || expected !== generation) return;
    const viewer = await response.json();
    if (expected !== generation) return;
    applyAccess(viewer);
    showView();
  } catch {
    // The settings tab is optional; the dashboard keeps working without it.
  }
}
$('logout').addEventListener('click', lock);
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try { await refresh(); }
  finally { $('refresh').disabled = false; }
});
$('demo').addEventListener('click', () => {
  worldMap.clear();
  memberCards.clear();
  generation++;
  token = '';
  canEditSettings = false;
  canManageGroup = false;
  accessSignature = '';
  groupManagement.hide();
  settings.hide();
  $('dashboard-view').hidden = false;
  mode = 'demo';
  data = demoData();
  showError('');
  clearTabSession();
  unlock();
  render();
});
function render() {
  $('connection').textContent = mode === 'demo' ? 'Fictional demo' : 'Private bridge connected';
  $('metric-online').textContent = `${data.members.filter(fresh).length} / ${data.groupSize}`;
  $('metric-levels').textContent = allowed('stats') ? number(data.members.reduce((sum, member) => sum + total(member), 0)) : 'Restricted';
  $('metric-banks').textContent = allowed('banks') ? number(data.members.filter(member => member.bank !== null).length) : 'Restricted';
  $('metric-outbox').textContent = number(data.pendingDiscord);
  for (const id of ['member-cards-heading', 'members', 'live-xp-status', 'xp']) $(id).hidden = !allowed('stats');
  for (const id of ['bank-xp-heading', 'bank-xp', 'bank-xp-note']) $(id).hidden = !allowed('stats');
  $('bank').hidden = !allowed('banks') && !allowed('storage');
  $('locations').hidden = !allowed('locations');
  $('activity').hidden = !allowed('activity');
  for (const [hash, permitted] of [['#bank', allowed('banks') || allowed('storage')], ['#locations', allowed('locations')], ['#activity', allowed('activity')]]) {
    document.querySelector(`nav a[href="${hash}"]`).hidden = !permitted;
  }
  if (allowed('stats')) memberCards.update(data.members, mode);
  else memberCards.clear();
  const selected = $('bank-member').value;
  const option = element('option', '', 'All members');
  option.value = '';
  $('bank-member').replaceChildren(option);
  const sharedOption = element('option', '', 'Group storage');
  sharedOption.value = '__group_storage__';
  if (allowed('storage')) $('bank-member').append(sharedOption);
  for (const member of allowed('banks') ? data.members : []) {
    const option = element('option', '', member.username);
    option.value = member.username;
    $('bank-member').append(option);
  }
  $('bank-member').value = (allowed('storage') && selected === '__group_storage__') ||
    (allowed('banks') && data.members.some(member => member.username === selected)) ? selected : '';
  renderBank();
  renderLocations();
  renderActivity();
  if (allowed('stats')) void loadXp();
  else {
    xpRequest++;
    $('xp-chart').replaceChildren();
    $('xp-legend').replaceChildren();
  }
}

async function loadXp() {
  if (!allowed('stats')) return;
  const request = ++xpRequest;
  const currentGeneration = generation;
  $('xp-status').textContent = 'Loading XP gains...';
  try {
    let result;
    if (mode === 'demo') {
      result = xpSeries(data.xpHistory, data.members.map(member => ({ name: member.username, key: member.username })), xpRange, data.demoTime);
    } else {
      const response = await fetch(`/v1/xp?range=${encodeURIComponent(xpRange)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!response.ok) throw new Error(`XP history returned HTTP ${response.status}`);
      result = await response.json();
    }
    if (request !== xpRequest || currentGeneration !== generation) return;
    renderXp(result);
  } catch (error) {
    if (request !== xpRequest || currentGeneration !== generation) return;
    $('xp-chart').replaceChildren();
    $('xp-legend').replaceChildren();
    $('xp-status').textContent = `XP graph unavailable: ${error.message}`;
  }
}

function svgNode(tag, attributes = {}, value) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attributes)) node.setAttribute(key, val);
  if (value !== undefined) node.textContent = value;
  return node;
}

function renderXp(result) {
  const chart = $('xp-chart');
  chart.replaceChildren(svgNode('title', { id: 'xp-title' }, 'Group XP gained'),
    svgNode('desc', { id: 'xp-description' }, 'XP gained per member in the selected period. Ranked totals follow the graph.'));
  const palette = ['#bdd988', '#e7bb72', '#7ec9e6', '#d2a6e8', '#f09383'];
  const colored = result.series.map((series, index) => ({ ...series, color: palette[index % palette.length] }));
  const maximum = Math.max(1, ...colored.map(series => series.gained));
  const ceiling = maximum === 1 ? 1 : Math.ceil(maximum / 10 ** Math.floor(Math.log10(maximum))) * 10 ** Math.floor(Math.log10(maximum));
  const left = 78, top = 18, width = 858, height = 236;
  const x = time => left + width * (time - result.start) / Math.max(1, result.end - result.start);
  const y = gained => top + height * (1 - gained / ceiling);
  const compact = value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  for (let i = 0; i <= 4; i++) {
    const value = ceiling * i / 4;
    chart.append(svgNode('line', { x1: left, x2: left + width, y1: y(value), y2: y(value), class: 'xp-gridline' }),
      svgNode('text', { x: left - 12, y: y(value) + 4, 'text-anchor': 'end', class: 'xp-axis' }, compact(value)));
    const time = result.start + (result.end - result.start) * i / 4;
    const label = new Date(time).toLocaleString(undefined, result.end - result.start <= 86400000
      ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
    chart.append(svgNode('text', { x: x(time), y: 280, 'text-anchor': i === 4 ? 'end' : i === 0 ? 'start' : 'middle', class: 'xp-axis' }, label));
  }
  for (const series of colored) {
    if (!series.points.length) continue;
    const path = smoothXpPath(series.points, x, y);
    const line = svgNode('path', { d: path, fill: 'none', stroke: series.color, 'stroke-width': 2.5,
      'vector-effect': 'non-scaling-stroke', class: 'xp-line', 'data-member': series.username });
    line.append(svgNode('title', {}, `${series.username}: ${number(series.gained)} XP gained`));
    chart.append(line);
    const end = series.points.at(-1);
    chart.append(svgNode('circle', { cx: x(end.time), cy: y(end.gained), r: 4, fill: series.color }));
  }
  const ranked = colored.slice().sort((a, b) => b.gained - a.gained || a.username.localeCompare(b.username));
  $('xp-legend').replaceChildren(...ranked.map(series => {
    const row = element('li', 'xp-rank');
    const swatch = element('span', 'xp-swatch');
    swatch.style.backgroundColor = series.color;
    row.append(swatch, element('strong', '', series.username),
      element('b', '', `${number(series.gained)} XP`),
      element('small', '', !series.trackedSince ? 'Waiting for first sync' :
        `${series.partial ? 'Partial period - ' : ''}last observed ${age(series.lastObservedAt)}`));
    return row;
  }));
  const active = colored.filter(series => series.points.length);
  $('xp-status').textContent = active.length
    ? `${mode === 'demo' ? 'Fictional demo. ' : ''}${active.length} member line(s) - ${xpRange === 'all' ? 'all time since tracking began' : 'XP gained in the selected period'}.` +
      (active.some(series => series.partial) ? ' Some members joined tracking during this period.' : '')
    : 'No XP history yet. The first client sync establishes a zero-gain baseline.';
}

$('xp-ranges').addEventListener('click', event => {
  const button = event.target.closest('button[data-range]');
  if (!button) return;
  xpRange = button.dataset.range;
  for (const choice of $('xp-ranges').querySelectorAll('button')) choice.setAttribute('aria-pressed', String(choice === button));
  void loadXp();
});
function renderBank() {
  bankTooltips.hide();
  const query = $('bank-search').value.trim().toLowerCase();
  const selected = $('bank-member').value;
  const members = allowed('banks') ? data.members.filter(member => !selected || member.username === selected) : [];
  if ((!selected || selected === '__group_storage__') && data.groupStorage) {
    members.unshift({ username: 'Group storage', bank: data.groupStorage.items,
      bankUpdatedAt: data.groupStorage.updatedAt, syncedBy: data.groupStorage.username });
  }
  const rows = [];
  let count = 0;
  let missingIcons = 0;
  const visibleItems = [];
  const visibleBanks = [];
  for (const member of members) {
    if (member.bank === null) continue;
    const section = element('section', 'bank-owner');
    const heading = element('div', 'bank-owner-heading');
    heading.append(element('strong', '', member.username), element('span', '',
      `Last seen ${age(member.bankUpdatedAt)}${member.syncedBy ? ` / Synced by ${member.syncedBy}` : ''}`));
    const grid = element('div', 'bank-grid');
    const bankItems = [];
    for (const item of member.bank ?? []) {
      if (!item.name.toLowerCase().includes(query)) continue;
      count++;
      visibleItems.push(item);
      bankItems.push(item);
      const tile = element('button', 'bank-slot');
      tile.type = 'button';
      const detail = `${item.name} x ${number(item.qty)} - ${member.username}`;
      tile.setAttribute('aria-label', detail);
      const image = element('img', 'item-sprite');
      image.alt = item.name;
      image.width = 36;
      image.height = 32;
      const encoded = data.icons?.[item.id];
      if (encoded) {
        image.src = `data:image/png;base64,${encoded}`;
        image.addEventListener('error', () => {
          image.hidden = true;
          tile.append(element('span', 'icon-missing', 'Image unavailable'));
        }, { once: true });
        tile.append(image);
      } else if (mode === 'demo') {
        image.src = `/demo-icons/${item.id}.png`;
        image.addEventListener('error', () => {
          image.hidden = true;
          tile.append(element('span', 'icon-missing', 'Image unavailable'));
        }, { once: true });
        tile.append(image);
      } else {
        missingIcons++;
        tile.append(element('span', 'icon-missing', 'Syncing icon'));
      }
      if (item.qty > 1) tile.append(element('span',
        `stack-quantity ${item.qty >= 10000000 ? 'millions' : item.qty >= 100000 ? 'thousands' : ''}`,
        stackQuantity(item.qty)));
      tile.dataset.tooltip = `${item.name}\n${number(item.qty)} in ${member.username}'s bank\n${itemBankInfo(item, allowed('stats'))}`;
      grid.append(tile);
    }
    if (grid.childElementCount || (!query && member.bank?.length === 0)) {
      section.append(heading, grid);
      if (!grid.childElementCount) grid.append(element('p', 'muted', 'This saved storage is empty.'));
      const values = bankSummary(bankItems);
      section.insertBefore(element('p', 'bank-owner-values', `GE ${values.ge} / High alch ${values.alch}`), grid);
      rows.push(section);
      visibleBanks.push(bankItems);
    }
  }
  $('bank-rows').replaceChildren(...rows);
  $('bank-count').textContent = `${number(count)} item stacks`;
  const summary = bankSummary(visibleItems, visibleBanks);
  $('bank-ge').textContent = summary.ge;
  $('bank-alch').textContent = summary.alch;
  $('bank-value-note').textContent = summary.coverage;
  $('bank-xp').replaceChildren(...summary.skills.map(({ skill, xp }) => {
    const chip = element('span', 'bank-xp-chip');
    const image = element('img', 'skill-icon');
    image.src = `/skill-icons/${skill.toLowerCase()}.png`;
    image.alt = skill;
    image.width = 18; image.height = 18;
    chip.append(image, element('span', '', `${skill.charAt(0) + skill.slice(1).toLowerCase()}: ${xp.toLocaleString('en-US', { maximumFractionDigits: 1 })} XP`));
    return chip;
  }));
  $('bank-xp-note').textContent = summary.xpNote;
  $('bank-icons-status').textContent = missingIcons
    ? `${missingIcons} item picture(s) waiting for the owner's RuneLite client to sync. No bank data is sent to external image services.`
    : 'Hover or focus an item for its name and exact quantity. Viewing only - no items can be moved.';
  $('bank-empty').hidden = rows.length > 0;
  const missing = members.filter(member => member.bank === null).map(member => member.username);
  $('bank-note').textContent = 'Saved snapshots, not live access. Updated when a member opens or changes their bank.' +
    ((!selected || selected === '__group_storage__') && !data.groupStorage
      ? ' Group storage has not synced yet. Open it with Share bank enabled in the updated plugin.' : '') +
    (missing.length ? ` No bank shared yet: ${missing.join(', ')}.` : '');
}
function renderLocations() {
  const rows = [];
  for (const member of data.members) {
    const row = element('div', 'location-row');
    row.append(element('strong', '', member.username));
    if (!member.position || !fresh(member)) {
      row.append(element('span', '', member.position ? `Location stale - ${age(member.updatedAt)}` : 'Location not shared'));
      if (member.position) row.append(element('small', '', 'Live marker hidden. Log in with the plugin connected to resume location updates.'));
    } else {
      const p = member.position;
      const detail = `W${p.world} / ${p.x}, ${p.y} / floor ${p.plane}`;
      row.append(element('span', '', detail));
      const focus = element('button', 'quiet', 'Show on map');
      focus.type = 'button';
      focus.setAttribute('aria-label', `Show ${member.username} on the full-page map`);
      focus.addEventListener('click', () => {
        location.hash = '#map';
        showView();
        worldMap.focus(member.username);
        $('world-map').focus({ preventScroll: true });
      });
      row.append(focus);
    }
    rows.push(row);
  }
  $('location-list').replaceChildren(...rows);
  worldMap.update(data.members);
}
function renderActivity() {
  const filter = $('activity-filter').value;
  const rows = data.activity.filter(event => !filter || event.type === filter).map(event => {
    const row = element('article', 'feed-item');
    const text = element('div', 'feed-text');
    text.append(element('strong', '', event.username), document.createTextNode(' '));
    let description;
    switch (event.type) {
      case 'boss': description = `defeated ${event.boss} - KC ${number(event.kc)}`; break;
      case 'quest': description = `completed ${event.quest}!`; break;
      case 'chat': description = `in group chat: ${event.message}`; break;
      case 'loot': description = `received ${event.items.map(item => `${number(item.qty)} x ${item.name}`).join(', ')} from ${event.source}${event.kc == null ? '' : ` (KC ${event.kc})`}`; break;
      default: description = 'Unknown activity';
    }
    text.append(document.createTextNode(description), element('small', '', age(event.receivedAt)));
    row.append(element('div', 'feed-icon', { boss: 'KC', quest: 'Q', loot: 'GP', chat: 'GIM' }[event.type]), text);
    return row;
  });
  $('activity-list').replaceChildren(...rows);
  if (!rows.length) $('activity-list').append(element('p', 'empty', 'Nothing served yet. New adventures will appear here.'));
}
for (const id of ['bank-member', 'bank-search']) $(id).addEventListener('input', renderBank);
$('activity-filter').addEventListener('change', renderActivity);
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => {
  if (link.hash === location.hash) showView();
}));
function showView(scroll = true) {
  const unlocked = mode === 'live' || mode === 'demo';
  const onSettings = unlocked && location.hash === '#settings' && canEditSettings;
  const onGroup = unlocked && location.hash === '#manage-group' && canManageGroup;
  const onMap = unlocked && location.hash === '#map' && allowed('locations');
  $('dashboard-view').hidden = onSettings || onGroup || onMap;
  $('settings').hidden = !onSettings;
  $('manage-group').hidden = !onGroup;
  $('map-page').hidden = !onMap;
  const locations = $('locations');
  if (onMap && locations.parentElement !== $('map-page-content')) {
    $('map-page-content').append(locations);
  } else if (!onMap && locations.parentElement === $('map-page-content')) {
    $('map-home').after(locations);
  }
  $('map-open').hidden = onMap;
  const current = onMap ? '#locations' : onSettings ? '#settings' : onGroup ? '#manage-group' :
    (location.hash && !['#settings', '#manage-group'].includes(location.hash) ? location.hash : '#overview');
  document.querySelectorAll('nav a').forEach(item => item.classList.toggle('active', item.hash === current));
  if (!scroll || !unlocked) return;
  if (onSettings || onGroup || onMap) window.scrollTo(0, 0);
  else if (location.hash && location.hash !== '#settings') document.querySelector(location.hash)?.scrollIntoView();
}
window.addEventListener('hashchange', () => showView());
async function poll() {
  if (mode === 'live') await refresh();
  else if (mode === 'demo') {
    for (const member of data.members.slice(0, 4)) member.updatedAt = Date.now();
    render();
  }
  setTimeout(poll, 10000);
}
setTimeout(poll, 10000);

async function restoreTab() {
  try {
    session = tabSession(window.sessionStorage);
    token = session.load();
  } catch (error) {
    showError(`Refresh sign-in unavailable: ${error.message}`);
    return;
  }
  if (!token) return;
  mode = 'connecting';
  await refresh();
  if (mode === 'live') await checkAdmin(generation);
}
void restoreTab();

function demoData() {
  const names = ['Iron Ada', 'Rune Rook', 'Lumby Lad', 'Dry Since 07', 'Zezima Jr'];
  const now = Date.now();
  const members = names.map((username, index) => ({
    username, updatedAt: now - (index === 4 ? 7200000 : 5000),
    stats: Object.fromEntries(SKILLS.map((name, s) => {
      const level = 50 + (s * 7 + index * 11) % 50;
      const start = xpAtLevel(level), end = xpAtLevel(level + 1);
      return [name, { level, xp: start + Math.floor((end - start) * ((s + index * 3) % 10) / 10) }];
    })),
    position: { x: 3100 + index * 40, y: 3200 + (index % 3) * 90, plane: 0, world: 444 },
    bankUpdatedAt: now - index * 3600000,
    bank: [{ id: 385, name: 'Shark', qty: 145 + index * 240 }, { id: 554, name: 'Fire rune', qty: 28000 + index * 175 }, { id: 995, name: 'Coins', qty: 1000000 + index * 53221 },
      { id: 2347, name: 'Hammer', qty: 1 }],
  }));
  const xpHistory = Object.fromEntries(names.map((name, index) => {
    const times = [];
    for (let hour = 40 * 24; hour >= 1; hour--) times.push(now - hour * 3600000);
    for (let minute = 60; minute >= 0; minute--) times.push(now - minute * 60000);
    let gained = 0;
    return [name, { points: [...new Set(times)].sort((a, b) => a - b).map((time, step) => {
      gained += step === 0 ? 0 : (step % (index + 3) === 0 ? 0 : (index + 1) * 157 + (step * (index + 7) % 3100));
      return { time, gained };
    }) }];
  }));
  return { members, xpHistory, demoTime: now, groupSize: 5, pendingDiscord: 0, activity: [
    { type: 'loot', username: names[1], source: 'Zulrah', kc: 127, items: [{ name: 'Tanzanite fang', qty: 1 }], receivedAt: now - 60000 },
    { type: 'boss', username: names[0], boss: 'Vorkath', kc: 256, receivedAt: now - 150000 },
    { type: 'quest', username: names[2], quest: 'Recipe for Disaster', receivedAt: now - 320000 },
    { type: 'chat', username: names[3], message: 'Who borrowed all the sharks?', receivedAt: now - 450000 },
    { type: 'boss', username: names[4], boss: 'The Gauntlet', kc: 512, receivedAt: now - 7200000 },
  ] };
}
