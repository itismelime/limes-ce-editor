import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { CeEntry } from '../../types/dayz';
import { PARSER_OPTIONS, BUILDER_OPTIONS, stripBom, strAttr } from './shared';

const CE_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: (name: string) => name === 'ce' || name === 'file',
};

export function parseEconomyCoreXml(raw: string): CeEntry[] {
  const parser = new XMLParser(CE_PARSER_OPTIONS);
  const doc = parser.parse(stripBom(raw));
  const entries: unknown[] = doc?.economycore?.ce ?? [];
  return entries.map(e => {
    const entry = e as Record<string, unknown>;
    const files = ((entry.file as Record<string, unknown>[]) ?? []).map(f => ({
      name: strAttr(f, 'name'),
      type: strAttr(f, 'type'),
    }));
    return { folder: strAttr(entry, 'folder'), files };
  });
}

export function serializeEconomyCoreXml(entries: CeEntry[]): string {
  const ceList = entries.map(e => ({
    '@_folder': e.folder,
    file: e.files.map(f => ({ '@_name': f.name, '@_type': f.type })),
  }));
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    builder.build({ economycore: { ce: ceList } });
}
