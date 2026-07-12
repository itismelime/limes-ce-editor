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
