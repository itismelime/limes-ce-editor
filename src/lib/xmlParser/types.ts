import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { IS_COMPAT_MODE } from '../ceMode';
import type { DayZType, DayZTypeFlags } from '../../types/dayz';
import {
  PARSER_OPTIONS, BUILDER_OPTIONS, stripBom,
  num, numAttr, strAttr, strAttrs, toObjectArray, collectUnknownKeys, parseTierValue,
} from './shared';

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
      count_in_cargo:   numAttr(flagsRaw, 'count_in_cargo') as 0 | 1,
      count_in_hoarder: numAttr(flagsRaw, 'count_in_hoarder') as 0 | 1,
      count_in_map:     numAttr(flagsRaw, 'count_in_map') as 0 | 1,
      count_in_player:  numAttr(flagsRaw, 'count_in_player') as 0 | 1,
      crafted:          numAttr(flagsRaw, 'crafted') as 0 | 1,
      deloot:           numAttr(flagsRaw, 'deloot') as 0 | 1,
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
      '@_count_in_cargo':   String(t.flags.count_in_cargo),
      '@_count_in_hoarder': String(t.flags.count_in_hoarder),
      '@_count_in_map':     String(t.flags.count_in_map),
      '@_count_in_player':  String(t.flags.count_in_player),
      '@_crafted':          String(t.flags.crafted),
      '@_deloot':           String(t.flags.deloot),
    },
    ...(t.category ? { category: { '@_name': t.category } } : {}),
    ...(t.usages.length ? { usage: t.usages.map(u => ({ '@_name': u })) } : {}),
    ...(t.tiers.length ? {
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
