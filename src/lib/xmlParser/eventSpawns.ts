import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { EventSpawnDef } from '../../types/dayz';
import {
  PARSER_OPTIONS, BUILDER_OPTIONS, stripBom,
  num, strAttr, toObjectArray, collectUnknownKeys,
} from './shared';

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
        '@_r':    z.rawR?.trim()    || String(z.r),
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
  const knownPosAttrs  = new Set(['@_x', '@_z', '@_a', '@_y', '@_group']);
  const knownZoneAttrs = new Set(['@_smin', '@_smax', '@_dmin', '@_dmax', '@_r']);

  for (const e of events) {
    const ev = e as Record<string, unknown>;
    collectUnknownKeys(ev, knownEventKeys, 'eventposdef.event', unknown);
    for (const p of toObjectArray(ev.pos)) {
      collectUnknownKeys(p, knownPosAttrs, 'eventposdef.event.pos', unknown);
    }
    for (const z of toObjectArray(ev.zone)) {
      collectUnknownKeys(z, knownZoneAttrs, 'eventposdef.event.zone', unknown);
    }
  }

  return [...unknown].sort();
}
