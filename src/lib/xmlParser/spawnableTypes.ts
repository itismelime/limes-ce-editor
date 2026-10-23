import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SpawnableType, SpawnableCargo, SpawnableAttachments, SpawnableItem } from '../../types/dayz';
import {
  PARSER_OPTIONS, BUILDER_OPTIONS, stripBom,
  num, numAttr, strAttr, collectUnknownKeys,
} from './shared';

const SPAWNABLE_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => ['type', 'usage', 'category', 'tag', 'cargo', 'attachments', 'item'].includes(name),
};

function normalizeSpawnableRoot(raw: string): string {
  const stripped = stripBom(raw)
    .replace(/<\?xml[^?]*\?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trimStart();
  if (/^<(?:spawnabletypes|cfgspawnabletypes)[\s>]/i.test(stripped)) return raw;
  return `<spawnabletypes>${stripped}</spawnabletypes>`;
}

type Raw = Record<string, unknown>;

function parseDamage(d: Raw | undefined) {
  if (!d) return undefined;
  return { min: num(d['@_min']), max: num(d['@_max']), rawMin: String(d['@_min'] ?? ''), rawMax: String(d['@_max'] ?? '') };
}

function parseItem(i: Raw): SpawnableItem {
  const damage = parseDamage(i.damage as Raw | undefined);
  const cargo = ((i.cargo as Raw[]) ?? []).map(parseBlock);
  const attachments = ((i.attachments as Raw[]) ?? []).map(parseBlock);
  return {
    name:      strAttr(i, 'name'),
    // DayZ treats a missing item chance as 1 (always spawns)
    chance:    numAttr(i, 'chance', 1),
    rawChance: String(i['@_chance'] ?? ''),
    ...(damage ? { damage } : {}),
    ...(cargo.length ? { cargo } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

function parseBlock(c: Raw): SpawnableCargo {
  return {
    chance: num(c['@_chance'], 1),
    rawChance: String(c['@_chance'] ?? ''),
    ...(typeof c['@_preset'] === 'string' && String(c['@_preset']).trim() ? { preset: String(c['@_preset']) } : {}),
    items: ((c.item as Raw[]) ?? []).map(parseItem),
  };
}

export function parseSpawnableTypesXml(raw: string, source: string, duplicates?: string[]): Map<string, SpawnableType> {
  const parser = new XMLParser(SPAWNABLE_PARSER_OPTIONS);
  const doc = parser.parse(normalizeSpawnableRoot(raw));
  const typesList: unknown[] = doc?.spawnabletypes?.type ?? doc?.cfgspawnabletypes?.type ?? [];
  const map = new Map<string, SpawnableType>();

  for (const t of typesList) {
    const st = t as Record<string, unknown>;
    const cargoArr  = (st.cargo       as Record<string, unknown>[]) ?? [];
    const attArr    = (st.attachments as Record<string, unknown>[]) ?? [];
    const damageRaw  = st.damage  as Record<string, unknown> | undefined;

    const cargo: SpawnableCargo[] = cargoArr.map(parseBlock);
    const attachments: SpawnableAttachments[] = attArr.map(parseBlock);

    const spawnableType: SpawnableType = {
      name:       strAttr(st, 'name'),
      usages:     ((st.usage    as Record<string, unknown>[]) ?? []).map(u  => strAttr(u,  'name')),
      categories: ((st.category as Record<string, unknown>[]) ?? []).map(c  => strAttr(c,  'name')),
      tags:       ((st.tag      as Record<string, unknown>[]) ?? []).map(tg => strAttr(tg, 'name')),
      cargo,
      attachments,
      // <hoarder/> parses to '' (falsy), so test presence, not value
      ...('hoarder' in st ? { hoarder: true } : {}),
      ...(damageRaw ? { damage: parseDamage(damageRaw)! } : {}),
      source,
    };
    if (map.has(spawnableType.name)) duplicates?.push(spawnableType.name);
    map.set(spawnableType.name, spawnableType);
  }
  return map;
}

// Keep chance as written; a preset block only carries chance if the file had one.
function blockAttrs(b: SpawnableCargo | SpawnableAttachments): Record<string, string> {
  const chance = b.rawChance?.trim() || (b.preset ? '' : b.chance.toFixed(2));
  return { ...(b.preset ? { '@_preset': b.preset } : {}), ...(chance ? { '@_chance': chance } : {}) };
}

function itemAttrs(i: SpawnableItem): Record<string, unknown> {
  const chance = i.rawChance?.trim() || (i.chance === 1 ? '' : i.chance.toFixed(2));
  return {
    '@_name': i.name,
    ...(chance ? { '@_chance': chance } : {}),
    ...(i.damage ? { damage: damageAttrs(i.damage) } : {}),
    ...(i.cargo?.length ? { cargo: i.cargo.map(blockNode) } : {}),
    ...(i.attachments?.length ? { attachments: i.attachments.map(blockNode) } : {}),
  };
}

function damageAttrs(d: NonNullable<SpawnableItem['damage']>) {
  return { '@_min': d.rawMin?.trim() || String(d.min), '@_max': d.rawMax?.trim() || String(d.max) };
}

function blockNode(b: SpawnableCargo | SpawnableAttachments) {
  return { ...blockAttrs(b), ...(b.items.length ? { item: b.items.map(itemAttrs) } : {}) };
}

export function serializeSpawnableTypesXml(spawnableTypes: Map<string, SpawnableType>): string {
  const typesList = Array.from(spawnableTypes.values()).map(st => ({
    '@_name': st.name,
    ...(st.usages.length     ? { usage:    st.usages.map(u   => ({ '@_name': u   })) } : {}),
    ...(st.categories.length ? { category: st.categories.map(c => ({ '@_name': c })) } : {}),
    ...(st.tags.length       ? { tag:      st.tags.map(tag   => ({ '@_name': tag })) } : {}),
    ...(st.cargo.length ? {
      cargo: st.cargo.map(blockNode),
    } : {}),
    ...(st.attachments.length ? {
      attachments: st.attachments.map(blockNode),
    } : {}),
    ...(st.hoarder ? { hoarder: {} } : {}),
    ...(st.damage ? { damage: damageAttrs(st.damage) } : {}),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ spawnabletypes: { type: typesList } });
}

export function inspectSpawnableTypesCompatibility(raw: string): string[] {
  const parser = new XMLParser(SPAWNABLE_PARSER_OPTIONS);
  const doc = parser.parse(normalizeSpawnableRoot(raw));
  const typesList: unknown[] = doc?.spawnabletypes?.type ?? doc?.cfgspawnabletypes?.type ?? [];
  const unknown = new Set<string>();
  const knownTypeKeys  = new Set(['@_name', 'usage', 'category', 'tag', 'cargo', 'attachments', 'hoarder', 'damage']);
  const knownBlockKeys = new Set(['@_chance', '@_preset', 'item']);
  const knownItemAttrs = new Set(['@_name', '@_chance', 'damage', 'cargo', 'attachments']);
  const knownDamageAttrs = new Set(['@_min', '@_max']);

  for (const t of typesList) {
    const st = t as Record<string, unknown>;
    collectUnknownKeys(st, knownTypeKeys, 'spawnabletypes.type', unknown);

    const cargoArr = (st.cargo as Record<string, unknown>[] | undefined) ?? [];
    for (const cargo of cargoArr) {
      collectUnknownKeys(cargo, knownBlockKeys, 'spawnabletypes.type.cargo', unknown);
      for (const i of (cargo.item as Record<string, unknown>[] | undefined) ?? []) {
        collectUnknownKeys(i, knownItemAttrs, 'spawnabletypes.type.cargo.item', unknown);
      }
    }

    const attArr = (st.attachments as Record<string, unknown>[] | undefined) ?? [];
    for (const att of attArr) {
      collectUnknownKeys(att, knownBlockKeys, 'spawnabletypes.type.attachments', unknown);
      for (const i of (att.item as Record<string, unknown>[] | undefined) ?? []) {
        collectUnknownKeys(i, knownItemAttrs, 'spawnabletypes.type.attachments.item', unknown);
      }
    }

    if (st.damage && typeof st.damage === 'object') {
      collectUnknownKeys(st.damage as Record<string, unknown>, knownDamageAttrs, 'spawnabletypes.type.damage', unknown);
    }
  }

  return [...unknown].sort();
}
