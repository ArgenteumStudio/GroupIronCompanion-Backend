// Base action XP matches RuneLite's skill calculator. Each supply has one default
// use; later processing stages and alternative methods are deliberately excluded.
import { SKILLS } from './skills.js';
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
  ['Raw chicken', 30], ['Raw beef', 30], ['Raw rat meat', 30], ['Raw bear meat', 30],
  ['Raw rabbit', 30], ['Raw ugthanki meat', 40], ['Raw bird meat', 62.5], ['Raw beast meat', 82.5],
  ['Raw guppy', 12], ['Raw cavefish', 23], ['Raw tetra', 31], ['Raw catfish', 43],
  ['Raw lava eel', 30], ['Raw slimy eel', 95], ['Raw rainbow fish', 110], ['Raw cave eel', 115],
  ['Raw sacred eel', 109], ['Raw dark crab', 215],
]);
add('PRAYER', 'Bury bones / scatter ashes (no altar bonuses)', [
  ['Bones', 4.5], ['Burnt bones', 4.5], ['Wolf bones', 4.5], ['Monkey bones', 5], ['Bat bones', 5.3],
  ['Big bones', 15], ['Jogre bones', 15], ['Wyrmling bones', 21], ['Zogre bones', 22.5],
  ['Shaikahan bones', 25], ['Babydragon bones', 30], ['Wyrm bones', 50], ['Strykewyrm bones', 60],
  ['Dragon bones', 72], ['Wyvern bones', 72], ['Drake bones', 80], ['Fayrg bones', 84],
  ['Lava dragon bones', 85], ['Raurg bones', 96], ['Frost dragon bones', 100], ['Hydra bones', 110],
  ['Dagannoth bones', 125], ['Ourg bones', 140], ['Superior dragon bones', 150],
  ['Fiendish ashes', 10], ['Vile ashes', 25], ['Malicious ashes', 65],
  ['Abyssal ashes', 85], ['Infernal ashes', 110],
]);
add('PRAYER', 'Burn shade remains (pyre logs not checked)', [
  ['Loar remains', 33], ['Phrin remains', 46.5], ['Riyl remains', 59.5], ['Asyn remains', 82.5],
  ['Fiyr remains', 84], ['Urium remains', 120.5],
]);
add('PRAYER', 'Reanimate ensouled heads (runes and Magic XP not counted)', [
  ['Ensouled goblin head', 130], ['Ensouled monkey head', 182], ['Ensouled imp head', 286],
  ['Ensouled minotaur head', 364], ['Ensouled scorpion head', 454], ['Ensouled bear head', 480],
  ['Ensouled unicorn head', 494], ['Ensouled dog head', 520], ['Ensouled chaos druid head', 584],
  ['Ensouled giant head', 650], ['Ensouled ogre head', 716], ['Ensouled elf head', 754],
  ['Ensouled troll head', 780], ['Ensouled horror head', 832], ['Ensouled kalphite head', 884],
  ['Ensouled dagannoth head', 936], ['Ensouled bloodveld head', 1040], ['Ensouled tzhaar head', 1104],
  ['Ensouled demon head', 1170], ['Ensouled hellhound head', 1200], ['Ensouled aviansie head', 1234],
  ['Ensouled abyssal head', 1300], ['Ensouled dragon head', 1560],
]);
add('CRAFTING', 'Cut uncut gems', [
  ['Uncut opal', 15], ['Uncut jade', 20], ['Uncut red topaz', 25], ['Uncut sapphire', 50],
  ['Uncut emerald', 67.5], ['Uncut ruby', 85], ['Uncut diamond', 107.5], ['Uncut dragonstone', 137.5],
  ['Uncut onyx', 167.5], ['Uncut zenyte', 200],
]);
add('CRAFTING', 'Craft d\'hide bodies (XP per leather or hide; three per body, tanning not counted)', [
  ['Green dragon leather', 62], ['Blue dragon leather', 70], ['Red dragon leather', 78], ['Black dragon leather', 86],
  ['Green dragonhide', 62], ['Blue dragonhide', 70], ['Red dragonhide', 78], ['Black dragonhide', 86],
]);
add('CRAFTING', 'Single default craft per supply (moulds, tools and tanning not checked)', [
  ['Gold bar', 30], ['Leather', 25], ['Cowhide', 25], ['Soft clay', 18], ['Molten glass', 17.5],
  ['Flax', 15], ['Wool', 2.5],
]);
add('CONSTRUCTION', 'Build with planks (XP per plank, nails not checked)', [
  ['Plank', 29], ['Oak plank', 60], ['Teak plank', 90], ['Mahogany plank', 140],
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
// RuneLite FarmingAction totals (plant + check health); seeds assume they are grown into saplings first.
const trees = [
  ['Oak', 'Acorn', 481.3], ['Willow', 'Willow seed', 1481.5], ['Maple', 'Maple seed', 3448.4],
  ['Yew', 'Yew seed', 7150.9], ['Magic', 'Magic seed', 13913.8], ['Redwood', 'Redwood tree seed', 22680],
  ['Teak', 'Teak seed', 7315], ['Mahogany', 'Mahogany seed', 15783], ['Apple', 'Apple tree seed', 1221.5],
  ['Banana', 'Banana tree seed', 1778.5], ['Orange', 'Orange tree seed', 2505.7], ['Curry', 'Curry tree seed', 2946.9],
  ['Pineapple', 'Pineapple seed', 4662.7], ['Papaya', 'Papaya tree seed', 6218.4], ['Palm', 'Palm tree seed', 10260.6],
  ['Calquat', 'Calquat tree seed', 12225.5], ['Dragonfruit', 'Dragonfruit tree seed', 17895],
  ['Celastrus', 'Celastrus seed', 14334], ['Spirit', 'Spirit seed', 19501.3], ['Camphor', 'Camphor seed', 17928],
  ['Ironwood', 'Ironwood seed', 20525], ['Rosewood', 'Rosewood seed', 23352],
];
add('FARMING', 'Plant and check tree/fruit tree health (harvest XP not counted)', trees.flatMap(([tree, seed, xp]) =>
  [[`${tree} sapling`, xp], [seed, xp]]));
add('RUNECRAFT', 'Craft air runes (minimum; higher runes and Daeyalt give more)', [
  ['Rune essence', 5], ['Pure essence', 5], ['Daeyalt essence', 5],
]);
add('MAGIC', 'Cast High Level Alchemy (one nature rune per cast; fire runes not checked)', [
  ['Nature rune', 65],
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
  ...[['Guam leaf', 30], ['Marrentill', 42.5], ['Tarromin', 55], ['Harralander', 72.5], ['Irit leaf', 85]]
    .map(([herb, xp]) => ({ input: herb, secondary: 'Swamp tar', count: 15, skill: 'HERBLORE', xp, method: `${herb} tar (15 swamp tar per herb)` })),
  { input: 'Bucket of sand', secondary: 'Soda ash', count: 1, skill: 'CRAFTING', xp: 20, method: 'Molten glass (requires soda ash)' },
  { input: 'Bucket of sand', secondary: 'Seaweed', count: 1, skill: 'CRAFTING', xp: 20, method: 'Molten glass (requires seaweed)' },
  ...[['Dragon', 25], ['Amethyst', 21], ['Rune', 18.8], ['Adamant', 15], ['Mithril', 11.2], ['Steel', 7.5], ['Iron', 3.8], ['Bronze', 1.8]]
    .map(([metal, xp]) => ({ input: `${metal} dart tip`, secondary: 'Feather', count: 1, skill: 'FLETCHING', xp, method: `${metal} darts (one feather per dart)` })),
  ...[['Dragon bolts (unf)', 12], ['Runite bolts (unf)', 10], ['Adamant bolts(unf)', 7], ['Adamant bolts (unf)', 7],
    ['Mithril bolts (unf)', 5], ['Steel bolts (unf)', 3.5], ['Unfinished broad bolts', 3], ['Silver bolts (unf)', 2.5],
    ['Iron bolts (unf)', 1.5], ['Bronze bolts (unf)', 0.5]]
    .map(([input, xp]) => ({ input, secondary: 'Feather', count: 1, skill: 'FLETCHING', xp, method: 'Feather unfinished bolts (one feather per bolt)' })),
  ...[['Onyx', 'Runite', 9.4], ['Dragonstone', 'Runite', 8.2], ['Diamond', 'Adamant', 7], ['Ruby', 'Adamant', 6.3],
    ['Emerald', 'Mithril', 5.5], ['Sapphire', 'Mithril', 4.7], ['Pearl', 'Iron', 3.2], ['Opal', 'Bronze', 1.6]]
    .map(([gem, metal, xp]) => ({ input: `${gem} bolt tips`, secondary: `${metal} bolts`, count: 1, skill: 'FLETCHING', xp, method: `Tip ${metal.toLowerCase()} bolts (one bolt per tip)` })),
  ...[['Dragon', 15], ['Amethyst', 13.5], ['Rune', 12.5], ['Adamant', 10], ['Mithril', 7.5], ['Steel', 5], ['Iron', 2.5], ['Bronze', 1.3]]
    .map(([metal, xp]) => ({ input: `${metal} arrowtips`, secondary: 'Headless arrow', count: 1, skill: 'FLETCHING', xp, method: `${metal} arrows (one headless arrow per tip)` })),
  { input: 'Arrow shaft', secondary: 'Feather', count: 1, skill: 'FLETCHING', xp: 1, method: 'Headless arrows (one feather per shaft; arrowtips not chained)' },
  ...[['Magic longbow (u)', 91.5], ['Magic shortbow (u)', 83.3], ['Yew longbow (u)', 75], ['Yew shortbow (u)', 67.5],
    ['Maple longbow (u)', 58.3], ['Maple shortbow (u)', 50], ['Willow longbow (u)', 41.5], ['Willow shortbow (u)', 33.3],
    ['Oak longbow (u)', 25], ['Oak shortbow (u)', 16.5], ['Longbow (u)', 10], ['Shortbow (u)', 5]]
    .map(([input, xp]) => ({ input, secondary: 'Bow string', count: 1, skill: 'FLETCHING', xp, method: 'String bows (requires bow string)' })),
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
        quantities.set(input, quantities.get(input) - actions);
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
    skills: [
      ...[...totals].map(([skill, tenths]) => ({ skill, xp: tenths / 10 })).sort((a, b) => b.xp - a.xp),
      ...SKILLS.filter(skill => !totals.has(skill)).map(skill => ({ skill, xp: 0 })),
    ],
    xpNote: `${supported}/${items.length} visible stacks have supported uses or recipe ingredients; unsupported items are excluded. Skills with no bankable supplies (combat, gathering, Agility, Thieving, Slayer, Hunter, Sailing) show 0. Estimates: burn logs, cook without burns, bury/scatter, burn shade remains, reanimate ensouled heads, clean grimy herbs, smith existing bars or smelt ores, cut gems, craft one default item per crafting supply, build with planks, plant tree saplings/seeds, craft air runes from essence, and high alch with nature runes. Recipes require secondaries in the same bank and are allocated in listed order (highest-XP fletching first; coal to mithril, then adamantite, then runite). Intermediate products are not chained, so shafts made into headless arrows do not also use arrowtips. No bonuses, level checks, tools, runes, future purchases, alternate methods or downstream XP. Hover supplies for the chosen method.`,
  };
}
