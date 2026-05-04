import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  DayZType, DayZTypeFlags, DayZEvent, EventSpawnDef,
  SpawnableType, SpawnableCargo, SpawnableAttachments, CeEntry,
  ContainerDef,
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

// ─── types.xml ────────────────────────────────────────────────────────────────

export function parseTypesXml(raw: string, source: string): Map<string, DayZType> {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const typesList: unknown[] = doc?.types?.type ?? [];
  const map = new Map<string, DayZType>();

  for (const t of typesList) {
    const item = t as Record<string, unknown>;
    const flagsRaw = (item.flags as Record<string, unknown> | undefined) ?? {};
    const flags: DayZTypeFlags = {
      count_in_cargo:  numAttr(flagsRaw, 'count_in_cargo') as 0 | 1,
      count_in_hoarder: numAttr(flagsRaw, 'count_in_hoarder') as 0 | 1,
      count_in_map:    numAttr(flagsRaw, 'count_in_map') as 0 | 1,
      count_in_player: numAttr(flagsRaw, 'count_in_player') as 0 | 1,
      crafted:         numAttr(flagsRaw, 'crafted') as 0 | 1,
      deloot:          numAttr(flagsRaw, 'deloot') as 0 | 1,
    };
    const categoryRaw = item.category as Record<string, unknown> | undefined;
    const usageArr = (item.usage  as Record<string, unknown>[] | undefined) ?? [];
    const valueArr = (item.value  as Record<string, unknown>[] | undefined) ?? [];

    const type: DayZType = {
      name:      strAttr(item, 'name'),
      nominal:   num(item.nominal),
      lifetime:  num(item.lifetime),
      restock:   num(item.restock),
      min:       num(item.min),
      quantmin:  num(item.quantmin, -1),
      quantmax:  num(item.quantmax, -1),
      cost:      num(item.cost, 100),
      flags,
      category:  categoryRaw ? strAttr(categoryRaw, 'name') : null,
      usages:    usageArr.map(u => strAttr(u as Record<string, unknown>, 'name')),
      tiers:     valueArr.map(v => strAttr(v as Record<string, unknown>, 'name')),
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
    quantmin: String(t.quantmin),
    quantmax: String(t.quantmax),
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
    ...(t.tiers.length  ? { value: t.tiers.map(ti => ({ '@_name': ti })) } : {}),
  }));

  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ types: { type: typesList } });
}

// ─── cfgeventspawns.xml ───────────────────────────────────────────────────────

export function parseEventSpawnsXml(raw: string): EventSpawnDef[] {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const events: unknown[] = doc?.eventposdef?.event ?? [];

  return events.map(e => {
    const ev = e as Record<string, unknown>;
    const positions = ((ev.pos as Record<string, unknown>[]) ?? []).map(p => ({
      x: num(p['@_x']),
      z: num(p['@_z']),
    }));
    return { eventName: strAttr(ev, 'name'), positions };
  });
}

