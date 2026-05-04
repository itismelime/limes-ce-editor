import type { DayZType, SpawnableType } from '../types/dayz';

export const CATEGORY_LABELS: Record<string, string> = {
  headgear: 'Headgear',
  facewear: 'Facewear',
  eyewear: 'Eyewear',
  tops: 'Tops',
  bottoms: 'Bottoms',
  footwear: 'Footwear',
  gloves: 'Gloves',
  vests_armor: 'Vests & Armor',
  belts_holsters: 'Belts & Holsters',
  pouches: 'Pouches',
  ghillie: 'Ghillie',
  patches_armbands: 'Patches & Armbands',
  accessories_misc: 'Accessories & Misc Clothing',
  snipers: 'Snipers',
  shotguns: 'Shotguns',
  smgs: 'SMGs',
  lmgs: 'LMGs',
  launchers: 'Launchers',
  rifles: 'Rifles',
  pistols: 'Pistols',
  medical_supplies: 'Medical Supplies',
  basebuilding_items: 'Basebuilding Items',
  vehicle_parts: 'Vehicle Parts',
  navigation_comms: 'Navigation & Comms',
  scopes_sights: 'Scopes & Sights',
  muzzle_suppressors: 'Muzzle & Suppressors',
  weapon_stocks: 'Weapon Stocks',
  weapon_handguards: 'Weapon Handguards',
  weapon_lights_lasers: 'Weapon Lights & Lasers',
  bayonets: 'Bayonets',
  weapons: 'Weapons',
  weapon_parts: 'Weapon Parts',
  ammunition: 'Ammunition',
  magazines: 'Magazines',
  ammoboxes: 'Ammo Boxes',
  explosives: 'Explosives',
  tools: 'Tools',
  containers: 'Containers',
  clothes: 'Clothes',
  bags: 'Backpacks & Bags',
  food: 'Food',
  lore: 'Lore',
  lantia: 'Lantia',
};

export const CATEGORY_ORDER = [
  'headgear', 'facewear', 'eyewear', 'tops', 'bottoms', 'footwear', 'gloves',
  'vests_armor', 'belts_holsters', 'pouches', 'bags', 'ghillie', 'patches_armbands', 'accessories_misc',
  'snipers', 'shotguns', 'smgs', 'lmgs', 'rifles', 'pistols', 'launchers',
  'scopes_sights', 'muzzle_suppressors', 'weapon_stocks', 'weapon_handguards', 'weapon_lights_lasers', 'bayonets',
  'medical_supplies', 'basebuilding_items', 'vehicle_parts', 'navigation_comms',
  'weapons', 'weapon_parts', 'ammunition', 'magazines', 'ammoboxes',
  'explosives', 'tools', 'containers', 'clothes', 'food', 'lore', 'lantia',
];

export const CATEGORY_OPTIONS = CATEGORY_ORDER.filter(c => c in CATEGORY_LABELS);

const ATTACHMENT_KEYWORDS = [
  'suppressor', 'silencer', 'optic', 'scope', 'sight', 'stock', 'grip',
  'handguard', 'rail', 'bipod', 'flashlight', 'laser', 'barrel', 'mount',
  'foregrip', 'buttstock', 'bayonet', 'light',
];

const SCOPE_SIGHT_KEYWORDS = [
  'optic', 'scope', 'sight', 'rds', 'pso', 'acog', 'kobra', 'kashtan', 'mk4', 'buis', 'carryhandle',
  'rmr', 'elcan', 'exps', 'specter', 'pilad', 'pvs4', 'atn', 'k624', 'xps', 'tango',
];

const MUZZLE_KEYWORDS = [
  'suppressor', 'silencer', 'compensator', 'flashhider', 'muzzle', 'brake',
];

const STOCK_KEYWORDS = [
  'bttstck', 'buttstock', 'stock',
];

const HANDGUARD_KEYWORDS = [
  'hndgrd', 'handguard',
];

const WEAPON_PART_KEYWORDS = [
  'grip', 'bipod', 'mount', 'rail', 'roni',
];

const LIGHT_LASER_KEYWORDS = [
  'flashlight', 'light', 'laser', 'tlr',
];

const BAYONET_KEYWORDS = [
  'bayonet',
];

const PISTOL_KEYWORDS = [
  'pistol', 'revolver', 'deagle', 'glock', 'm1911', 'fnx', 'cz75', 'mk2', 'pm73', 'python',
  'xd9', 'fn502',
];

const SNIPER_KEYWORDS = [
  'sniper', 'mosin', 'svd', 'vss', 'tundra', 'cr550', 'winchester70', 'm70', 'awm', 'sr25', 'm110', 'mk12', 'dmr',
  'barret', 'ax50', 'dvl', 'sv98', 'm200', 'm107', 'r700', 'timberwolf',
];

