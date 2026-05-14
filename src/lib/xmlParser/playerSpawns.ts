import { XMLParser } from 'fast-xml-parser';
import type { PlayerSpawnData, PlayerSpawnSection } from '../../types/dayz';
import { PARSER_OPTIONS, stripBom, num } from './shared';

const PLAYER_SPAWN_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'pos',
};

export function parsePlayerSpawnPointsXml(raw: string): PlayerSpawnData {
  const parser = new XMLParser(PLAYER_SPAWN_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const root = doc?.playerspawnpoints ?? {};
  const sections: PlayerSpawnSection[] = [];

  for (const [sectionType, sectionRaw] of Object.entries(root)) {
    if (sectionType.startsWith('@_') || typeof sectionRaw !== 'object' || !sectionRaw) continue;
    const s = sectionRaw as Record<string, unknown>;
    const sp = (s.spawn_params     as Record<string, unknown>) ?? {};
    const gp = (s.generator_params as Record<string, unknown>) ?? {};
    const bubbles = s.generator_posbubbles as Record<string, unknown> | undefined;
    const posArr  = (bubbles?.pos as Record<string, unknown>[]) ?? [];

    sections.push({
      type:            sectionType,
      points:          posArr.map(p => ({ x: num(p['@_x']), z: num(p['@_z']) })),
      minDistInfected: num(sp.min_dist_infected),
      maxDistInfected: num(sp.max_dist_infected),
      minDistPlayer:   num(sp.min_dist_player),
      maxDistPlayer:   num(sp.max_dist_player),
      gridDensity:     num(gp.grid_density),
      gridWidth:       num(gp.grid_width),
      gridHeight:      num(gp.grid_height),
    });
  }
  return { sections };
}
