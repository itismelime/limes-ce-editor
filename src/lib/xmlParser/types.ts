import { XMLParser } from 'fast-xml-parser';
import { IS_COMPAT_MODE } from '../ceMode';
import type { DayZType, DayZTypeFlags } from '../../types/dayz';
import {
  PARSER_OPTIONS, stripBom,
  num, numAttr, strAttr, strAttrs, toObjectArray, collectUnknownKeys, parseTierValue,
  parseOrdered, buildOrdered, tagOf, childrenOf, attrsOf, elementsOf, elem,
  syncChildren, patchNumAttr, patchChildNum, type ONode,
} from './shared';

export function parseTypesXml(raw: string, source: string, duplicates?: string[]): Map<string, DayZType> {
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
    const parsedTiers = IS_COMPAT_MODE
      ? valueArr.map(v => strAttrs(v, ['name', 'user'])).filter(Boolean).flatMap(parseTierValue)
      : valueArr.map(v => strAttr(v, 'name')).filter(n => TIER_RE.test(n));

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
    if (map.has(type.name)) duplicates?.push(type.name);
    map.set(type.name, type);
  }
  return map;
}

const TIER_RE = /^Tier\d$/i;
const FLAG_KEYS = ['count_in_cargo', 'count_in_hoarder', 'count_in_map', 'count_in_player', 'crafted', 'deloot'] as const;
const nameKey = (n: ONode) => attrsOf(n)['@_name'] ?? '';
const hasName = (n: ONode) => attrsOf(n)['@_name'] !== undefined;

function patchTypeNode(node: ONode, t: DayZType): void {
  const kids = childrenOf(node);
  attrsOf(node)['@_name'] = t.name;
  patchChildNum(kids, 'nominal', t.nominal, ['lifetime']);
  patchChildNum(kids, 'lifetime', t.lifetime, ['restock']);
  patchChildNum(kids, 'restock', t.restock, ['min']);
  patchChildNum(kids, 'min', t.min, ['quantmin', 'quantmax', 'cost']);
  if (t.quantminPresent || t.quantmin !== -1) patchChildNum(kids, 'quantmin', t.quantmin, ['quantmax', 'cost']);
  if (t.quantmaxPresent || t.quantmax !== -1) patchChildNum(kids, 'quantmax', t.quantmax, ['cost']);
  patchChildNum(kids, 'cost', t.cost, ['flags']);
  let flags = elementsOf(kids, 'flags')[0];
  const flagsCreated = !flags;
  if (!flags) {
    flags = elem('flags', {});
    const at = kids.findIndex(c => ['category', 'usage', 'value', 'tag'].includes(tagOf(c)));
    kids.splice(at < 0 ? kids.length : at, 0, flags);
  }
  for (const k of FLAG_KEYS) patchNumAttr(flags, k, t.flags[k], flagsCreated ? -1 : 0);
  syncChildren(kids, 'category', t.category ? [elem('category', { name: t.category })] : [], nameKey, ['usage', 'value', 'tag']);
  syncChildren(kids, 'usage', t.usages.map(u => elem('usage', { name: u })), nameKey, ['value', 'tag'], hasName);
  syncChildren(kids, 'value', t.tiers.map(ti => elem('value', IS_COMPAT_MODE ? { name: ti, user: ti } : { name: ti })),
    nameKey, ['tag'], n => TIER_RE.test(nameKey(n)));
  syncChildren(kids, 'tag', (t.tags ?? []).map(tag => elem('tag', { name: tag })), nameKey);
}

/**
 * Writes `types` (one source file's types) into that file's current text.
 * Types equal to what's on disk are left alone; changed ones are patched field
 * by field; names in `removed` are deleted; new ones appended. Types absent
 * from `types` but not in `removed` (e.g. overridden by a <ce> folder file)
 * are kept as-is.
 */
export function serializeTypesXml(
  types: Map<string, DayZType>, sourcePath: string, original: string, removed: Set<string> = new Set(),
): string {
  const baseline = parseTypesXml(original, sourcePath);
  const doc = original.trim() ? parseOrdered(original) : [{ types: [] }];
  let root = doc.find(n => tagOf(n) === 'types');
  if (!root) {
    if (original.trim()) throw new Error('types file on disk has no <types> root; refusing to overwrite it');
    root = { types: [] };
    doc.push(root);
  }
  const unchanged = (t: DayZType) => {
    const b = baseline?.get(t.name);
    return !!b && JSON.stringify({ ...b, source: '' }) === JSON.stringify({ ...t, source: '' });
  };
  const seen = new Set<string>();
  root.types = childrenOf(root).filter(node => {
    if (tagOf(node) !== 'type') return true;
    const name = nameKey(node);
    const t = types.get(name);
    if (!t) return !removed.has(name);
    seen.add(t.name);
    if (!unchanged(t)) patchTypeNode(node, t);
    return true;
  });
  for (const t of types.values()) {
    if (seen.has(t.name)) continue;
    const node: ONode = { type: [], ':@': { '@_name': t.name } };
    patchTypeNode(node, t);
    (root.types as ONode[]).push(node);
  }
  const xml = buildOrdered(doc);
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
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