const SHOTGUN_KEYWORDS = [
  'shotgun', 'saiga', 'bk133', 'bk43', 'mp133', 'izh43', 'aa12', 'winchester1897',
];

const SMG_KEYWORDS = [
  'smg', 'submachine', 'mp5', 'ump', 'scorpion', 'pp19', 'vector', 'bizon', 'mp7', 'mp9', 'p90', 'sr2', 'siaga9',
];

const LMG_KEYWORDS = [
  'lmg', 'evoly', 'm134', 'minigun', 'pkm', 'rpd', 'rpk', 'rpk16', 'm249', 'm240', 'mg3', 'stoner', 'negev',
];

const RIFLE_KEYWORDS = [
  'rifle', 'ak', 'm4', 'famas', 'aug', 'g36', 'fal', 'sks', 'blaze', 'repeater',
  'ar15', 'hk416', 'hk417', 'asval', 'ash12', 'beowulf', 'mk16', 'mk17',
  'mcxspear', 'mdrs', 'mk14', 'ruger14', 'rpk16', 'pkm', 'rpd', 'sa58',
  'sa80', 'groza', 'm14', 'ot14', 'kivaari', 'simk18',
];

const LAUNCHER_KEYWORDS = [
  'rpg', 'launcher', 'm79', 'grenade_launcher', 'at4', 'm32',
];

const MEDICAL_KEYWORDS = [
  'bandage', 'dressing', 'disinfectant', 'iodine', 'purification', 'charcoal',
  'vitamin', 'antibiotic', 'epinephrine', 'morphine', 'injector', 'saline',
  'bloodbag', 'bloodtest', 'thermometer', 'painkiller', 'splint', 'firstaid', 'startkitiv',
];

const BASEBUILDING_KEYWORDS = [
  'watchtower', 'fence', 'territoryflag', 'shelter', 'tripwire', 'snaretrap',
  'fishnettrap', 'smallfishtrap', 'barbedwire', 'metalwire', 'woodencrate',
  'undergroundstash', 'barrelholes', 'watchtowerkit', 'fencekit', 'territoryflagkit', 'shelterkit', 'nailbox',
];

const VEHICLE_PART_KEYWORDS = [
  'wheel', 'radiator', 'sparkplug', 'glowplug',
  'headlight', 'hatchback', 'offroad', 'truck', 'sedan', 'civsedan',
  'carradiator', 'wheeldouble',
];

const NAV_COMMS_KEYWORDS = [
  'compass', 'gps', 'rangefinder', 'binocular', 'radio', 'megaphone',
  'watch', 'map', 'antenna',
];

const GHILLIE_KEYWORDS = [
  'ghillie', 'bushrag',
];

const PATCH_ARMBAND_KEYWORDS = [
  'patch', 'armband',
];

const POUCH_KEYWORDS = [
  'pouch', 'magpouch', 'medpouch', 'ammopouch', 'frontpouch', 'backpouch', 'buttpouch', 'utilitypouch', 'grenadepouch',
  'ifak', 'bottle',
];

const BELT_HOLSTER_KEYWORDS = [
  'belt', 'holster', 'sheath', 'gunsling', 'karambit',
];

const BAG_KEYWORDS = [
  'backpack', 'bag', 'pack', 'camelback', 'supplybag', 'assaultpack', 'mmps', 'falcon', 'drysack',
  'slick', 'soviet', 'compact', 'rubicon', 'duffle', 'usmilitary', 'katt',
];

const VEST_ARMOR_KEYWORDS = [
  'vest', 'armor', 'carrier', 'chestrig', 'platecarrier', 'jpc', 'dcs', '6b43', 'c6b43', '6b13', 'iotv', 'tactec', 'ukassvest',
];

const HEADGEAR_KEYWORDS = [
  'helmet', 'boonie', 'booniehat', 'cap', 'beanie', 'flatcap', 'motohelmet', 'hardhat', 'beret', 'cowboyhat', 'headphones',
  'altyn', 'maska', 'killa', 'ballistich', 'combath', 'tach', 'scifih', 'nvg', 'earcovers',
  'sherpahat', 'petushokhat', 'ushanka', 'wintercoif', 'budenovkahat', 'officerhat', 'santashat',
  'scrubshat', 'nbchood', 'headtorch', 'weldingmask', 'hood', 'paragonhp',
];

const FACEWEAR_KEYWORDS = [
  'facemask', 'balaclava', 'balaclavamask', 'eyemask', 'facecover', 'mouthrag', 'scarf',
  'bandana', 'shemag', 'mask', 'beard',
];

