export type CeMode = 'official' | 'compat';

function normalizeMode(raw: unknown): CeMode {
  return String(raw ?? '').trim().toLowerCase() === 'compat' ? 'compat' : 'official';
}

export const CE_MODE: CeMode = normalizeMode(import.meta.env.VITE_CE_MODE);
export const IS_COMPAT_MODE = CE_MODE === 'compat';
