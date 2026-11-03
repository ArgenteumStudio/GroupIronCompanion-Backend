// Base action XP matches RuneLite's skill calculator. Each supply has one default
// use; later processing stages and alternative methods are deliberately excluded.
const rules = new Map();
const add = (skill, method, entries) => {
  for (const [name, xp] of entries) rules.set(name.toLowerCase(), { skill, method, xp });
};
add('FIREMAKING', 'Burn logs (no bonuses)', [
  ['Logs', 40], ['Oak logs', 60], ['Willow logs', 90], ['Teak logs', 105],
  ['Maple logs', 135], ['Mahogany logs', 157.5], ['Yew logs', 202.5],
  ['Magic logs', 303.8], ['Redwood logs', 350],
]);
add('COOKING', 'Cook successfully (no burns or bonuses)', [
  ['Raw shrimps', 30], ['Raw anchovies', 30], ['Raw sardine', 40], ['Raw herring', 50],
  ['Raw mackerel', 60], ['Raw trout', 70], ['Raw cod', 75], ['Raw pike', 80],
  ['Raw salmon', 90], ['Raw tuna', 100], ['Raw lobster', 120], ['Raw bass', 130],
  ['Raw swordfish', 140], ['Raw monkfish', 150], ['Raw karambwan', 190],
  ['Raw shark', 210], ['Raw sea turtle', 211.3], ['Raw anglerfish', 230], ['Raw manta ray', 216.3],
]);
add('PRAYER', 'Bury bones / scatter ashes (no altar bonuses)', [
  ['Bones', 4.5], ['Big bones', 15], ['Babydragon bones', 30], ['Dragon bones', 72],
  ['Wyvern bones', 72], ['Wyrm bones', 50], ['Drake bones', 80], ['Hydra bones', 110],
  ['Dagannoth bones', 125], ['Superior dragon bones', 150],
  ['Fiendish ashes', 10], ['Vile ashes', 25], ['Malicious ashes', 65],
  ['Abyssal ashes', 85], ['Infernal ashes', 110],
]);
add('HERBLORE', 'Clean grimy herbs only', [
  ['Grimy guam leaf', 2.5], ['Grimy marrentill', 3.8], ['Grimy tarromin', 5],
  ['Grimy harralander', 6.3], ['Grimy ranarr weed', 7.5], ['Grimy toadflax', 8],
  ['Grimy irit leaf', 8.8], ['Grimy avantoe', 10], ['Grimy kwuarm', 11.3],
  ['Grimy snapdragon', 11.8], ['Grimy cadantine', 12.5], ['Grimy lantadyme', 13.1],
  ['Grimy dwarf weed', 13.8], ['Grimy torstol', 15],
]);
add('SMITHING', 'Smith bars at an anvil (XP per bar, no bonuses)', [
  ['Bronze bar', 12.5], ['Iron bar', 25], ['Steel bar', 37.5],
  ['Mithril bar', 50], ['Adamantite bar', 62.5], ['Runite bar', 75],
]);
add('SMITHING', 'Smelt ore only (no goldsmith bonus; iron assumes successful smelting)', [
  ['Iron ore', 12.5], ['Silver ore', 13.7], ['Gold ore', 22.5],
]);
const recipes = [
  { input: 'Copper ore', secondary: 'Tin ore', count: 1, skill: 'SMITHING', xp: 6.2, method: 'Smelt bronze (requires one tin ore per copper ore)' },
  { input: 'Mithril ore', secondary: 'Coal', count: 4, skill: 'SMITHING', xp: 30, method: 'Smelt mithril (four coal per ore)' },
  { input: 'Adamantite ore', secondary: 'Coal', count: 6, skill: 'SMITHING', xp: 37.5, method: 'Smelt adamantite (six coal per ore)' },
  { input: 'Runite ore', secondary: 'Coal', count: 8, skill: 'SMITHING', xp: 50, method: 'Smelt runite (eight coal per ore)' },
  { input: 'Guam potion (unf)', secondary: 'Eye of newt', count: 1, skill: 'HERBLORE', xp: 25, method: 'Attack potions (requires eye of newt)' },
  { input: 'Marrentill potion (unf)', secondary: 'Unicorn horn dust', count: 1, skill: 'HERBLORE', xp: 37.5, method: 'Antipoison (requires unicorn horn dust)' },
  { input: 'Tarromin potion (unf)', secondary: 'Limpwurt root', count: 1, skill: 'HERBLORE', xp: 50, method: 'Strength potions (requires limpwurt root)' },
  { input: 'Harralander potion (unf)', secondary: 'Red spiders\' eggs', count: 1, skill: 'HERBLORE', xp: 62.5, method: 'Restore potions (requires red spiders\' eggs)' },
  { input: 'Ranarr potion (unf)', secondary: 'Snape grass', count: 1, skill: 'HERBLORE', xp: 87.5, method: 'Prayer potions (requires snape grass)' },
  { input: 'Irit potion (unf)', secondary: 'Eye of newt', count: 1, skill: 'HERBLORE', xp: 100, method: 'Super attack (requires eye of newt)' },
  { input: 'Avantoe potion (unf)', secondary: 'Mort myre fungus', count: 1, skill: 'HERBLORE', xp: 117.5, method: 'Super energy (requires mort myre fungus)' },
  { input: 'Kwuarm potion (unf)', secondary: 'Limpwurt root', count: 1, skill: 'HERBLORE', xp: 125, method: 'Super strength (requires limpwurt root)' },
  { input: 'Snapdragon potion (unf)', secondary: 'Red spiders\' eggs', count: 1, skill: 'HERBLORE', xp: 142.5, method: 'Super restore (requires red spiders\' eggs)' },
  { input: 'Cadantine potion (unf)', secondary: 'White berries', count: 1, skill: 'HERBLORE', xp: 150, method: 'Super defence (requires white berries)' },
  { input: 'Lantadyme potion (unf)', secondary: 'Potato cactus', count: 1, skill: 'HERBLORE', xp: 172.5, method: 'Magic potions (requires potato cactus)' },
  { input: 'Dwarf weed potion (unf)', secondary: 'Wine of zamorak', count: 1, skill: 'HERBLORE', xp: 162.5, method: 'Ranging potions (requires wine of zamorak)' },
  { input: 'Toadflax potion (unf)', secondary: 'Crushed nest', count: 1, skill: 'HERBLORE', xp: 180, method: 'Saradomin brews (requires crushed nest)' },
];
const nameKey = item => item.name.toLowerCase();
const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const valueKnown = value => Number.isSafeInteger(value) && value >= 0;
const recipeFor = item => recipes.find(recipe => recipe.input.toLowerCase() === nameKey(item));