const EYEWEAR_KEYWORDS = [
  'goggles', 'glasses', 'visor', 'eyewear',
];

const GLOVES_KEYWORDS = [
  'gloves', 'tacticalgloves', 'handscover',
];

const FOOTWEAR_KEYWORDS = [
  'boots', 'shoes', 'sneakers', 'feetcover',
  'wellies',
];

const BOTTOMS_KEYWORDS = [
  'pants', 'jeans', 'shorts', 'skirt', 'slackspants', 'combatpants', 'tacticalpants', 'legscover',
];

const TOPS_KEYWORDS = [
  'jacket', 'shirt', 'coat', 'hoodie', 'sweater', 'tshirt', 'operatorshirt', 'combatshirt', 'tacticalshirt', 'raincoat',
  'bomberjacket', 'quiltedjacket', 'woolcoat', 'man', 'woman', 'torso', 'torsocover',
  'dress', 'blouse', 'gorkaup', 'sumrakup', 'yegerup',
];

function hasAnyKeyword(lower: string, parts: string[], keywords: string[]): boolean {
  const compact = lower.replace(/[^a-z0-9]/g, '');
  return keywords.some(k => {
    const normalized = k.replace(/[^a-z0-9]/g, '');
    if (!normalized) return false;

    // For short weapon model tokens (ak, m4, etc.), avoid broad substring hits like "black".
    const tokenMatch = parts.some(p => {
      if (p === k) return true;
      if (normalized.length <= 3) return p.startsWith(k) || p.endsWith(k);
      return p.startsWith(k) || p.endsWith(k) || p.includes(k);
    });
    if (tokenMatch) return true;

    if (normalized.length >= 4) {
      if (lower.includes(k) || compact.includes(normalized)) return true;
    }
    return false;
  });
}

function tokenizeName(rawName: string): { lower: string; parts: string[] } {
  const lower = rawName.toLowerCase();
  const parts = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return { lower, parts };
}

export function buildAttachmentNames(spawnableTypes: Map<string, SpawnableType>): Set<string> {
  const s = new Set<string>();
  for (const st of spawnableTypes.values()) {
    for (const group of st.attachments) {
      for (const att of group.items) s.add(att.name);
    }
  }
  return s;
}

