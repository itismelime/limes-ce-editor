import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { IS_COMPAT_MODE } from '../ceMode';
import type { BuildingInstance, ContainerDef } from '../../types/dayz';
import {
  PARSER_OPTIONS, BUILDER_OPTIONS, stripBom,
  num, numAttr, strAttr, strAttrs, toObjectArray, parseTierValue,
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

    const groupUsages = toObjectArray(group.usage).map(u => strAttr(u, 'name')).filter(Boolean);
    const containerTags = containers.flatMap(c => c.tags).filter(Boolean);
    // Building usage comes from mapgroupproto tag names, not container categories
    const usages = uniqueCaseInsensitive(containerTags.length > 0 ? containerTags : groupUsages);

    const valueUsers = toObjectArray(group.value)
      .map(v => strAttrs(v, ['user', 'name']))
      .filter(Boolean);
    const tiers = [...new Set(valueUsers.flatMap(parseTierValue))];

    map.set(name, { rawName, usages, tiers, valueUsers, lootmax: numAttr(group, 'lootmax'), containers, orderIndex });
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

export function serializeMapGroupProtoXml(proto: Map<string, MapGroupProtoXmlEntry>): string {
  const groups = [...proto.entries()]
    .sort(([, a], [, b]) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map(([name, entry]) => ({
      '@_name':    entry.rawName ?? name,
      '@_lootmax': String(entry.lootmax),
      ...(entry.containers.length ? {
        container: entry.containers.map(c => ({
          '@_name':    c.name,
          '@_lootmax': String(c.lootmax),
          ...(c.categories.length ? { category: c.categories.map(cat => ({ '@_name': cat })) } : {}),
          ...(c.tags.length       ? { tag:      c.tags.map(tag       => ({ '@_name': tag })) } : {}),
        })),
      } : {}),
      ...((entry.valueUsers?.length ?? 0) > 0
        ? { value: entry.valueUsers!.map(user => (IS_COMPAT_MODE ? { '@_user': user } : { '@_name': user })) }
        : (entry.tiers.length
          ? { value: tiersToValueUsers(entry.tiers).map(user => (IS_COMPAT_MODE ? { '@_user': user } : { '@_name': user })) }
          : {})),
    }));

  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ mapgroupproto: { group: groups } });
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
