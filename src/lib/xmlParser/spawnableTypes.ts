import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SpawnableType, SpawnableCargo, SpawnableAttachments } from '../../types/dayz';
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
      name:       strAttr(st, 'name'),
      usages:     ((st.usage    as Record<string, unknown>[]) ?? []).map(u  => strAttr(u,  'name')),
      categories: ((st.category as Record<string, unknown>[]) ?? []).map(c  => strAttr(c,  'name')),
      tags:       ((st.tag      as Record<string, unknown>[]) ?? []).map(tg => strAttr(tg, 'name')),
      cargo,
      attachments,
      ...(hoarderRaw ? { hoarder: true } : {}),
      ...(damageRaw ? {
        damage: {
          min:    num(damageRaw['@_min']),
          max:    num(damageRaw['@_max']),
          rawMin: String(damageRaw['@_min'] ?? ''),
          rawMax: String(damageRaw['@_max'] ?? ''),
        },
      } : {}),
      source,
    };
    if (map.has(spawnableType.name)) duplicates?.push(spawnableType.name);
    map.set(spawnableType.name, spawnableType);
  }
  return map;
}

export function serializeSpawnableTypesXml(spawnableTypes: Map<string, SpawnableType>): string {
  const typesList = Array.from(spawnableTypes.values()).map(st => ({
    '@_name': st.name,
    ...(st.usages.length     ? { usage:    st.usages.map(u   => ({ '@_name': u   })) } : {}),
    ...(st.categories.length ? { category: st.categories.map(c => ({ '@_name': c })) } : {}),
    ...(st.tags.length       ? { tag:      st.tags.map(tag   => ({ '@_name': tag })) } : {}),
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
  const knownTypeKeys  = new Set(['@_name', 'usage', 'category', 'tag', 'cargo', 'attachments', 'hoarder', 'damage']);
  const knownBlockKeys = new Set(['@_chance', '@_preset', 'item']);
  const knownItemAttrs = new Set(['@_name', '@_chance']);
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
