import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  DayZType, DayZTypeFlags, DayZEvent, EventSpawnDef,
  SpawnableType, SpawnableCargo, SpawnableAttachments, CeEntry,
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

export function parseSpawnableTypesXml(raw: string): Map<string, SpawnableType> {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const typesList: unknown[] = doc?.spawnabletypes?.type ?? [];
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
