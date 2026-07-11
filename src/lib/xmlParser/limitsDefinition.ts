import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { LimitsDefinition, LimitsDefinitionUser } from '../../types/dayz';
import { PARSER_OPTIONS, BUILDER_OPTIONS, stripBom, strAttr, numAttr, toObjectArray } from './shared';

const LIMITS_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => ['category', 'tag', 'usage', 'value', 'user'].includes(name),
};

export function parseLimitsDefinitionXml(raw: string): LimitsDefinition {
  const parser = new XMLParser(LIMITS_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const lists = (doc?.lists ?? {}) as Record<string, unknown>;

  const categoriesContainer = lists.categories as Record<string, unknown> | undefined;
  const tagsContainer = lists.tags as Record<string, unknown> | undefined;
  const usageflagsContainer = lists.usageflags as Record<string, unknown> | undefined;
  const valueflagsContainer = lists.valueflags as Record<string, unknown> | undefined;

  return {
    categories: toObjectArray(categoriesContainer?.category).map(c => strAttr(c, 'name')).filter(Boolean),
    tags:       toObjectArray(tagsContainer?.tag).map(t => strAttr(t, 'name')).filter(Boolean),
    usages:     toObjectArray(usageflagsContainer?.usage).map(u => strAttr(u, 'name')).filter(Boolean),
    values:     toObjectArray(valueflagsContainer?.value).map(v => strAttr(v, 'name')).filter(Boolean),
  };
}

export function serializeLimitsDefinitionXml(data: LimitsDefinition): string {
  const obj = {
    lists: {
      categories: { category: data.categories.map(c => ({ '@_name': c })) },
      tags:        { tag:      data.tags.map(t => ({ '@_name': t })) },
      usageflags:  { usage:    data.usages.map(u => ({ '@_name': u })) },
      valueflags:  { value:    data.values.map(v => ({ '@_name': v })) },
    },
  };
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` + builder.build(obj);
}

export function parseLimitsDefinitionUserXml(raw: string): LimitsDefinitionUser {
  const parser = new XMLParser(LIMITS_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const userLists = (doc?.user_lists ?? {}) as Record<string, unknown>;

  const usageflagsContainer = userLists.usageflags as Record<string, unknown> | undefined;
  const valueflagsContainer = userLists.valueflags as Record<string, unknown> | undefined;

  const usageGroups = toObjectArray(usageflagsContainer?.user)
    .map(u => ({
      name:   strAttr(u, 'name'),
      usages: toObjectArray(u.usage)
        .map(uu => {
          const name = strAttr(uu, 'name');
          const flagsRaw = numAttr(uu, 'flags', -1);
          return { name, ...(flagsRaw >= 0 ? { flags: flagsRaw } : {}) };
        })
        .filter(e => Boolean(e.name)),
    }))
    .filter(g => Boolean(g.name));

  const valueGroups = toObjectArray(valueflagsContainer?.user)
    .map(u => ({
      name:   strAttr(u, 'name'),
      values: toObjectArray(u.value).map(vv => strAttr(vv, 'name')).filter(Boolean),
    }))
    .filter(g => Boolean(g.name));

  return { usageGroups, valueGroups };
}

export function serializeLimitsDefinitionUserXml(data: LimitsDefinitionUser): string {
  const obj = {
    user_lists: {
      usageflags: {
        user: data.usageGroups.map(g => ({
          '@_name': g.name,
          usage: g.usages.map(u => ({
            '@_name': u.name,
            ...(u.flags !== undefined ? { '@_flags': u.flags } : {}),
          })),
        })),
      },
      valueflags: {
        user: data.valueGroups.map(g => ({
          '@_name': g.name,
          value: g.values.map(v => ({ '@_name': v })),
        })),
      },
    },
  };
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` + builder.build(obj);
}