function autoDisplayCategory(item: DayZType, attachmentNames: Set<string>): string {
  const cat = item.category?.toLowerCase() ?? '__none__';
  const { lower, parts } = tokenizeName(item.name);

  const clothingLike = cat === 'clothes' || cat === 'bags' || (cat === '__none__' && (
    hasAnyKeyword(lower, parts, GHILLIE_KEYWORDS) ||
    hasAnyKeyword(lower, parts, PATCH_ARMBAND_KEYWORDS) ||
    hasAnyKeyword(lower, parts, HEADGEAR_KEYWORDS) ||
    hasAnyKeyword(lower, parts, FACEWEAR_KEYWORDS) ||
    hasAnyKeyword(lower, parts, EYEWEAR_KEYWORDS) ||
    hasAnyKeyword(lower, parts, GLOVES_KEYWORDS) ||
    hasAnyKeyword(lower, parts, FOOTWEAR_KEYWORDS) ||
    hasAnyKeyword(lower, parts, BOTTOMS_KEYWORDS) ||
    hasAnyKeyword(lower, parts, TOPS_KEYWORDS) ||
    hasAnyKeyword(lower, parts, VEST_ARMOR_KEYWORDS) ||
    hasAnyKeyword(lower, parts, BELT_HOLSTER_KEYWORDS) ||
    hasAnyKeyword(lower, parts, POUCH_KEYWORDS) ||
    hasAnyKeyword(lower, parts, BAG_KEYWORDS)
  ));

  if (clothingLike) {
    if (hasAnyKeyword(lower, parts, GHILLIE_KEYWORDS)) return 'ghillie';
    if (hasAnyKeyword(lower, parts, PATCH_ARMBAND_KEYWORDS)) return 'patches_armbands';
    if (hasAnyKeyword(lower, parts, POUCH_KEYWORDS)) return 'pouches';
    if (hasAnyKeyword(lower, parts, BELT_HOLSTER_KEYWORDS)) return 'belts_holsters';
    if (hasAnyKeyword(lower, parts, BAG_KEYWORDS)) return 'bags';
    if (hasAnyKeyword(lower, parts, VEST_ARMOR_KEYWORDS)) return 'vests_armor';
    if (hasAnyKeyword(lower, parts, HEADGEAR_KEYWORDS)) return 'headgear';
    if (hasAnyKeyword(lower, parts, FACEWEAR_KEYWORDS)) return 'facewear';
    if (hasAnyKeyword(lower, parts, EYEWEAR_KEYWORDS)) return 'eyewear';
    if (hasAnyKeyword(lower, parts, GLOVES_KEYWORDS)) return 'gloves';
    if (hasAnyKeyword(lower, parts, FOOTWEAR_KEYWORDS)) return 'footwear';
    if (hasAnyKeyword(lower, parts, BOTTOMS_KEYWORDS)) return 'bottoms';
    if (hasAnyKeyword(lower, parts, TOPS_KEYWORDS)) return 'tops';
    if (cat === 'bags') return 'bags';
    return 'accessories_misc';
  }

  const weaponLike = cat === 'weapons' || attachmentNames.has(item.name) || parts[0] === 'ad';
  if (weaponLike) {
    if (parts.some(p => p === 'ammobox' || p.endsWith('ammobox'))) return 'ammoboxes';
    if (parts.some(p => p === 'mag' || p.endsWith('magazine'))) return 'magazines';
    if (parts.some(p => p === 'ammo' || p.endsWith('ammo'))) return 'ammunition';
    if (parts.some(p => p === 'belt') && parts.some(p => p.includes('rnd'))) return 'magazines';

    // AWS-style optic/attachment assets are often prefixed with AD_ and marked as weapons.
    if (lower.startsWith('ad_')) {
      if (hasAnyKeyword(lower, parts, WEAPON_PART_KEYWORDS)) return 'weapon_parts';
      return 'scopes_sights';
    }

    if (hasAnyKeyword(lower, parts, SCOPE_SIGHT_KEYWORDS)) return 'scopes_sights';
    if (hasAnyKeyword(lower, parts, MUZZLE_KEYWORDS)) return 'muzzle_suppressors';
    if (hasAnyKeyword(lower, parts, STOCK_KEYWORDS)) return 'weapon_stocks';
    if (hasAnyKeyword(lower, parts, HANDGUARD_KEYWORDS)) return 'weapon_handguards';
    if (hasAnyKeyword(lower, parts, LIGHT_LASER_KEYWORDS)) return 'weapon_lights_lasers';
    if (hasAnyKeyword(lower, parts, BAYONET_KEYWORDS)) return 'bayonets';
    if (hasAnyKeyword(lower, parts, WEAPON_PART_KEYWORDS)) return 'weapon_parts';

    if (parts[0] === 'ad') return 'weapon_parts';
    if (attachmentNames.has(item.name)) return 'weapon_parts';
    if (ATTACHMENT_KEYWORDS.some(k => parts.some(p => p === k || p.endsWith(k) || p.includes(k)))) return 'weapon_parts';
    if (hasAnyKeyword(lower, parts, PISTOL_KEYWORDS)) return 'pistols';
    if (hasAnyKeyword(lower, parts, SNIPER_KEYWORDS)) return 'snipers';
    if (hasAnyKeyword(lower, parts, SHOTGUN_KEYWORDS)) return 'shotguns';
    if (hasAnyKeyword(lower, parts, SMG_KEYWORDS)) return 'smgs';
    if (hasAnyKeyword(lower, parts, LMG_KEYWORDS)) return 'lmgs';
    if (hasAnyKeyword(lower, parts, LAUNCHER_KEYWORDS)) return 'launchers';
    if (hasAnyKeyword(lower, parts, RIFLE_KEYWORDS)) return 'rifles';
    if (cat === 'weapons') return 'weapons';
  }

  const supportsFlexibleMapping = cat === 'tools' || cat === '__none__' || cat === 'containers';
  if (supportsFlexibleMapping) {
    if (hasAnyKeyword(lower, parts, MEDICAL_KEYWORDS)) return 'medical_supplies';
    if (hasAnyKeyword(lower, parts, BASEBUILDING_KEYWORDS)) return 'basebuilding_items';
    if (hasAnyKeyword(lower, parts, VEHICLE_PART_KEYWORDS)) return 'vehicle_parts';
    if (hasAnyKeyword(lower, parts, NAV_COMMS_KEYWORDS)) return 'navigation_comms';

    // Some mods place optics in tools; keep them grouped with weapon sighting gear.
    if (hasAnyKeyword(lower, parts, SCOPE_SIGHT_KEYWORDS)) return 'scopes_sights';
  }

  return cat;
}

export function displayCategory(
  item: DayZType,
  attachmentNames: Set<string>,
  overrides?: Record<string, string>,
): string {
  const override = overrides?.[item.name.toLowerCase()];
  if (override) return override;
  return autoDisplayCategory(item, attachmentNames);
}
