import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name: string) => ALWAYS_ARRAY.has(name),
};

const ALWAYS_ARRAY = new Set([
  'type', 'event', 'pos', 'usage', 'tier', 'child',
  'cargo', 'attachments', 'item', 'value',
]);

export const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '    ',
  suppressBooleanAttributes: false,
  // Parser decodes entities, so the builder must re-encode them or
  // & < > in names produce malformed XML on save.
  processEntities: true,
};

export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

export function num(v: unknown, fallback = 0): number {
  const s = String(v ?? '').trim();
  if (s === '') return fallback; // Number('') === 0 would mask the fallback
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function numAttr(obj: Record<string, unknown>, key: string, fallback = 0): number {
  return num(obj[`@_${key}`], fallback);
}

export function strAttr(obj: Record<string, unknown>, key: string, fallback = ''): string {
  return String(obj[`@_${key}`] ?? fallback);
}

export function strAttrs(obj: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = obj[`@_${key}`];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return fallback;
}

export function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

export function collectUnknownKeys(
  obj: Record<string, unknown>,
  known: Set<string>,
  prefix: string,
  out: Set<string>,
) {
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;
    out.add(`${prefix}.${key}`);
  }
}

// "Tier4" → ["Tier4"], "Tier45" → ["Tier4", "Tier5"]
export function parseTierValue(raw: string): string[] {
  const match = raw.match(/^Tier(\d+)$/i);
  if (!match) return [];
  return match[1].split('').map(d => `Tier${d}`);
}

// ── Order-preserving patching ──────────────────────────────────────────────
// Saves re-read the file on disk and patch only the edited fields into it, so
// comments, <defaults>, loot <point>s and anything the editor doesn't model
// survive untouched.

/** fast-xml-parser preserveOrder node: `{ tag: children[], ':@'?: attrs }`. */
export type ONode = Record<string, unknown>;

const ORDERED_PARSER_OPTIONS = {
  ...PARSER_OPTIONS,
  isArray: () => false,
  preserveOrder: true,
  commentPropName: '#comment',
};

const ORDERED_BUILDER_OPTIONS = {
  ...BUILDER_OPTIONS,
  preserveOrder: true,
  commentPropName: '#comment',
  suppressEmptyNode: true,
};

export function parseOrdered(xml: string): ONode[] {
  return new XMLParser(ORDERED_PARSER_OPTIONS).parse(stripBom(xml)) as ONode[];
}

export function buildOrdered(nodes: ONode[]): string {
  return new XMLBuilder(ORDERED_BUILDER_OPTIONS).build(nodes) as string;
}

export const tagOf = (n: ONode): string => Object.keys(n).find(k => k !== ':@') ?? '';
export const childrenOf = (n: ONode): ONode[] => (n[tagOf(n)] as ONode[] | undefined) ?? [];
export function attrsOf(n: ONode): Record<string, string> {
  if (!n[':@']) n[':@'] = {};
  return n[':@'] as Record<string, string>;
}
export const elementsOf = (list: ONode[], tag: string): ONode[] => list.filter(n => tagOf(n) === tag);
export const elem = (tag: string, attrs: Record<string, string>): ONode => ({
  [tag]: [],
  ':@': Object.fromEntries(Object.entries(attrs).map(([k, v]) => [`@_${k}`, v])),
});

/**
 * Make the `tag` children of `list` equal `desired` (compared by `key`). No-op
 * when they already match; otherwise replaces them in place, or inserts before
 * the first `before` sibling (else appends) when there were none. Children
 * failing `managed` (e.g. user="…" references) are never touched.
 */
export function syncChildren(
  list: ONode[], tag: string, desired: ONode[], key: (n: ONode) => string, before: string[] = [],
  managed: (n: ONode) => boolean = () => true,
): void {
  const idx = list.flatMap((n, i) => (tagOf(n) === tag && managed(n) ? [i] : []));
  const cur = idx.map(i => key(list[i]).toLowerCase());
  const want = desired.map(n => key(n).toLowerCase());
  if (cur.length === want.length && cur.every((c, i) => c === want[i])) return;
  let at = idx[0] ?? list.findIndex(n => before.includes(tagOf(n)));
  if (at < 0) at = list.length;
  for (const i of [...idx].reverse()) list.splice(i, 1);
  list.splice(at, 0, ...desired);
}

