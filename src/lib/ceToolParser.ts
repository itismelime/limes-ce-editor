import { XMLParser } from 'fast-xml-parser';
import type { CeToolProject, CeToolLayer, CeToolTerritory, CeToolZone } from '../types/dayz';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
};

function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strAttr(obj: Record<string, unknown>, key: string, fallback = ''): string {
  return String(obj[`@_${key}`] ?? fallback);
}

function numAttr(obj: Record<string, unknown>, key: string, fallback = 0): number {
  return num(obj[`@_${key}`], fallback);
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function basenameWithoutExt(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '');
}

function projectDir(path: string): string {
  const n = path.replace(/\\/g, '/');
  const parts = n.split('/');
  return parts.slice(0, -1).join('/');
}

export function parseCeToolProjectXml(raw: string, sourcePath: string): CeToolProject {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const root = (doc?.['zg-config'] as Record<string, unknown> | undefined) ?? {};
  const global = (root.global as Record<string, unknown> | undefined) ?? {};
  const background = (global.background as Record<string, unknown> | undefined) ?? {};
  const areas = (root.areas as Record<string, unknown> | undefined) ?? {};
  const values = toObjectArray((areas.values as Record<string, unknown> | undefined)?.value)
    .map(v => strAttr(v, 'name'))
    .filter(Boolean);
  const usages = toObjectArray((areas.usages as Record<string, unknown> | undefined)?.usage)
    .map(u => strAttr(u, 'name'))
    .filter(Boolean);

  const layers = toObjectArray((root.layers as Record<string, unknown> | undefined)?.layer)
    .map((layer): CeToolLayer => ({
      name: strAttr(layer, 'name'),
      usageFlags: numAttr(layer, 'usage_flags'),
      valueFlags: numAttr(layer, 'value_flags'),
      visible: numAttr(layer, 'visible') === 1,
      color: numAttr(layer, 'color'),
    }))
    .filter(layer => layer.name.length > 0);

  const tierLayerNames: Partial<Record<string, string>> = {};
  for (const layer of layers) {
    const match = layer.name.match(/(?:valuef(?:lg|ig)[-_ ]?)?tier([1-9])/i);
    if (!match) continue;
    tierLayerNames[`Tier${match[1]}`] = layer.name;
  }

  // Extract usage layer names: match usgFlg_Def-<Name> and usgFlg_Paint-<Name> patterns,
  // validate the captured name is a known usage, then group both variants under one key.
  const usageLayerNames: Partial<Record<string, string[]>> = {};
  for (const layer of layers) {
    const match = layer.name.match(/^usgFlg_(?:Def|Paint)-(.+)$/i);
    if (!match) continue;
    const captured = match[1];
    const canonical = usages.find(u => u.toLowerCase() === captured.toLowerCase());
    if (!canonical) continue;
    if (!usageLayerNames[canonical]) usageLayerNames[canonical] = [];
    usageLayerNames[canonical].push(layer.name);
  }

  const territoryTypes = toObjectArray((root['territory-type-list'] as Record<string, unknown> | undefined)?.['territory-type']);
  const territories: CeToolTerritory[] = territoryTypes.flatMap(tt => {
    const territoryType = strAttr(tt, 'name');
    return toObjectArray(tt.territory).map((territory): CeToolTerritory => ({
      type: territoryType,
      name: strAttr(territory, 'name'),
      visible: numAttr(territory, 'visible') === 1,
      color: numAttr(territory, 'color'),
      zones: toObjectArray(territory.zone).map((zone): CeToolZone => ({
        name: strAttr(zone, 'name'),
        x: numAttr(zone, 'x'),
        z: numAttr(zone, 'z'),
        r: numAttr(zone, 'r'),
        d: numAttr(zone, 'd'),
        smin: numAttr(zone, 'smin'),
        smax: numAttr(zone, 'smax'),
        dmin: numAttr(zone, 'dmin'),
        dmax: numAttr(zone, 'dmax'),
      })),
    }));
  });

  const layerSize = numAttr((global.layer as Record<string, unknown> | undefined) ?? {}, 'size', 4096);
  const worldSize = numAttr((global.world as Record<string, unknown> | undefined) ?? {}, 'size', 0);

  return {
    sourcePath,
    projectName: basenameWithoutExt(sourcePath),
    projectDir: projectDir(sourcePath),
    backgroundFile: strAttr(background, 'file'),
    layerSize,
    worldSize,
    usages,
    values,
    layers,
    tierLayerNames,
    usageLayerNames,
    territories,
  };
}
