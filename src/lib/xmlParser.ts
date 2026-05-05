import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { IS_COMPAT_MODE } from './ceMode';
import type {
  DayZType, DayZTypeFlags, DayZEvent, EventSpawnDef,
  SpawnableType, SpawnableCargo, SpawnableAttachments, CeEntry,
  ContainerDef, WeatherData, WeatherValue, GameplayData,
} from '../types/dayz';

const ALWAYS_ARRAY = new Set([
  'type', 'event', 'pos', 'usage', 'tier', 'child',
  'cargo', 'attachments', 'item', 'value',
]);

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name: string) => ALWAYS_ARRAY.has(name),
};

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressBooleanAttributes: false,
  processEntities: false,
};

function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function numAttr(obj: Record<string, unknown>, key: string, fallback = 0): number {
  return num(obj[`@_${key}`], fallback);
}

function strAttr(obj: Record<string, unknown>, key: string, fallback = ''): string {
  return String(obj[`@_${key}`] ?? fallback);
}

function strAttrs(obj: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = obj[`@_${key}`];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function collectUnknownKeys(
  obj: Record<string, unknown>,
  known: Set<string>,
  prefix: string,
  out: Set<string>,
) {
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;
    out.add(`${prefix}.${key}`);
  }
}

// ─── types.xml ────────────────────────────────────────────────────────────────

export function parseTypesXml(raw: string, source: string): Map<string, DayZType> {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const typesList: unknown[] = doc?.types?.type ?? [];
  const map = new Map<string, DayZType>();

  for (const t of typesList) {
    const item = t as Record<string, unknown>;
    const flagsRaw = (item.flags as Record<string, unknown> | undefined) ?? {};
    const quantminPresent = Object.prototype.hasOwnProperty.call(item, 'quantmin');
    const quantmaxPresent = Object.prototype.hasOwnProperty.call(item, 'quantmax');
    const flags: DayZTypeFlags = {
      count_in_cargo:  numAttr(flagsRaw, 'count_in_cargo') as 0 | 1,
      count_in_hoarder: numAttr(flagsRaw, 'count_in_hoarder') as 0 | 1,
      count_in_map:    numAttr(flagsRaw, 'count_in_map') as 0 | 1,
      count_in_player: numAttr(flagsRaw, 'count_in_player') as 0 | 1,
      crafted:         numAttr(flagsRaw, 'crafted') as 0 | 1,
      deloot:          numAttr(flagsRaw, 'deloot') as 0 | 1,
    };
    const categoryRaw = item.category as Record<string, unknown> | undefined;
    const usageArr = toObjectArray(item.usage);
    const valueArr = toObjectArray(item.value);
    const tagArr = toObjectArray(item.tag);
    const tags = tagArr.map(tag => strAttr(tag, 'name')).filter(Boolean);
    const parsedUsages = usageArr.map(u => strAttr(u, 'name')).filter(Boolean);
    const parsedTiers = valueArr
      .map(v => (IS_COMPAT_MODE ? strAttrs(v, ['name', 'user']) : strAttr(v, 'name')))
      .filter(Boolean)
      .flatMap(parseTierValue);

    const type: DayZType = {
      name:      strAttr(item, 'name'),
      nominal:   num(item.nominal),
      lifetime:  num(item.lifetime),
      restock:   num(item.restock),
      min:       num(item.min),
      quantmin:  num(item.quantmin, -1),
      quantmax:  num(item.quantmax, -1),
      quantminPresent,
      quantmaxPresent,
      cost:      num(item.cost, 100),
      flags,
      category:  categoryRaw ? strAttr(categoryRaw, 'name') : null,
      usages:    IS_COMPAT_MODE ? (parsedUsages.length > 0 ? parsedUsages : tags) : parsedUsages,
      tiers:     [...new Set(parsedTiers)],
      tags,
      source,
    };
    map.set(type.name, type);
  }
  return map;
}

export function serializeTypesXml(types: Map<string, DayZType>): string {
  const typesList = Array.from(types.values()).map(t => ({
    '@_name': t.name,
    nominal:  String(t.nominal),
    lifetime: String(t.lifetime),
    restock:  String(t.restock),
    min:      String(t.min),
    ...((t.quantminPresent ?? false) || t.quantmin !== -1 ? { quantmin: String(t.quantmin) } : {}),
    ...((t.quantmaxPresent ?? false) || t.quantmax !== -1 ? { quantmax: String(t.quantmax) } : {}),
    cost:     String(t.cost),
    flags: {
      '@_count_in_cargo':  String(t.flags.count_in_cargo),
      '@_count_in_hoarder': String(t.flags.count_in_hoarder),
      '@_count_in_map':    String(t.flags.count_in_map),
      '@_count_in_player': String(t.flags.count_in_player),
      '@_crafted':         String(t.flags.crafted),
      '@_deloot':          String(t.flags.deloot),
    },
    ...(t.category ? { category: { '@_name': t.category } } : {}),
    ...(t.usages.length ? { usage: t.usages.map(u  => ({ '@_name': u  })) } : {}),
    ...(t.tiers.length  ? {
      value: t.tiers.map(ti => (
        IS_COMPAT_MODE ? { '@_name': ti, '@_user': ti } : { '@_name': ti }
      )),
    } : {}),
    ...(t.tags && t.tags.length ? { tag: t.tags.map(tag => ({ '@_name': tag })) } : {}),
  }));

  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ types: { type: typesList } });
}