/** Set a numeric attribute, leaving it absent if it was absent and still equals the parse default. */
export function patchNumAttr(n: ONode, name: string, value: number, parsedDefault = 0): void {
  const a = attrsOf(n);
  const k = `@_${name}`;
  if (a[k] === undefined ? value === parsedDefault : num(a[k], parsedDefault) === value) return;
  a[k] = String(value);
}

/** Text of a simple child element like <nominal>10</nominal>, or undefined. */
export function childText(list: ONode[], tag: string): string | undefined {
  const n = list.find(c => tagOf(c) === tag);
  if (!n) return undefined;
  const t = childrenOf(n).find(c => '#text' in c);
  return t ? String(t['#text']) : '';
}

/** Set a simple child element's numeric text if it changed; insert it (before `before`) if missing. */
export function patchChildNum(list: ONode[], tag: string, value: number, before: string[] = []): void {
  const n = list.find(c => tagOf(c) === tag);
  if (n) {
    const cur = childText(list, tag);
    if (cur !== undefined && cur.trim() !== '' && num(cur, NaN) === value) return;
    n[tag] = [{ '#text': String(value) }];
    return;
  }
  let at = list.findIndex(c => before.includes(tagOf(c)));
  if (at < 0) at = list.length;
  list.splice(at, 0, { [tag]: [{ '#text': String(value) }] });
}

/**
 * Carries `generated` (a full re-serialization from the editor's model) into
 * `original` (the file on disk): elements are matched by tag + name attribute
 * (else by position among same-tag siblings) and take the generated attributes
 * and text, while comments, the XML declaration and elements the model doesn't
 * know about are kept from the original.
 */
export function mergeIntoOriginal(original: string, generated: string): string {
  if (!original.trim()) return generated;
  const orig = parseOrdered(original);
  mergeLists(orig, parseOrdered(generated));
  return buildOrdered(orig);
}

const isElement = (n: ONode) => { const t = tagOf(n); return t !== '#text' && t !== '#comment' && !t.startsWith('?'); };

function keyed(list: ONode[]): string[] {
  const seen = new Map<string, number>();
  return list.map(n => {
    if (!isElement(n)) return '';
    const tag = tagOf(n);
    const name = (n[':@'] as Record<string, string> | undefined)?.['@_name'];
    if (name !== undefined) return `${tag}|${name}`;
    const i = seen.get(tag) ?? 0;
    seen.set(tag, i + 1);
    return `${tag}#${i}`;
  });
}

// Generated attributes win, but an unchanged number keeps the file's spelling ("1.0" stays "1.0").
function keepSpelling(orig: Record<string, string> | undefined, gen: Record<string, string> | undefined) {
  if (!gen) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(gen)) {
    const was = orig?.[k];
    out[k] = was !== undefined && was.trim() !== '' && num(was, NaN) === num(v, NaN) ? was : v;
  }
  return out;
}

function mergeLists(o: ONode[], g: ONode[]): void {
  const gKeys = keyed(g);
  const gByKey = new Map(gKeys.map((k, i) => [k, g[i]] as const).filter(([k]) => k));
  const gTags = new Set(g.filter(isElement).map(tagOf));
  const used = new Set<string>();
  const oKeys = keyed(o);
  for (let i = o.length - 1; i >= 0; i--) {
    const n = o[i];
    if (!isElement(n)) continue;
    const match = gByKey.get(oKeys[i]);
    if (match) {
      used.add(oKeys[i]);
      n[':@'] = keepSpelling(n[':@'] as Record<string, string> | undefined, match[':@'] as Record<string, string> | undefined);
      if (!n[':@']) delete n[':@'];
      mergeLists(childrenOf(n), childrenOf(match));
    } else if (gTags.has(tagOf(n))) {
      o.splice(i, 1); // the model removed it
    }
  }
  // text content
  const gText = g.find(n => tagOf(n) === '#text');
  const oText = o.find(n => tagOf(n) === '#text');
  if (gText && oText) oText['#text'] = gText['#text'];
  else if (gText) o.push(gText);
  // elements the model added: after the last sibling with the same tag, else at the end
  gKeys.forEach((k, i) => {
    if (!k || used.has(k)) return;
    const tag = tagOf(g[i]);
    let at = -1;
    o.forEach((n, j) => { if (tagOf(n) === tag) at = j; });
    o.splice(at < 0 ? o.length : at + 1, 0, g[i]);
  });
}
