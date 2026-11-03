export const SKILLS = [
  'ATTACK', 'HITPOINTS', 'MINING', 'STRENGTH', 'AGILITY', 'SMITHING',
  'DEFENCE', 'HERBLORE', 'FISHING', 'RANGED', 'THIEVING', 'COOKING',
  'PRAYER', 'CRAFTING', 'FIREMAKING', 'MAGIC', 'FLETCHING', 'WOODCUTTING',
  'RUNECRAFT', 'SLAYER', 'FARMING', 'CONSTRUCTION', 'HUNTER', 'SAILING',
];
export const skillName = skill => skill === 'RUNECRAFT' ? 'Runecraft' :
  skill.charAt(0) + skill.slice(1).toLowerCase();

export function xpAtLevel(level) {
  let points = 0;
  for (let i = 1; i < level; i++) points += Math.floor(i + 300 * 2 ** (i / 7));
  return Math.floor(points / 4);
}

export function levelProgress(stat) {
  if (stat.level >= 99) return { percent: 100, remaining: 0 };
  const start = xpAtLevel(stat.level), end = xpAtLevel(stat.level + 1);
  return { percent: Math.max(0, Math.min(100, (stat.xp - start) / (end - start) * 100)),
    remaining: Math.max(0, end - stat.xp) };
}

export function combatLevel(stats) {
  const level = skill => stats[skill]?.level ?? 1;
  const base = (level('DEFENCE') + level('HITPOINTS') + Math.floor(level('PRAYER') / 2)) / 4;
  return Math.floor(base + Math.max((level('ATTACK') + level('STRENGTH')) * 0.325,
    Math.floor(level('RANGED') * 1.5) * 0.325, Math.floor(level('MAGIC') * 1.5) * 0.325));
}
