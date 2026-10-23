import { XMLParser } from 'fast-xml-parser';
import { IS_COMPAT_MODE } from '../ceMode';
import type { BuildingInstance, ContainerDef } from '../../types/dayz';
import {
  PARSER_OPTIONS, stripBom,
  num, numAttr, strAttr, strAttrs, toObjectArray, parseTierValue,
  parseOrdered, buildOrdered, tagOf, childrenOf, attrsOf, elementsOf, elem, syncChildren, patchNumAttr,
  type ONode,
} from './shared';

const PROTO_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => ['group', 'usage', 'container', 'category', 'tag', 'value'].includes(name),
};

const POS_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'group',
};

function sanitizeReservedTagNames(xml: string): string {
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
    const group = groups[orderIndex] as Record<string, unknown>;
    const rawName = strAttr(group, 'name');
    const name = rawName.toLowerCase();
    if (!name) continue;

    const containerArr = (group.container as Record<string, unknown>[] | undefined) ?? [];
    const containers: ContainerDef[] = containerArr.map(c => {
      const tagArr = (c.tag      as Record<string, unknown>[] | undefined) ?? [];
      const catArr = (c.category as Record<string, unknown>[] | undefined) ?? [];
      return {
        name:       strAttr(c, 'name'),
        lootmax:    numAttr(c, 'lootmax'),
        categories: catArr.map(cat => strAttr(cat, 'name')),
        tags:       tagArr.map(t   => strAttr(t,   'name')),
      };
    });

    // Group <usage> is what types.xml usages match against; container <tag>s
    // are placement (floor/shelves/ground), not usages.
    const usages = uniqueCaseInsensitive(toObjectArray(group.usage).map(u => strAttr(u, 'name')).filter(Boolean));

    const valueUsers = toObjectArray(group.value)
      .map(v => strAttrs(v, ['user', 'name']))
      .filter(Boolean);
    const tiers = [...new Set(valueUsers.flatMap(parseTierValue))];

    // Case-differing duplicates would silently overwrite (and be dropped on
    // save); keep the collider under its raw-cased key so both serialize.
    const key = map.has(name) ? rawName : name;
    map.set(key, { rawName, usages, tiers, valueUsers, lootmax: numAttr(group, 'lootmax'), containers, orderIndex });
  }
  return map;
}

export function parseMapGroupPosXml(raw: string): { name: string; x: number; z: number }[] {
  const parser = new XMLParser(POS_PARSER_OPTIONS);
  const doc = parser.parse(sanitizeReservedTagNames(stripBom(raw)));
  const root = doc?.map ?? doc?.mapgrouppos ?? {};
  const groups: unknown[] = root?.group ?? [];
  return groups.flatMap(g => {
    const group = g as Record<string, unknown>;
    const name = strAttr(group, 'name');
    if (!name) return [];
    const parts = strAttr(group, 'pos').trim().split(/\s+/);
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
      usages:     entry?.usages     ?? [],
      tiers:      entry?.tiers      ?? [],
      lootmax:    entry?.lootmax    ?? 0,
      containers: entry?.containers ?? [],
      x: p.x,
      z: p.z,
    };
  });
}

/**
 * Patches edited usages / values / lootmax / container categories+tags into the
 * file's current text; everything else (defaults, points, proxies, comments)
 * is written back unchanged.
 */
export function serializeMapGroupProtoXml(proto: Map<string, MapGroupProtoXmlEntry>, original: string): string {
  const doc = parseOrdered(sanitizeReservedTagNames(original));
  const root = doc.find(n => ['_prototype', 'mapgroupproto', 'map'].includes(tagOf(n)));
  if (!root) throw new Error('mapgroupproto.xml on disk has no <prototype> root; refusing to overwrite it');
  const byName = new Map([...proto.values()].map(e => [(e.rawName ?? '').toLowerCase(), e]));
  const nameKey = (n: ONode) => attrsOf(n)['@_name'] ?? '';
  const valueKey = (n: ONode) => attrsOf(n)['@_user'] ?? attrsOf(n)['@_name'] ?? '';

  for (const group of elementsOf(childrenOf(root), 'group')) {
    const entry = byName.get(nameKey(group).toLowerCase());
    if (!entry) continue;
    const kids = childrenOf(group);
    patchNumAttr(group, 'lootmax', entry.lootmax);
    syncChildren(kids, 'usage', entry.usages.map(u => elem('usage', { name: u })), nameKey, ['value', 'container', 'proxy']);
    const values = (entry.valueUsers?.length ? entry.valueUsers : tiersToValueUsers(entry.tiers))
      .map(v => elem('value', IS_COMPAT_MODE ? { user: v } : { name: v }));
    syncChildren(kids, 'value', values, valueKey, ['container', 'proxy']);

    elementsOf(kids, 'container').forEach((cNode, i) => {
      const c = entry.containers[i];
      if (!c || c.name.toLowerCase() !== nameKey(cNode).toLowerCase()) return;
      const cKids = childrenOf(cNode);
      patchNumAttr(cNode, 'lootmax', c.lootmax);
      syncChildren(cKids, 'category', c.categories.map(n => elem('category', { name: n })), nameKey, ['tag', 'point']);
      syncChildren(cKids, 'tag', c.tags.map(n => elem('tag', { name: n })), nameKey, ['point']);
    });
  }
  return buildOrdered(doc).replace(/<(\/?)_(prototype|constructor|__proto__)([\s/>])/g, '<$1$2$3');
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