export function itemBankInfo(item, includeXp = true) {
  const ge = valueKnown(item.price) ? `${format(item.price)} gp each / ${format(BigInt(item.price) * BigInt(item.qty))} gp stack` : 'Not synced';
  const alch = valueKnown(item.highAlch) ? `${format(item.highAlch)} gp each / ${format(BigInt(item.highAlch) * BigInt(item.qty))} gp stack` : 'Not synced';
  const rule = rules.get(nameKey(item)) ?? recipeFor(item);
  if (!includeXp) return `GE: ${ge}\nHigh alch: ${alch}`;
  return `GE: ${ge}\nHigh alch: ${alch}\n` + (rule
    ? `${rule.skill}: ${format(rule.xp)} XP per action\n${rule.method}`
    : 'Banked XP: unsupported item (not counted)');
}

export function bankSummary(items, banks = [items]) {
  const totals = new Map();
  const addXp = (skill, xp, qty) => totals.set(skill, (totals.get(skill) ?? 0) + Math.round(xp * 10) * qty);
  let supported = 0;
  for (const item of items) {
    const rule = rules.get(nameKey(item));
    if (rule) { addXp(rule.skill, rule.xp, item.qty); supported++; }
    else if (recipeFor(item) || recipes.some(recipe => recipe.secondary.toLowerCase() === nameKey(item))) supported++;
  }
  for (const bank of banks) {
    const quantities = new Map();
    for (const item of bank) quantities.set(nameKey(item), (quantities.get(nameKey(item)) ?? 0) + item.qty);
    for (const recipe of recipes) {
      const input = recipe.input.toLowerCase(), secondary = recipe.secondary.toLowerCase();
      const actions = Math.min(quantities.get(input) ?? 0, Math.floor((quantities.get(secondary) ?? 0) / recipe.count));
      if (actions) {
        addXp(recipe.skill, recipe.xp, actions);
        quantities.set(secondary, quantities.get(secondary) - actions * recipe.count);
      }
    }
  }
  const value = field => items.reduce((sum, item) => sum + (valueKnown(item[field]) ? BigInt(item[field]) * BigInt(item.qty) : 0n), 0n);
  const missing = field => items.filter(item => !valueKnown(item[field])).length;
  const geMissing = missing('price'), alchMissing = missing('highAlch');
  return {
    ge: `${format(value('price'))} gp${geMissing ? ' (partial)' : ''}`,
    alch: `${format(value('highAlch'))} gp${alchMissing ? ' (partial)' : ''}`,
    coverage: `Visible items only. GE: ${geMissing} unsynced stack(s); high alch: ${alchMissing} unsynced. Prices are client estimates at capture time, not live offers. Alch totals exclude rune costs and do not guarantee alch eligibility.`,
    skills: [...totals].map(([skill, tenths]) => ({ skill, xp: tenths / 10 })).sort((a, b) => b.xp - a.xp),
    xpNote: `${supported}/${items.length} visible stacks have supported uses or recipe ingredients; unsupported items are excluded. Estimates: burn logs, cook without burns, bury/scatter, clean grimy herbs only, smith existing bars or smelt ores only. Recipes require secondaries in the same bank; coal is allocated mithril, then adamantite, then runite, and potion secondaries in listed recipe order. No bonuses, level checks, future purchases, alternate methods or downstream XP. Hover supplies for the chosen method.`,
  };
}