export function inspectTypesXmlCompatibility(raw: string): string[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const typesList: unknown[] = doc?.types?.type ?? [];
  const unknown = new Set<string>();
  const knownTypeKeys = new Set(['@_name', 'nominal', 'lifetime', 'restock', 'min', 'quantmin', 'quantmax', 'cost', 'flags', 'category', 'usage', 'value', 'tag']);
  const knownFlags = new Set(['@_count_in_cargo', '@_count_in_hoarder', '@_count_in_map', '@_count_in_player', '@_crafted', '@_deloot']);
  const knownTagAttrs = new Set(['@_name']);

  for (const t of typesList) {
    const typeObj = t as Record<string, unknown>;
    collectUnknownKeys(typeObj, knownTypeKeys, 'types.type', unknown);
    if (typeObj.flags && typeof typeObj.flags === 'object') {
      collectUnknownKeys(typeObj.flags as Record<string, unknown>, knownFlags, 'types.type.flags', unknown);
    }
    const tags = toObjectArray(typeObj.tag);
    for (const tag of tags) {
      collectUnknownKeys(tag, knownTagAttrs, 'types.type.tag', unknown);
    }
  }

  return [...unknown].sort();
}

// ─── cfgeventspawns.xml ───────────────────────────────────────────────────────

export function parseEventSpawnsXml(raw: string): EventSpawnDef[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const events = toObjectArray(doc?.eventposdef?.event);

  return events.map(e => {
    const ev = e as Record<string, unknown>;
    const positions = toObjectArray(ev.pos).map(p => {
      const extraAttrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(p)) {
        if (!key.startsWith('@_')) continue;
        const attr = key.slice(2);
        if (attr === 'x' || attr === 'z') continue;
        extraAttrs[attr] = String(value ?? '');
      }
      return {
        x: num(p['@_x']),
        z: num(p['@_z']),
        rawX: String(p['@_x'] ?? ''),
        rawZ: String(p['@_z'] ?? ''),
        ...(Object.keys(extraAttrs).length > 0 ? { extraAttrs } : {}),
      };
    });
    const zones = toObjectArray(ev.zone).map(z => ({
      smin: num(z['@_smin']),
      smax: num(z['@_smax']),
      dmin: num(z['@_dmin']),
      dmax: num(z['@_dmax']),
      r: num(z['@_r']),
      rawSmin: String(z['@_smin'] ?? ''),
      rawSmax: String(z['@_smax'] ?? ''),
      rawDmin: String(z['@_dmin'] ?? ''),
      rawDmax: String(z['@_dmax'] ?? ''),
      rawR: String(z['@_r'] ?? ''),
    }));
    return { eventName: strAttr(ev, 'name'), positions, ...(zones.length > 0 ? { zones } : {}) };
  });
}

