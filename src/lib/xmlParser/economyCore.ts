import { XMLParser } from 'fast-xml-parser';
import type { CeEntry } from '../../types/dayz';
import { PARSER_OPTIONS, stripBom, strAttr, parseOrdered, buildOrdered, tagOf, childrenOf, attrsOf, elementsOf, elem, type ONode } from './shared';

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

/** Rewrites only the <ce> list in the file's current text; <classes>, <defaults> and comments are kept. */
export function serializeEconomyCoreXml(entries: CeEntry[], original: string): string {
  const doc = parseOrdered(original);
  const root = doc.find(n => tagOf(n) === 'economycore');
  if (!root) throw new Error('cfgeconomycore.xml on disk has no <economycore> root; refusing to overwrite it');
  const kids = childrenOf(root);
  const folderOf = (n: ONode) => attrsOf(n)['@_folder'] ?? '';
  const wanted = new Set(entries.map(e => e.folder));
  const kept = kids.filter(n => tagOf(n) !== 'ce' || wanted.has(folderOf(n)));
  const have = new Set(elementsOf(kept, 'ce').map(folderOf));
  for (const e of entries) {
    if (have.has(e.folder)) continue;
    kept.push({ ce: e.files.map(f => elem('file', { name: f.name, type: f.type })), ':@': { '@_folder': e.folder } });
  }
  root.economycore = kept;
  return buildOrdered(doc);
}
