import { SKILLS, skillName, levelProgress, combatLevel } from './skills.js';

const number = value => value.toLocaleString('en-US');
const key = name => name.replaceAll('_', ' ').trim().toLowerCase();
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function icon(skill) {
  const image = el('img', 'skill-icon');
  image.src = `/skill-icons/${skill.toLowerCase()}.png`;
  image.alt = skillName(skill);
  image.width = 20;
  image.height = 20;
  return image;
}

export function initMembers({ container, status, authHeader, onUnauthorized }) {
  let members = [];
  let drops = [];
  let cards = new Map();
  let pendingAnimations = [];
  let generation = 0;
  let controller = null;
  let retryTimer;
  let demoTimer;
  let mode = 'locked';
  let cursor = '';
  let serverAnchor = Date.now();
  let elapsedAnchor = performance.now();
  const now = () => serverAnchor + performance.now() - elapsedAnchor;
  const anchor = time => { serverAnchor = time; elapsedAnchor = performance.now(); };

  function renderCards() {
    const previous = cards;
    cards = new Map();
    const nodes = members.map(member => {
      const existing = previous.get(key(member.username));
      const card = existing?.card ?? el('article', 'player-card');
      const header = existing?.card.firstElementChild ?? el('header', 'player-header');
      const effects = existing?.effects ?? el('div', 'player-xp-effects');
      effects.setAttribute('aria-hidden', 'true');
      const badge = el('div', 'player-badge', member.username.slice(0, 2).toUpperCase());
      const identity = el('div', 'player-identity');
      identity.append(el('span', 'player-eyebrow', 'GROUP MEMBER'));
      identity.append(el('h3', '', member.username));
      const presence = el('span', 'player-presence');
      identity.append(presence);
      if (existing) {
        header.children[0].replaceWith(badge);
        header.children[1].replaceWith(identity);
      } else header.append(badge, identity, effects);
      const stats = Object.values(member.stats);
      const summary = el('div', 'player-summary');
      for (const [label, value] of [
        ['Total level', stats.reduce((sum, stat) => sum + stat.level, 0)],
        ['Combat', combatLevel(member.stats)],
        ['Total XP', stats.reduce((sum, stat) => sum + stat.xp, 0)],
      ]) {
        const metric = el('div', '');
        metric.append(el('span', '', label), el('strong', '', number(value)));
        summary.append(metric);
      }
      const activity = existing?.activity ?? el('div', 'player-training');
      const skillsHeading = el('div', 'player-skills-heading');
      skillsHeading.append(el('span', '', 'Skill overview'),
        el('span', '', `${Object.keys(member.stats).length} skills`));
      const grid = el('div', 'player-skills');
      grid.setAttribute('aria-label', `${member.username} skill levels`);
      for (const skill of SKILLS) {
        const stat = member.stats[skill];
        if (!stat) continue;
        const progress = levelProgress(stat);
        const cell = el('div', `player-skill${stat.level >= 99 ? ' maxed' : ''}`);
        cell.tabIndex = 0;
        cell.dataset.skill = skill;
        const description = `${skillName(skill)}: level ${stat.level}\n${number(stat.xp)} XP` +
          (stat.level >= 99 ? ' / Level 99 reached' : ` / ${number(progress.remaining)} XP to level ${stat.level + 1}`);
        cell.setAttribute('role', 'group');
        cell.setAttribute('aria-label', description);
        const level = el('strong', '', stat.level);
        cell.append(icon(skill), el('span', 'skill-label', skillName(skill)), level);
        const bar = el('progress', 'skill-progress');
        bar.max = 100;
        bar.value = progress.percent;
        bar.setAttribute('aria-label', `${skillName(skill)} progress to next level`);
        cell.append(bar);
        const tooltip = el('span', 'skill-tooltip', description);
        tooltip.setAttribute('aria-hidden', 'true');
        cell.append(tooltip);
        grid.append(cell);
      }
      if (existing) {
        card.children[1].replaceWith(summary);
        card.children[3].replaceWith(skillsHeading);
        card.children[4].replaceWith(grid);
      } else card.append(header, summary, activity, skillsHeading, grid);
      cards.set(key(member.username), { card, presence, activity, effects, member });
      return card;
    });
    const retained = new Set(nodes);
    for (const child of [...container.children]) {
      if (!retained.has(child)) child.remove();
    }
    nodes.forEach((node, index) => {
      if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
    });
    if (!nodes.length) container.append(el('p', 'empty', 'Ready for your group. Log in with the RuneLite plugin to sync your first member.'));
    renderActivity();
    pendingAnimations = pendingAnimations.filter(drop => {
      if (now() - drop.receivedAt >= 15000) return false;
      if (!cards.has(key(drop.username))) return true;
      animateDrop(drop);
      return false;
    });
  }

  function renderActivity() {
    const time = now();
    drops = drops.filter(drop => time - drop.receivedAt < 5 * 60000).slice(-100);
    for (const { card, presence, activity, member } of cards.values()) {
      const age = Math.max(0, time - member.updatedAt);
      const fresh = age < 30000;
      presence.classList.toggle('is-online', fresh);
      const seconds = Math.floor(age / 1000);
      const lastSync = seconds < 60 ? `${seconds}s` : seconds < 3600
        ? `${Math.floor(seconds / 60)}m` : seconds < 86400
          ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
      presence.textContent = fresh
        ? `Live client${member.position ? ` / World ${member.position.world}` : ''}`
        : `Last synced ${lastSync} ago`;
      const live = drops.filter(drop => key(drop.username) === key(member.username) && time - drop.receivedAt < 15000);
      const latest = live.at(-1);
      const signature = JSON.stringify([fresh, latest?.id]);
      activity.classList.toggle('is-training', Boolean(latest));
      card.querySelectorAll('.player-skill').forEach(cell => cell.classList.toggle('training', cell.dataset.skill === latest?.skill));
      if (activity.dataset.state === signature) continue;
      activity.dataset.state = signature;
      activity.replaceChildren();
      if (latest) {
        const label = el('div', 'training-label');
        label.append(el('span', '', 'TRAINING NOW'), el('strong', '', skillName(latest.skill)));
        activity.append(icon(latest.skill), label,
          el('strong', 'training-gain', `+${number(latest.amount)} XP`));
      } else {
        const label = el('div', 'training-label');
        label.append(el('strong', '', fresh ? 'Ready for the next XP drop' : 'No live client updates'),
          el('span', '', fresh ? 'Your next gain will appear here.' : 'Connect the plugin to resume syncing.'));
        activity.append(el('span', 'training-dot'), label);
      }
    }
  }

  function animateDrop(drop) {
    const layer = cards.get(key(drop.username))?.effects;
    if (!layer) {
      pendingAnimations.push(drop);
      return;
    }
    const effect = el('span', 'player-xp-float');
    effect.append(icon(drop.skill), el('b', '', `+${number(drop.amount)}`));
    while (layer.childElementCount >= 4) layer.firstElementChild.remove();
    for (const node of layer.children) node.style.bottom = `${Number.parseInt(node.style.bottom || '0', 10) + 22}px`;
    effect.style.bottom = '0px';
    layer.append(effect);
    effect.addEventListener('animationend', () => effect.remove(), { once: true });
    setTimeout(() => effect.remove(), 3500);
  }

  function accept(batch) {
    anchor(batch.serverTime);
    if (batch.reset) drops = [];
    if (batch.reset) pendingAnimations = [];
    const existing = new Set(drops.map(drop => `${key(drop.username)}:${drop.id}`));
    for (const drop of batch.drops) {
      if (!SKILLS.includes(drop.skill)) continue;
      const id = `${key(drop.username)}:${drop.id}`;
      if (existing.has(id)) continue;
      existing.add(id);
      drops.push(drop);
      if (!batch.reset && now() - drop.receivedAt < 15000) animateDrop(drop);
    }
    cursor = batch.cursor;
    renderActivity();
  }

  async function poll(expected) {
    if (expected !== generation || mode !== 'live') return;
    const currentController = new AbortController();
    controller = currentController;
    let delay = 100;
    try {
      const response = await fetch(`/v1/live-xp${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, {
        headers: authHeader(),
        signal: AbortSignal.any([currentController.signal, AbortSignal.timeout(25000)]),
        cache: 'no-store',
      });
      if (expected !== generation) return;
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (expected !== generation) return;
      accept(body);
      status.textContent = 'Live XP connected. Skill events appear as they arrive; no Hiscores delay.';
      status.classList.remove('is-error');
    } catch (error) {
      if (expected !== generation || currentController.signal.aborted) return;
      status.textContent = `Live XP disconnected: ${error.message}. Retrying in 5 seconds.`;
      status.classList.add('is-error');
      delay = 5000;
    } finally {
      if (controller === currentController) controller = null;
      if (expected === generation && mode === 'live') retryTimer = setTimeout(() => void poll(expected), delay);
    }
  }

  function clear() {
    generation++;
    mode = 'locked';
    controller?.abort();
    controller = null;
    clearTimeout(retryTimer);
    clearInterval(demoTimer);
    members = [];
    drops = [];
    pendingAnimations = [];
    cursor = '';
    cards.clear();
    container.replaceChildren();
    status.textContent = '';
  }

  setInterval(() => { if (mode !== 'locked') renderActivity(); }, 1000);
  return {
    update(nextMembers, nextMode) {
      members = nextMembers;
      renderCards();
      if (mode === nextMode) return;
      mode = nextMode;
      if (mode === 'live') {
        status.textContent = 'Connecting to live skill events...';
        void poll(generation);
      } else if (mode === 'demo') {
        anchor(Date.now());
        status.textContent = 'Fictional demo XP drops - not your group data.';
        const expected = generation;
        demoTimer = setInterval(() => {
          if (expected !== generation) return;
          const member = members[Math.floor(Math.random() * Math.min(4, members.length))];
          if (!member) return;
          const skill = ['MINING', 'WOODCUTTING', 'FISHING', 'COOKING'][Math.floor(Math.random() * 4)];
          const drop = { id: crypto.randomUUID(), username: member.username, skill, amount: 35,
            totalXp: member.stats[skill]?.xp ?? 1000, receivedAt: now() };
          drops.push(drop);
          animateDrop(drop);
          renderActivity();
        }, 2400);
      }
    },
    clear,
  };
}