export function serializeEventSpawnsXml(spawns: EventSpawnDef[]): string {
  const events = spawns.map(s => ({
    '@_name': s.eventName,
    ...(s.zones && s.zones.length > 0 ? {
      zone: s.zones.map(z => ({
        '@_smin': z.rawSmin?.trim() || String(z.smin),
        '@_smax': z.rawSmax?.trim() || String(z.smax),
        '@_dmin': z.rawDmin?.trim() || String(z.dmin),
        '@_dmax': z.rawDmax?.trim() || String(z.dmax),
        '@_r': z.rawR?.trim() || String(z.r),
      })),
    } : {}),
    pos: s.positions.map(p => ({
      '@_x': p.rawX?.trim() || String(p.x),
      '@_z': p.rawZ?.trim() || String(p.z),
      ...Object.fromEntries(Object.entries(p.extraAttrs ?? {}).map(([k, v]) => [`@_${k}`, v])),
    })),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ eventposdef: { event: events } });
}

export function inspectEventSpawnsCompatibility(raw: string): string[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const events = toObjectArray(doc?.eventposdef?.event);
  const unknown = new Set<string>();
  const knownEventKeys = new Set(['@_name', 'pos', 'zone']);
  const knownPosAttrs = new Set(['@_x', '@_z', '@_a', '@_y', '@_group']);
  const knownZoneAttrs = new Set(['@_smin', '@_smax', '@_dmin', '@_dmax', '@_r']);

  for (const e of events) {
    const ev = e as Record<string, unknown>;
    collectUnknownKeys(ev, knownEventKeys, 'eventposdef.event', unknown);
    const positions = toObjectArray(ev.pos);
    for (const p of positions) {
      collectUnknownKeys(p, knownPosAttrs, 'eventposdef.event.pos', unknown);
    }
    const zones = toObjectArray(ev.zone);
    for (const z of zones) {
      collectUnknownKeys(z, knownZoneAttrs, 'eventposdef.event.zone', unknown);
    }
  }

  return [...unknown].sort();
}

// ─── events.xml ───────────────────────────────────────────────────────────────

export function parseEventsXml(raw: string): Map<string, DayZEvent> {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const eventsList: unknown[] = doc?.events?.event ?? [];
  const map = new Map<string, DayZEvent>();

  for (const e of eventsList) {
    const ev = e as Record<string, unknown>;
    const childrenRaw = (ev.children as Record<string, unknown> | undefined);
    const childArr = (childrenRaw?.child as Record<string, unknown>[]) ?? [];

    const event: DayZEvent = {
      name:           strAttr(ev, 'name'),
      nominal:        num(ev.nominal),
      min:            num(ev.min),
      max:            num(ev.max),
      lifetime:       num(ev.lifetime),
      restock:        num(ev.restock),
      saferadius:     num(ev.saferadius, 20),
      distanceradius: num(ev.distanceradius, 20),
      cleanupradius:  num(ev.cleanupradius, 200),
      active:         num(ev.active) as 0 | 1,
      ...(ev.flags ? {
        flags: {
          deletable: numAttr(ev.flags as Record<string, unknown>, 'deletable') as 0 | 1,
          init_random: numAttr(ev.flags as Record<string, unknown>, 'init_random') as 0 | 1,
          remove_damaged: numAttr(ev.flags as Record<string, unknown>, 'remove_damaged') as 0 | 1,
          sec_spawner: numAttr(ev.flags as Record<string, unknown>, 'sec_spawner') as 0 | 1,
        },
      } : {}),
      ...(typeof ev.position === 'string' ? { position: ev.position } : {}),
      ...(typeof ev.limit === 'string' ? { limit: ev.limit } : {}),
      ...(typeof ev.secondary === 'string' ? { secondary: ev.secondary } : {}),
      children:       childArr.map(c => ({
        type:    strAttr(c, 'type'),
        min:     numAttr(c, 'min'),
        max:     numAttr(c, 'max'),
        lootmin: numAttr(c, 'lootmin'),
        lootmax: numAttr(c, 'lootmax'),
      })),
    };
    map.set(event.name, event);
  }
  return map;
}

export function serializeEventsXml(events: Map<string, DayZEvent>): string {
  const eventsList = Array.from(events.values()).map(e => ({
    '@_name':        e.name,
    nominal:         String(e.nominal),
    min:             String(e.min),
    max:             String(e.max),
    lifetime:        String(e.lifetime),
    restock:         String(e.restock),
    saferadius:      String(e.saferadius),
    distanceradius:  String(e.distanceradius),
    cleanupradius:   String(e.cleanupradius),
    ...(e.flags ? {
      flags: {
        '@_deletable': String(e.flags.deletable ?? 0),
        '@_init_random': String(e.flags.init_random ?? 0),
        '@_remove_damaged': String(e.flags.remove_damaged ?? 0),
        ...(typeof e.flags.sec_spawner === 'number' ? { '@_sec_spawner': String(e.flags.sec_spawner) } : {}),
      },
    } : {}),
    ...(e.position ? { position: e.position } : {}),
    ...(e.limit ? { limit: e.limit } : {}),
    ...(e.secondary ? { secondary: e.secondary } : {}),
    active:          String(e.active),
    children: {
      child: e.children.map(c => ({
        '@_type':    c.type,
        '@_min':     String(c.min),
        '@_max':     String(c.max),
        '@_lootmin': String(c.lootmin),
        '@_lootmax': String(c.lootmax),
      })),
    },
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ events: { event: eventsList } });
}

export function inspectEventsXmlCompatibility(raw: string): string[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const eventsList: unknown[] = doc?.events?.event ?? [];
  const unknown = new Set<string>();
  const knownEventKeys = new Set(['@_name', 'nominal', 'min', 'max', 'lifetime', 'restock', 'saferadius', 'distanceradius', 'cleanupradius', 'flags', 'position', 'limit', 'secondary', 'active', 'children']);
  const knownFlagsAttrs = new Set(['@_deletable', '@_init_random', '@_remove_damaged', '@_sec_spawner']);
  const knownChildrenKeys = new Set(['child']);
  const knownChildAttrs = new Set(['@_type', '@_min', '@_max', '@_lootmin', '@_lootmax']);

  for (const e of eventsList) {
    const ev = e as Record<string, unknown>;
    collectUnknownKeys(ev, knownEventKeys, 'events.event', unknown);
    const flags = ev.flags as Record<string, unknown> | undefined;
    if (flags) collectUnknownKeys(flags, knownFlagsAttrs, 'events.event.flags', unknown);
    const children = ev.children as Record<string, unknown> | undefined;
    if (children) {
      collectUnknownKeys(children, knownChildrenKeys, 'events.event.children', unknown);
      const childArr = (children.child as Record<string, unknown>[] | undefined) ?? [];
      for (const c of childArr) {
        collectUnknownKeys(c, knownChildAttrs, 'events.event.children.child', unknown);
      }
    }
  }

  return [...unknown].sort();
}

// ─── cfgspawnabletypes.xml ────────────────────────────────────────────────────

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

export function parseSpawnableTypesXml(raw: string, source: string): Map<string, SpawnableType> {
  const parser = new XMLParser(SPAWNABLE_PARSER_OPTIONS);
  const doc = parser.parse(normalizeSpawnableRoot(raw));
  const typesList: unknown[] = doc?.spawnabletypes?.type ?? doc?.cfgspawnabletypes?.type ?? [];
  const map = new Map<string, SpawnableType>();

  for (const t of typesList) {
    const st = t as Record<string, unknown>;
    const cargoArr = (st.cargo as Record<string, unknown>[]) ?? [];
    const attArr   = (st.attachments as Record<string, unknown>[]) ?? [];
    const damageRaw = st.damage as Record<string, unknown> | undefined;
    const hoarderRaw = st.hoarder as Record<string, unknown> | undefined;

    const cargo: SpawnableCargo[] = cargoArr.map(c => ({
      chance: num(c['@_chance'], 1),
      rawChance: String(c['@_chance'] ?? ''),
      ...(typeof c['@_preset'] === 'string' && String(c['@_preset']).trim() ? { preset: String(c['@_preset']) } : {}),
      items: ((c.item as Record<string, unknown>[]) ?? []).map(i => ({
        name:      strAttr(i, 'name'),
        chance:    numAttr(i as Record<string, unknown>, 'chance'),
        rawChance: String((i as Record<string, unknown>)['@_chance'] ?? ''),
      })),
    }));

    const attachments: SpawnableAttachments[] = attArr.map(a => ({
      chance: num(a['@_chance'], 1),
      rawChance: String(a['@_chance'] ?? ''),
      ...(typeof a['@_preset'] === 'string' && String(a['@_preset']).trim() ? { preset: String(a['@_preset']) } : {}),
      items: ((a.item as Record<string, unknown>[]) ?? []).map(i => ({
        name:      strAttr(i, 'name'),
        chance:    numAttr(i as Record<string, unknown>, 'chance'),
        rawChance: String((i as Record<string, unknown>)['@_chance'] ?? ''),
      })),
    }));

    const spawnableType: SpawnableType = {
      name: strAttr(st, 'name'),
      usages:     ((st.usage as Record<string,unknown>[]) ?? []).map(u => strAttr(u, 'name')),
      categories: ((st.category as Record<string,unknown>[]) ?? []).map(c => strAttr(c, 'name')),
      tags:       ((st.tag as Record<string,unknown>[]) ?? []).map(tg => strAttr(tg, 'name')),
      cargo,
      attachments,
      ...(hoarderRaw ? { hoarder: true } : {}),
      ...(damageRaw ? {
        damage: {
          min: num(damageRaw['@_min']),
          max: num(damageRaw['@_max']),
          rawMin: String(damageRaw['@_min'] ?? ''),
          rawMax: String(damageRaw['@_max'] ?? ''),
        },
      } : {}),
      source,
    };
    map.set(spawnableType.name, spawnableType);
  }
  return map;
}

export function serializeSpawnableTypesXml(spawnableTypes: Map<string, SpawnableType>): string {
  const typesList = Array.from(spawnableTypes.values()).map(st => ({
    '@_name': st.name,
    ...(st.usages.length ? { usage: st.usages.map(usage => ({ '@_name': usage })) } : {}),
    ...(st.categories.length ? { category: st.categories.map(category => ({ '@_name': category })) } : {}),
    ...(st.tags.length ? { tag: st.tags.map(tag => ({ '@_name': tag })) } : {}),
    ...(st.cargo.length ? {
      cargo: st.cargo.map(c => ({
        ...(c.preset ? { '@_preset': c.preset } : { '@_chance': c.rawChance?.trim() || c.chance.toFixed(2) }),
        ...(c.items.length ? { item: c.items.map(i => ({ '@_name': i.name, '@_chance': i.rawChance?.trim() || i.chance.toFixed(2) })) } : {}),
      })),
    } : {}),
    ...(st.attachments.length ? {
      attachments: st.attachments.map(a => ({
        ...(a.preset ? { '@_preset': a.preset } : { '@_chance': a.rawChance?.trim() || a.chance.toFixed(2) }),
        ...(a.items.length ? { item: a.items.map(i => ({ '@_name': i.name, '@_chance': i.rawChance?.trim() || i.chance.toFixed(2) })) } : {}),
      })),
    } : {}),
    ...(st.hoarder ? { hoarder: {} } : {}),
    ...(st.damage ? {
      damage: {
        '@_min': st.damage.rawMin?.trim() || String(st.damage.min),
        '@_max': st.damage.rawMax?.trim() || String(st.damage.max),
      },
    } : {}),
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
  const knownTypeKeys = new Set(['@_name', 'usage', 'category', 'tag', 'cargo', 'attachments', 'hoarder', 'damage']);
  const knownBlockKeys = new Set(['@_chance', '@_preset', 'item']);
  const knownItemAttrs = new Set(['@_name', '@_chance']);
  const knownDamageAttrs = new Set(['@_min', '@_max']);

  for (const t of typesList) {
    const st = t as Record<string, unknown>;
    collectUnknownKeys(st, knownTypeKeys, 'spawnabletypes.type', unknown);

    const cargoArr = (st.cargo as Record<string, unknown>[] | undefined) ?? [];
    for (const cargo of cargoArr) {
      collectUnknownKeys(cargo, knownBlockKeys, 'spawnabletypes.type.cargo', unknown);
      const items = (cargo.item as Record<string, unknown>[] | undefined) ?? [];
      for (const i of items) collectUnknownKeys(i, knownItemAttrs, 'spawnabletypes.type.cargo.item', unknown);
    }

    const attArr = (st.attachments as Record<string, unknown>[] | undefined) ?? [];
    for (const att of attArr) {
      collectUnknownKeys(att, knownBlockKeys, 'spawnabletypes.type.attachments', unknown);
      const items = (att.item as Record<string, unknown>[] | undefined) ?? [];
      for (const i of items) collectUnknownKeys(i, knownItemAttrs, 'spawnabletypes.type.attachments.item', unknown);
    }

    if (st.damage && typeof st.damage === 'object') {
      collectUnknownKeys(st.damage as Record<string, unknown>, knownDamageAttrs, 'spawnabletypes.type.damage', unknown);
    }
  }

  return [...unknown].sort();
}

// ─── mapgroupproto.xml + mapgrouppos.xml ─────────────────────────────────────

import type { BuildingInstance } from '../types/dayz';

const PROTO_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => ['group', 'usage', 'container', 'category', 'tag', 'value'].includes(name),
};

const POS_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'group',
};

function sanitizeReservedTagNames(xml: string): string {
  // fast-xml-parser rejects tag names matching JS reserved words (prototype, constructor, __proto__)
  for (const name of ['prototype', 'constructor', '__proto__']) {
    xml = xml.replace(new RegExp(`<${name}([\\s/>])`, 'g'), `<_${name}$1`);
    xml = xml.replace(new RegExp(`</${name}>`, 'g'), `</_${name}>`);
  }
  return xml;
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

// "Tier4" → ["Tier4"], "Tier45" → ["Tier4", "Tier5"]
function parseTierValue(raw: string): string[] {
  const match = raw.match(/^Tier(\d+)$/i);
  if (!match) return [];
  return match[1].split('').map(d => `Tier${d}`);
}

type MapGroupProtoXmlEntry = {
  rawName?: string;
  usages: string[];
  tiers: string[];
  valueUsers?: string[];
  lootmax: number;
  containers: ContainerDef[];
  orderIndex?: number;
};

export function parseMapGroupProtoXml(raw: string): Map<string, MapGroupProtoXmlEntry> {
  const parser = new XMLParser(PROTO_PARSER_OPTIONS);
  const doc = parser.parse(sanitizeReservedTagNames(stripBom(raw)));
  const root = doc?.mapgroupproto ?? doc?.map ?? doc?._prototype ?? {};
  const groups: unknown[] = root?.group ?? [];
  const map = new Map<string, MapGroupProtoXmlEntry>();

  for (let orderIndex = 0; orderIndex < groups.length; orderIndex++) {
    const g = groups[orderIndex];
    const group = g as Record<string, unknown>;
    const rawName = strAttr(group, 'name');
    const name = rawName.toLowerCase();
    if (!name) continue;

    const containerArr = (group.container as Record<string, unknown>[] | undefined) ?? [];

    const containers: ContainerDef[] = containerArr.map(c => {
      const tagArr = (c.tag as Record<string, unknown>[] | undefined) ?? [];
      const catArr = (c.category as Record<string, unknown>[] | undefined) ?? [];
      return {
        name:       strAttr(c, 'name'),
        lootmax:    numAttr(c, 'lootmax'),
        categories: catArr.map(cat => strAttr(cat, 'name')),
        tags:       tagArr.map(t => strAttr(t, 'name')),
      };
    });

    const groupUsageArr = toObjectArray(group.usage);
    const groupUsages = groupUsageArr.map(u => strAttr(u, 'name')).filter(Boolean);
    const containerTags = containers.flatMap(c => c.tags).filter(Boolean);
    // Building usage classification should come only from mapgroupproto tag names
    // (e.g. military/civilian/industrial), not container categories.
    const usages = uniqueCaseInsensitive(containerTags.length > 0 ? containerTags : groupUsages);

    const valueArr = toObjectArray(group.value);
    const valueUsers = valueArr
      .map(v => (IS_COMPAT_MODE ? strAttrs(v, ['user', 'name']) : strAttr(v, 'name')))
      .filter(Boolean);
    const tiers = [...new Set(valueUsers.flatMap(parseTierValue))];

    map.set(name, { rawName, usages, tiers, valueUsers, lootmax: numAttr(group, 'lootmax'), containers, orderIndex });
  }
  return map;
}

export function parseMapGroupPosXml(raw: string): { name: string; x: number; z: number }[] {
  const parser = new XMLParser(POS_PARSER_OPTIONS);
  const doc = parser.parse(sanitizeReservedTagNames(stripBom(raw)));
  // Root element is <map> or <mapgrouppos> depending on the source
  const root = doc?.map ?? doc?.mapgrouppos ?? {};
  const groups: unknown[] = root?.group ?? [];
  return groups.flatMap(g => {
    const group = g as Record<string, unknown>;
    const name = strAttr(group, 'name');
    if (!name) return [];
    const posStr = strAttr(group, 'pos');
    const parts = posStr.trim().split(/\s+/);
    return [{ name, x: num(parts[0]), z: num(parts[2]) }];
  });
}

export function joinMapGroups(
  proto: Map<string, MapGroupProtoXmlEntry>,
  positions: { name: string; x: number; z: number }[],
): BuildingInstance[] {
  return positions.map(p => {
    const entry = proto.get(p.name.toLowerCase());
    return {
      typeName:   p.name,
      usages:     entry?.usages ?? [],
      tiers:      entry?.tiers ?? [],
      lootmax:    entry?.lootmax ?? 0,
      containers: entry?.containers ?? [],
      x: p.x,
      z: p.z,
    };
  });
}

function tiersToValueUsers(tiers: string[]): string[] {
  const nums = [...new Set(
    tiers
      .map(t => Number.parseInt(t.replace('Tier', ''), 10))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 9)
      .sort((a, b) => a - b)
  )];
  if (nums.length === 0) return [];
  return nums.map(n => `Tier${n}`);
}

export function serializeMapGroupProtoXml(
  proto: Map<string, MapGroupProtoXmlEntry>,
): string {
  const groups = [...proto.entries()]
    .sort(([, a], [, b]) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map(([name, entry]) => ({
      '@_name': entry.rawName ?? name,
      '@_lootmax': String(entry.lootmax),
      ...(entry.containers.length ? {
        container: entry.containers.map(c => ({
          '@_name': c.name,
          '@_lootmax': String(c.lootmax),
          ...(c.categories.length ? { category: c.categories.map(cat => ({ '@_name': cat })) } : {}),
          ...(c.tags.length ? { tag: c.tags.map(tag => ({ '@_name': tag })) } : {}),
        })),
      } : {}),
      ...((entry.valueUsers?.length ?? 0) > 0
        ? {
          value: entry.valueUsers!.map(user => (
            IS_COMPAT_MODE ? { '@_user': user } : { '@_name': user }
          )),
        }
        : (entry.tiers.length ? {
          value: tiersToValueUsers(entry.tiers).map(user => (
            IS_COMPAT_MODE ? { '@_user': user } : { '@_name': user }
          )),
        } : {})),
    }));

  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ mapgroupproto: { group: groups } });
}

// ─── cfgplayerspawnpoints.xml ────────────────────────────────────────────────

import type { PlayerSpawnData, PlayerSpawnSection } from '../types/dayz';

const PLAYER_SPAWN_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'pos',
};

export function parsePlayerSpawnPointsXml(raw: string): PlayerSpawnData {
  const parser = new XMLParser(PLAYER_SPAWN_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const root = doc?.playerspawnpoints ?? {};
  const sections: PlayerSpawnSection[] = [];

  for (const [sectionType, sectionRaw] of Object.entries(root)) {
    if (sectionType.startsWith('@_') || typeof sectionRaw !== 'object' || !sectionRaw) continue;
    const s = sectionRaw as Record<string, unknown>;
    const sp = (s.spawn_params as Record<string, unknown>) ?? {};
    const gp = (s.generator_params as Record<string, unknown>) ?? {};
    const bubbles = s.generator_posbubbles as Record<string, unknown> | undefined;
    const posArr = (bubbles?.pos as Record<string, unknown>[]) ?? [];

    sections.push({
      type: sectionType,
      points: posArr.map(p => ({ x: num(p['@_x']), z: num(p['@_z']) })),
      minDistInfected: num(sp.min_dist_infected),
      maxDistInfected: num(sp.max_dist_infected),
      minDistPlayer:   num(sp.min_dist_player),
      maxDistPlayer:   num(sp.max_dist_player),
      gridDensity:     num(gp.grid_density),
      gridWidth:       num(gp.grid_width),
      gridHeight:      num(gp.grid_height),
    });
  }
  return { sections };
}

// ─── cfgeconomycore.xml ───────────────────────────────────────────────────────

const CE_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'ce' || name === 'file',
};

export function parseEconomyCoreXml(raw: string): CeEntry[] {
  const parser = new XMLParser(CE_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const entries: unknown[] = doc?.economycore?.ce ?? [];
  return entries.map(e => {
    const entry = e as Record<string, unknown>;
    const files = ((entry.file as Record<string, unknown>[]) ?? []).map(f => ({
      name: strAttr(f, 'name'),
      type: strAttr(f, 'type'),
    }));
    return { folder: strAttr(entry, 'folder'), files };
  });
}

export function serializeEconomyCoreXml(entries: CeEntry[]): string {
  const ceList = entries.map(e => ({
    '@_folder': e.folder,
    file: e.files.map(f => ({ '@_name': f.name, '@_type': f.type })),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ economycore: { ce: ceList } });
}

// ─── cfgweather.xml ───────────────────────────────────────────────────────────

function parseWeatherValue(obj: Record<string, unknown>): WeatherValue {
  const current = obj.current as Record<string, unknown> | undefined;
  const limits = obj.limits as Record<string, unknown> | undefined;
  const timelimits = obj.timelimits as Record<string, unknown> | undefined;
  const changelimits = obj.changelimits as Record<string, unknown> | undefined;
  const thresholds = obj.thresholds as Record<string, unknown> | undefined;

  return {
    current: {
      actual: num(current?.['@_actual'], 0),
      time: num(current?.['@_time'], 0),
      duration: num(current?.['@_duration'], 0),
      rawActual: String(current?.['@_actual'] ?? ''),
    },
    limits: {
      min: num(limits?.['@_min'], 0),
      max: num(limits?.['@_max'], 0),
      rawMin: String(limits?.['@_min'] ?? ''),
      rawMax: String(limits?.['@_max'] ?? ''),
    },
    ...(timelimits ? {
      timelimits: {
        min: num(timelimits['@_min'], 0),
        max: num(timelimits['@_max'], 0),
      },
    } : {}),
    ...(changelimits ? {
      changelimits: {
        min: num(changelimits['@_min'], 0),
        max: num(changelimits['@_max'], 0),
        rawMin: String(changelimits['@_min'] ?? ''),
        rawMax: String(changelimits['@_max'] ?? ''),
      },
    } : {}),
    ...(thresholds ? {
      thresholds: {
        min: num(thresholds['@_min'], 0),
        max: num(thresholds['@_max'], 0),
        end: num(thresholds['@_end'], 0),
      },
    } : {}),
  };
}

export function parseWeatherXml(raw: string): WeatherData {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const root = doc?.weather ?? {};

  return {
    reset: num(root['@_reset'], 1),
    enable: num(root['@_enable'], 1),
    overcast: parseWeatherValue(root.overcast as Record<string, unknown> ?? {}),
    fog: parseWeatherValue(root.fog as Record<string, unknown> ?? {}),
    rain: parseWeatherValue(root.rain as Record<string, unknown> ?? {}),
    windMagnitude: parseWeatherValue(root.windMagnitude as Record<string, unknown> ?? {}),
    windDirection: parseWeatherValue(root.windDirection as Record<string, unknown> ?? {}),
    snowfall: parseWeatherValue(root.snowfall as Record<string, unknown> ?? {}),
    storm: {
      density: num((root.storm as Record<string, unknown>)?.['@_density'], 0),
      threshold: num((root.storm as Record<string, unknown>)?.['@_threshold'], 1),
      timeout: num((root.storm as Record<string, unknown>)?.['@_timeout'], 60),
      rawDensity: String((root.storm as Record<string, unknown>)?.['@_density'] ?? ''),
      rawThreshold: String((root.storm as Record<string, unknown>)?.['@_threshold'] ?? ''),
    },
    rawData: root,
  };
}

function serializeWeatherValue(value: WeatherValue, includeTimelimits: boolean, includeThresholds: boolean): Record<string, unknown> {
  return {
    current: {
      '@_actual': value.current.rawActual?.trim() || String(value.current.actual),
      '@_time': String(value.current.time),
      '@_duration': String(value.current.duration),
    },
    limits: {
      '@_min': value.limits.rawMin?.trim() || String(value.limits.min),
      '@_max': value.limits.rawMax?.trim() || String(value.limits.max),
    },
    ...(includeTimelimits && value.timelimits ? {
      timelimits: {
        '@_min': String(value.timelimits.min),
        '@_max': String(value.timelimits.max),
      },
    } : {}),
    ...(value.changelimits ? {
      changelimits: {
        '@_min': value.changelimits.rawMin?.trim() || String(value.changelimits.min),
        '@_max': value.changelimits.rawMax?.trim() || String(value.changelimits.max),
      },
    } : {}),
    ...(includeThresholds && value.thresholds ? {
      thresholds: {
        '@_min': String(value.thresholds.min),
        '@_max': String(value.thresholds.max),
        '@_end': String(value.thresholds.end),
      },
    } : {}),
  };
}

export function serializeWeatherXml(weather: WeatherData): string {
  const root = weather.rawData
    ? JSON.parse(JSON.stringify(weather.rawData)) as Record<string, unknown>
    : {};
  root['@_reset'] = String(weather.reset);
  root['@_enable'] = String(weather.enable);
  root.overcast = serializeWeatherValue(weather.overcast, true, false);
  root.fog = serializeWeatherValue(weather.fog, true, false);
  root.rain = serializeWeatherValue(weather.rain, true, true);
  root.windMagnitude = serializeWeatherValue(weather.windMagnitude, true, false);
  root.windDirection = serializeWeatherValue(weather.windDirection, true, false);
  root.snowfall = serializeWeatherValue(weather.snowfall, true, true);
  root.storm = {
    '@_density': weather.storm.rawDensity?.trim() || String(weather.storm.density),
    '@_threshold': weather.storm.rawThreshold?.trim() || String(weather.storm.threshold),
    '@_timeout': String(weather.storm.timeout),
  };
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
    `<!-- Default Namalsk weather init, do not change if you are using the event system -->\n` +
    builder.build({ weather: root });
}

// ─── cfggameplay.json ─────────────────────────────────────────────────────────

export function parseGameplayJson(raw: string): GameplayData {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const playerData = data.PlayerData as Record<string, unknown> | undefined;
  const worldsData = data.WorldsData as Record<string, unknown> | undefined;

  return {
    version: num(data.version, 1),
    PlayerData: playerData ? {
      ShockHandlingData: playerData.ShockHandlingData ? {
        shockRefillSpeedUnconscious: num((playerData.ShockHandlingData as Record<string, unknown>).shockRefillSpeedUnconscious, 3),
        rawValue: JSON.stringify(playerData.ShockHandlingData),
      } : undefined,
      StaminaData: playerData.StaminaData ? {
        sprintStaminaModifierErc: num((playerData.StaminaData as Record<string, unknown>).sprintStaminaModifierErc, 0),
        sprintStaminaModifierCro: num((playerData.StaminaData as Record<string, unknown>).sprintStaminaModifierCro, 0),
        staminaWeightLimitThreshold: num((playerData.StaminaData as Record<string, unknown>).staminaWeightLimitThreshold, 999999),
        staminaMax: num((playerData.StaminaData as Record<string, unknown>).staminaMax, 150),
        staminaKgToStaminaPercentPenalty: num((playerData.StaminaData as Record<string, unknown>).staminaKgToStaminaPercentPenalty, 0),
        staminaMinCap: num((playerData.StaminaData as Record<string, unknown>).staminaMinCap, 5),
        sprintSwimmingStaminaModifier: num((playerData.StaminaData as Record<string, unknown>).sprintSwimmingStaminaModifier, 0),
        sprintLadderStaminaModifier: num((playerData.StaminaData as Record<string, unknown>).sprintLadderStaminaModifier, 0),
        meleeStaminaModifier: num((playerData.StaminaData as Record<string, unknown>).meleeStaminaModifier, 1),
        obstacleTraversalStaminaModifier: num((playerData.StaminaData as Record<string, unknown>).obstacleTraversalStaminaModifier, 0),
        holdBreathStaminaModifier: num((playerData.StaminaData as Record<string, unknown>).holdBreathStaminaModifier, 1),
        rawValues: { ...playerData.StaminaData as Record<string, string> },
      } : undefined,
    } : undefined,
    WorldsData: worldsData ? {
      environmentMinTemps: worldsData.environmentMinTemps ? (worldsData.environmentMinTemps as number[]) : undefined,
      environmentMaxTemps: worldsData.environmentMaxTemps ? (worldsData.environmentMaxTemps as number[]) : undefined,
      rawMinTemps: JSON.stringify(worldsData.environmentMinTemps),
      rawMaxTemps: JSON.stringify(worldsData.environmentMaxTemps),
    } : undefined,
    rawData: data,
  };
}

export function serializeGameplayJson(gameplay: GameplayData): string {
  const result: Record<string, unknown> = gameplay.rawData
    ? JSON.parse(JSON.stringify(gameplay.rawData)) as Record<string, unknown>
    : {};

  result.version = gameplay.version;

  if (gameplay.PlayerData) {
    const existingPlayerData = (result.PlayerData as Record<string, unknown> | undefined) ?? {};
    result.PlayerData = { ...existingPlayerData };
    const pd = result.PlayerData as Record<string, unknown>;

    if (gameplay.PlayerData.ShockHandlingData) {
      const existingShock = (pd.ShockHandlingData as Record<string, unknown> | undefined) ?? {};
      let parsedRawShock: Record<string, unknown> = {};
      if (gameplay.PlayerData.ShockHandlingData.rawValue) {
        try {
          parsedRawShock = JSON.parse(gameplay.PlayerData.ShockHandlingData.rawValue) as Record<string, unknown>;
        } catch {
          parsedRawShock = {};
        }
      }
      pd.ShockHandlingData = {
        ...existingShock,
        ...parsedRawShock,
        shockRefillSpeedUnconscious: gameplay.PlayerData.ShockHandlingData.shockRefillSpeedUnconscious,
      };
    }

    if (gameplay.PlayerData.StaminaData) {
      const sd = gameplay.PlayerData.StaminaData;
      const existingStamina = (pd.StaminaData as Record<string, unknown> | undefined) ?? {};
      pd.StaminaData = {
        ...existingStamina,
        sprintStaminaModifierErc: sd.sprintStaminaModifierErc,
        sprintStaminaModifierCro: sd.sprintStaminaModifierCro,
        staminaWeightLimitThreshold: sd.staminaWeightLimitThreshold,
        staminaMax: sd.staminaMax,
        staminaKgToStaminaPercentPenalty: sd.staminaKgToStaminaPercentPenalty,
        staminaMinCap: sd.staminaMinCap,
        sprintSwimmingStaminaModifier: sd.sprintSwimmingStaminaModifier,
        sprintLadderStaminaModifier: sd.sprintLadderStaminaModifier,
        meleeStaminaModifier: sd.meleeStaminaModifier,
        obstacleTraversalStaminaModifier: sd.obstacleTraversalStaminaModifier,
        holdBreathStaminaModifier: sd.holdBreathStaminaModifier,
      };
    }
  }

  if (gameplay.WorldsData) {
    const existingWorldsData = (result.WorldsData as Record<string, unknown> | undefined) ?? {};
    result.WorldsData = {
      ...existingWorldsData,
      ...(gameplay.WorldsData.environmentMinTemps ? { environmentMinTemps: gameplay.WorldsData.environmentMinTemps } : {}),
      ...(gameplay.WorldsData.environmentMaxTemps ? { environmentMaxTemps: gameplay.WorldsData.environmentMaxTemps } : {}),
    };
  }

  return JSON.stringify(result, null, '\t');
}
