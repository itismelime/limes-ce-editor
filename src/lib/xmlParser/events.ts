import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { DayZEvent } from '../../types/dayz';
import {
  PARSER_OPTIONS, BUILDER_OPTIONS, stripBom,
  num, numAttr, strAttr, collectUnknownKeys,
} from './shared';

export function parseEventsXml(raw: string): Map<string, DayZEvent> {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const eventsList: unknown[] = doc?.events?.event ?? [];
  const map = new Map<string, DayZEvent>();

  for (const e of eventsList) {
    const ev = e as Record<string, unknown>;
    const childrenRaw = ev.children as Record<string, unknown> | undefined;
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
          deletable:      numAttr(ev.flags as Record<string, unknown>, 'deletable') as 0 | 1,
          init_random:    numAttr(ev.flags as Record<string, unknown>, 'init_random') as 0 | 1,
          remove_damaged: numAttr(ev.flags as Record<string, unknown>, 'remove_damaged') as 0 | 1,
          sec_spawner:    numAttr(ev.flags as Record<string, unknown>, 'sec_spawner') as 0 | 1,
        },
      } : {}),
      ...(typeof ev.position === 'string' ? { position: ev.position } : {}),
      ...(typeof ev.limit    === 'string' ? { limit:    ev.limit    } : {}),
      ...(typeof ev.secondary === 'string' ? { secondary: ev.secondary } : {}),
      children: childArr.map(c => ({
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
        '@_deletable':      String(e.flags.deletable ?? 0),
        '@_init_random':    String(e.flags.init_random ?? 0),
        '@_remove_damaged': String(e.flags.remove_damaged ?? 0),
        ...(typeof e.flags.sec_spawner === 'number' ? { '@_sec_spawner': String(e.flags.sec_spawner) } : {}),
      },
    } : {}),
    ...(e.position  ? { position:  e.position  } : {}),
    ...(e.limit     ? { limit:     e.limit     } : {}),
    ...(e.secondary ? { secondary: e.secondary } : {}),
    active:   String(e.active),
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
  const knownEventKeys    = new Set(['@_name', 'nominal', 'min', 'max', 'lifetime', 'restock', 'saferadius', 'distanceradius', 'cleanupradius', 'flags', 'position', 'limit', 'secondary', 'active', 'children']);
  const knownFlagsAttrs   = new Set(['@_deletable', '@_init_random', '@_remove_damaged', '@_sec_spawner']);
  const knownChildrenKeys = new Set(['child']);
  const knownChildAttrs   = new Set(['@_type', '@_min', '@_max', '@_lootmin', '@_lootmax']);

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
