// Boss names as shown on the OSRS hiscores; RuneLite saves kill counts under lower-case keys.
export const BOSS_NAMES = Object.freeze([
  'Abyssal Sire', 'Alchemical Hydra', 'Amoxliatl', 'Araxxor', 'Artio', 'Barrows Chests', 'Brutus', 'Bryophyta',
  'Callisto', "Calvar'ion", 'Cerberus', 'Chambers of Xeric', 'Chambers of Xeric: Challenge Mode', 'Chaos Elemental',
  'Chaos Fanatic', 'Commander Zilyana', 'Corporeal Beast', 'Crazy Archaeologist', 'Dagannoth Prime', 'Dagannoth Rex',
  'Dagannoth Supreme', 'Deranged Archaeologist', 'Doom of Mokhaiotl', 'Duke Sucellus', 'General Graardor', 'Giant Mole',
  'Grotesque Guardians', 'Hespori', 'Kalphite Queen', 'King Black Dragon', 'Kraken', "Kree'Arra", "K'ril Tsutsaroth",
  'Lunar Chests', 'Mad Angel', 'Maggot King', 'Mimic', 'Nex', 'Nightmare', "Phosani's Nightmare", 'Obor',
  'Phantom Muspah', 'Sarachnis', 'Scorpia', 'Scurrius', 'Shellbane Gryphon', 'Skotizo', 'Sol Heredit', 'Spindel',
  'Tempoross', 'The Gauntlet', 'The Corrupted Gauntlet', 'The Hueycoatl', 'The Leviathan', 'The Royal Titans',
  'The Whisperer', 'Theatre of Blood', 'Theatre of Blood: Hard Mode', 'Thermonuclear Smoke Devil', 'Tombs of Amascut',
  'Tombs of Amascut: Expert Mode', 'TzKal-Zuk', 'TzTok-Jad', 'Vardorvis', 'Venenatis', "Vet'ion", 'Vorkath',
  'Wintertodt', 'Yama', 'Zalcano', 'Zulrah',
]);

const key = name => String(name).replaceAll('\u00a0', ' ').replaceAll('_', ' ').trim().toLowerCase();
const ALIASES = {
  'lunar chest': 'Lunar Chests', 'barrows': 'Barrows Chests', 'barrows chest': 'Barrows Chests',
  'chambers of xeric challenge mode': 'Chambers of Xeric: Challenge Mode',
  'theatre of blood hard mode': 'Theatre of Blood: Hard Mode', 'tombs of amascut expert mode': 'Tombs of Amascut: Expert Mode',
  'the nightmare': 'Nightmare', 'the mimic': 'Mimic', 'gauntlet': 'The Gauntlet', 'corrupted gauntlet': 'The Corrupted Gauntlet',
  'hueycoatl': 'The Hueycoatl', 'leviathan': 'The Leviathan', 'whisperer': 'The Whisperer', 'royal titans': 'The Royal Titans',
  'jad': 'TzTok-Jad', 'zuk': 'TzKal-Zuk',
};
const CANONICAL = new Map([...BOSS_NAMES.map(name => [key(name), name]), ...Object.entries(ALIASES)]);

const titleCase = value => value.replace(/(^|[\s(-])([a-z])/g, (_, start, letter) => start + letter.toUpperCase());

export function bossName(name) {
  return CANONICAL.get(key(name)) ?? (/[A-Z]/.test(name) ? name.trim() : titleCase(key(name)));
}

// RuneLite also saves non-boss counts (e.g. agility laps); only hiscore bosses belong in !kc.
const HISCORE_BOSSES = new Set(BOSS_NAMES);
export const isHiscoreBoss = name => HISCORE_BOSSES.has(bossName(name));

// Wiki files whose name is not simply "<Boss> icon.png".
const ICON_FILES = {
  'artio': 'Callisto icon.png', "calvar'ion": "Vet'ion icon.png", 'spindel': 'Venenatis icon.png',
  'barrows chests': 'Barrows Brothers icon.png', 'brutus': 'Brutus Boss icon.png',
  'chambers of xeric': 'Great Olm icon.png', 'chambers of xeric: challenge mode': 'Chambers of Xeric Challenge Mode icon.png',
  "kree'arra": "Kree'arra icon.png", 'lunar chests': 'Blood Moon icon.png', 'mimic': 'The Mimic icon.png',
  'nightmare': 'The Nightmare icon.png', "phosani's nightmare": 'The Nightmare icon.png',
  'the gauntlet': 'Crystalline Hunllef icon.png', 'the corrupted gauntlet': 'Corrupted Hunllef icon.png',
  'theatre of blood': 'Verzik Vitur icon.png', 'theatre of blood: hard mode': 'Verzik Vitur icon.png',
  'thermonuclear smoke devil': 'Thermonuclear smoke devil icon.png',
  'tombs of amascut': 'Tombs of Amascut - Normal Mode icon.png',
  'tombs of amascut: expert mode': 'Tombs of Amascut - Expert Mode icon.png',
};

export const bossIconFile = name => ICON_FILES[key(bossName(name))] ?? `${bossName(name)} icon.png`;

// Familiar short names used on the KC card when the full name does not fit.
const SHORT_NAMES = {
  'chambers of xeric': 'CoX', 'chambers of xeric: challenge mode': 'CoX: CM', 'theatre of blood': 'ToB',
  'theatre of blood: hard mode': 'ToB: HM', 'tombs of amascut': 'ToA', 'tombs of amascut: expert mode': 'ToA: Expert',
  'the corrupted gauntlet': 'CG', 'the gauntlet': 'Gauntlet', 'thermonuclear smoke devil': 'Thermy',
  'crazy archaeologist': 'Crazy Arch', 'deranged archaeologist': 'Deranged Arch', 'grotesque guardians': 'Grotesques',
  "phosani's nightmare": "Phosani's", 'commander zilyana': 'Zilyana', 'general graardor': 'Graardor',
  "k'ril tsutsaroth": "K'ril", 'alchemical hydra': 'Hydra', 'dagannoth supreme': 'Supreme', 'dagannoth prime': 'Prime',
  'king black dragon': 'KBD', 'corporeal beast': 'Corp', 'the royal titans': 'Royal Titans',
  'doom of mokhaiotl': 'Doom', 'shellbane gryphon': 'Shellbane',
};
export const bossShortName = name => SHORT_NAMES[key(bossName(name))] ?? bossName(name);
export const bossIconUrl = name =>
  `https://oldschool.runescape.wiki/images/${encodeURIComponent(bossIconFile(name).replaceAll(' ', '_'))}`;