export function serializeEventSpawnsXml(spawns: EventSpawnDef[]): string {
  const events = spawns.map(s => ({
    '@_name': s.eventName,
    pos: s.positions.map(p => ({
      '@_x': p.x.toFixed(4),
      '@_z': p.z.toFixed(4),
    })),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ eventposdef: { event: events } });
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

export function parseSpawnableTypesXml(raw: string): Map<string, SpawnableType> {
  const parser = new XMLParser(SPAWNABLE_PARSER_OPTIONS);
  const doc = parser.parse(normalizeSpawnableRoot(raw));
  const typesList: unknown[] = doc?.spawnabletypes?.type ?? doc?.cfgspawnabletypes?.type ?? [];
  const map = new Map<string, SpawnableType>();

  for (const t of typesList) {
    const st = t as Record<string, unknown>;
    const cargoArr = (st.cargo as Record<string, unknown>[]) ?? [];
    const attArr   = (st.attachments as Record<string, unknown>[]) ?? [];

    const cargo: SpawnableCargo[] = cargoArr.map(c => ({
      chance: num(c['@_chance'], 1),
      items: ((c.item as Record<string, unknown>[]) ?? []).map(i => ({
        name:   strAttr(i, 'name'),
        chance: numAttr(i as Record<string, unknown>, 'chance'),
      })),
    }));

    const attachments: SpawnableAttachments[] = attArr.map(a => ({
      chance: num(a['@_chance'], 1),
      items: ((a.item as Record<string, unknown>[]) ?? []).map(i => ({
        name:   strAttr(i, 'name'),
        chance: numAttr(i as Record<string, unknown>, 'chance'),
      })),
    }));

    const spawnableType: SpawnableType = {
      name: strAttr(st, 'name'),
      usages:     ((st.usage as Record<string,unknown>[]) ?? []).map(u => strAttr(u, 'name').toLowerCase()),
      categories: ((st.category as Record<string,unknown>[]) ?? []).map(c => strAttr(c, 'name').toLowerCase()),
      tags:       ((st.tag as Record<string,unknown>[]) ?? []).map(tg => strAttr(tg, 'name').toLowerCase()),
      cargo,
      attachments,
    };
    map.set(spawnableType.name, spawnableType);
  }
  return map;
}

export function serializeSpawnableTypesXml(spawnableTypes: Map<string, SpawnableType>): string {
  const typesList = Array.from(spawnableTypes.values()).map(st => ({
    '@_name': st.name,
    ...(st.cargo.length ? {
      cargo: st.cargo.map(c => ({
        '@_chance': c.chance.toFixed(2),
        item: c.items.map(i => ({ '@_name': i.name, '@_chance': i.chance.toFixed(2) })),
      })),
    } : {}),
    ...(st.attachments.length ? {
      attachments: st.attachments.map(a => ({
        '@_chance': a.chance.toFixed(2),
        item: a.items.map(i => ({ '@_name': i.name, '@_chance': i.chance.toFixed(2) })),
      })),
    } : {}),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ spawnabletypes: { type: typesList } });
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

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "Tier4" → ["Tier4"], "Tier45" → ["Tier4", "Tier5"]
function parseTierValue(raw: string): string[] {
  const match = raw.match(/^Tier(\d+)$/i);
  if (!match) return [];
  return match[1].split('').map(d => `Tier${d}`);
}

export function parseMapGroupProtoXml(raw: string): Map<string, { usages: string[]; tiers: string[]; lootmax: number; containers: ContainerDef[] }> {
  const parser = new XMLParser(PROTO_PARSER_OPTIONS);
  const doc = parser.parse(sanitizeReservedTagNames(stripBom(raw)));
  const root = doc?.mapgroupproto ?? doc?.map ?? doc?._prototype ?? {};
  const groups: unknown[] = root?.group ?? [];
  const map = new Map<string, { usages: string[]; tiers: string[]; lootmax: number; containers: ContainerDef[] }>();

  for (const g of groups) {
    const group = g as Record<string, unknown>;
    const name = strAttr(group, 'name').toLowerCase();
    if (!name) continue;

    const containerArr = (group.container as Record<string, unknown>[] | undefined) ?? [];

    const containers: ContainerDef[] = containerArr.map(c => {
      const tagArr = (c.tag as Record<string, unknown>[] | undefined) ?? [];
      const catArr = (c.category as Record<string, unknown>[] | undefined) ?? [];
      return {
        name:       strAttr(c, 'name'),
        lootmax:    numAttr(c, 'lootmax'),
        categories: catArr.map(cat => strAttr(cat, 'name').toLowerCase()),
        tags:       tagArr.map(t => strAttr(t, 'name').toLowerCase()),
      };
    });

    const usages = [...new Set(containers.flatMap(c => c.tags.map(titleCase)))];

    const valueArr = (group.value as Record<string, unknown>[] | undefined) ?? [];
    const tiers = [...new Set(valueArr.flatMap(v => parseTierValue(strAttr(v, 'user'))))];

    map.set(name, { usages, tiers, lootmax: numAttr(group, 'lootmax'), containers });
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
  proto: Map<string, { usages: string[]; tiers: string[]; lootmax: number; containers: ContainerDef[] }>,
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
