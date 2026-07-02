import { useMemo, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { NumberInput } from '../shared/NumberInput';
import type { DayZType } from '../../types/dayz';
import { TIER_COLORS, getUsageColor, getUsageTextColor, formatUsageLabel } from '../../types/map';
import { CATEGORY_LABELS, CATEGORY_OPTIONS, displayCategory, buildAttachmentNames } from '../../lib/itemClassifier';

const TIER_OPTIONS = ['Tier1', 'Tier2', 'Tier3', 'Tier4', 'Tier5', 'Tier6', 'Tier7'];

type SortColumn = 'name' | 'category' | 'tiers' | 'usages' | 'min' | 'nominal';
type SortDirection = 'asc' | 'desc';

type WorkerQuery = {
  typeFilter: string;
  tierFilter: string;
  usageFilter: string;
  sourceFilter: string;
  categoryFilter: string;
  showInactive: boolean;
  sortCol: SortColumn;
  sortDir: SortDirection;
};

type WorkerResult = {
  type: 'result';
  requestId: number;
  names: string[];
  durationMs: number;
};

function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLORS[tier];
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {tier.replace('Tier', 'T')}
    </span>
  );
}

function UsageBadge({ usage }: { usage: string }) {
  const color = getUsageColor(usage);
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {formatUsageLabel(usage)}
    </span>
  );
}

function TypeRow({
  type,
  resolvedCategory,
  isSelected,
  onSelect,
  onUpdate,
}: {
  type: DayZType;
  resolvedCategory: string;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<DayZType>) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-sm border-b border-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors ${
        isSelected ? 'bg-lime-950/40 border-l-2 border-l-lime-500' : ''
      }`}
      onClick={onSelect}
    >
      <span className="w-52 text-slate-300 truncate font-mono text-xs">{type.name}</span>

      <span className="w-24 text-slate-500 text-xs truncate">
        {CATEGORY_LABELS[resolvedCategory] ?? type.category ?? '—'}
      </span>

      <div className="flex gap-1 w-32">
        {type.tiers.map(t => <TierBadge key={t} tier={t} />)}
      </div>

      <div className="flex flex-wrap gap-1 w-40">
        {type.usages.map(u => <UsageBadge key={u} usage={u} />)}
      </div>

      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <span className="text-xs text-slate-500 w-8 text-right">min</span>
        <NumberInput value={type.min} onChange={v => onUpdate({ min: v })} min={0} />
        <span className="text-xs text-slate-500 w-12 text-right">nominal</span>
        <NumberInput value={type.nominal} onChange={v => onUpdate({ nominal: v })} min={0} />
      </div>

      <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={type.flags.count_in_map === 1}
            onChange={e => onUpdate({ flags: { ...type.flags, count_in_map: e.target.checked ? 1 : 0 } })}
            className="accent-lime-500"
          />
          Map
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={type.flags.deloot === 1}
            onChange={e => onUpdate({ flags: { ...type.flags, deloot: e.target.checked ? 1 : 0 } })}
            className="accent-lime-500"
          />
          Deloot
        </label>
      </div>
    </div>
  );
}

const FLAG_TOOLTIPS: Record<string, string> = {
  count_in_map: 'Count this item toward the map\'s total loot count',
  count_in_hoarder: 'Count this item when calculating hoarder limits',
  count_in_cargo: 'Count this item when it is stored inside a container',
  count_in_player: 'Count this item when carried by a player',
  crafted: 'Item is craftable — affects how it is counted and tracked',
  deloot: 'Dynamic loot — spawns only in dynamic (infected/event) zones, not static locations',
};

function DetailPanel({
  type,
  onUpdate,
  onClose,
  allUsages,
  attachmentNames,
  categoryOverrides,
  setCategoryOverride,
  clearCategoryOverride,
}: {
  type: DayZType;
  onUpdate: (patch: Partial<DayZType>) => void;
  onClose: () => void;
  allUsages: string[];
  attachmentNames: Set<string>;
  categoryOverrides: Record<string, string>;
  setCategoryOverride: (typeName: string, category: string) => void;
  clearCategoryOverride: (typeName: string) => void;
}) {
  const removeLimitsUsage = useServerStore(s => s.removeLimitsUsage);
  const updateLimitsDefinition = useServerStore(s => s.updateLimitsDefinition);
  const limitsDefinition = useServerStore(s => s.limitsDefinition);
  const setCustomUsageColor = useUiStore(s => s.setCustomUsageColor);
  const removeCustomUsageColor = useUiStore(s => s.removeCustomUsageColor);

  const [addUsageOpen, setAddUsageOpen] = useState(false);
  const [addUsageSearch, setAddUsageSearch] = useState('');
  const [pendingUsageColor, setPendingUsageColor] = useState('#94a3b8');
  const addUsageDropdownRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addUsageOpen) return;
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });
  }, [addUsageOpen]);

  useEffect(() => {
    if (!addUsageOpen) return;
    const handler = (e: MouseEvent) => {
      if (addUsageDropdownRef.current && !addUsageDropdownRef.current.contains(e.target as Node)) {
        setAddUsageOpen(false);
        setAddUsageSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addUsageOpen]);

  useEffect(() => {
    const trimmed = addUsageSearch.trim();
    if (trimmed) setPendingUsageColor(getUsageColor(trimmed));
  }, [addUsageSearch]);

  const toggleTier = (tier: string) => {
    const tiers = type.tiers.includes(tier)
      ? type.tiers.filter(t => t !== tier)
      : [...type.tiers, tier];
    onUpdate({ tiers });
  };

  const removeUsage = (u: string) => onUpdate({ usages: type.usages.filter(x => x !== u) });
  const addUsage = (u: string) => {
    if (u && !type.usages.includes(u)) onUpdate({ usages: [...type.usages, u] });
    setAddUsageOpen(false);
    setAddUsageSearch('');
  };

  const availableUsages = allUsages.filter(u => !type.usages.map(x => x.toLowerCase()).includes(u.toLowerCase()));
  const filteredAvailableUsages = availableUsages.filter(u => u.toLowerCase().includes(addUsageSearch.toLowerCase()));
  const manualOverride = categoryOverrides[type.name.toLowerCase()] ?? '';
  const effectiveCategory = displayCategory(type, attachmentNames, categoryOverrides);

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex flex-col min-w-0 mr-2">
          <span className="font-mono text-sm text-slate-200 truncate">{type.name}</span>
          <span className="text-xs text-slate-500 truncate font-mono">{type.source.split(/[\\/]/).pop()}</span>
        </div>
        <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto p-4 space-y-5 ${addUsageOpen ? 'pb-16' : ''}`}>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2" title="The raw category tag stored in types.xml. Used to group items and control what containers they spawn in">Category</p>
          <input
            type="text"
            value={type.category ?? ''}
            onChange={e => onUpdate({ category: e.target.value || null })}
            placeholder="none"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-lime-500"
          />
          <p className="mt-2 text-[11px] text-slate-500">Derived display: {CATEGORY_LABELS[effectiveCategory] ?? effectiveCategory}</p>
          <div className="mt-2 flex gap-2">
            <select
              value={manualOverride}
              onChange={e => {
                const next = e.target.value;
                if (!next) clearCategoryOverride(type.name);
                else setCategoryOverride(type.name, next);
              }}
              title="Override how this item is grouped in the editor display. Does not affect the XML category tag"
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-lime-500"
            >
              <option value="">Auto mapping</option>
              {CATEGORY_OPTIONS.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</option>
              ))}
            </select>
            {manualOverride && (
              <button
                onClick={() => clearCategoryOverride(type.name)}
                className="px-2 py-1 text-xs rounded border border-slate-700 text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Quantities</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { label: 'Nominal', key: 'nominal' as const, min: 0, tooltip: 'Target number of this item that should exist in the world at any time' },
              { label: 'Min', key: 'min' as const, min: 0, tooltip: 'Minimum count in the world before the server attempts to spawn more' },
              { label: 'Lifetime (s)', key: 'lifetime' as const, min: 0, tooltip: 'How long (seconds) the item persists in the world before despawning' },
              { label: 'Restock (s)', key: 'restock' as const, min: 0, tooltip: 'Delay (seconds) between spawn attempts when below nominal' },
              { label: 'Quant Min', key: 'quantmin' as const, min: -1, tooltip: 'Minimum stack size when spawned. -1 means not used' },
              { label: 'Quant Max', key: 'quantmax' as const, min: -1, tooltip: 'Maximum stack size when spawned. -1 means not used' },
              { label: 'Cost', key: 'cost' as const, min: 0, tooltip: 'Economy cost value used by trader mods' },
            ] as const).map(({ label, key, min, tooltip }) => (
              <div key={key}>
                <label className="text-xs text-slate-500 block mb-1 cursor-help" title={tooltip}>{label}</label>
                <NumberInput value={type[key]} onChange={v => onUpdate({ [key]: v })} min={min} className="w-full" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2" title="Which loot tiers this item belongs to. Tiers control which zones on the map the item can spawn in">
            Tiers {type.tiers.length === 0 && <span className="text-slate-500 normal-case font-normal">(none)</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {TIER_OPTIONS.map(tier => {
              const active = type.tiers.includes(tier);
              const color = TIER_COLORS[tier] ?? '#6b7280';
              return (
                <button
                  key={tier}
                  onClick={() => toggleTier(tier)}
                  className="px-3 py-1 rounded-lg text-xs font-medium border transition-all"
                  style={active
                    ? { backgroundColor: `${color}33`, color, borderColor: `${color}88` }
                    : { backgroundColor: 'transparent', color: '#64748b', borderColor: '#374151' }
                  }
                >
                  {tier}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2" title="Which usage zones this item can spawn in. Matches the zone tags on buildings — leave empty to spawn anywhere">Usage Zones</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {type.usages.length === 0 && <span className="text-xs text-slate-500">none</span>}
            {type.usages.map(u => {
              const bg = getUsageColor(u);
              const fg = getUsageTextColor(bg);
              return (
                <span key={u} className="group flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: bg, color: fg }}>
                  {formatUsageLabel(u)}
                  <button onClick={() => removeUsage(u)} className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity leading-none" title={`Remove ${u} from this item`}>×</button>
                </span>
              );
            })}
          </div>
          <div className="relative" ref={addUsageDropdownRef}>
            <button
              onClick={() => { setAddUsageOpen(v => !v); setAddUsageSearch(''); }}
              className="px-1.5 py-0.5 rounded text-xs font-medium bg-lime-900/50 text-lime-300 hover:bg-lime-900/80 border border-lime-700/50"
            >+ Add</button>
            {addUsageOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg w-48">
                <input
                  autoFocus
                  type="text"
                  value={addUsageSearch}
                  onChange={e => setAddUsageSearch(e.target.value)}
                  placeholder="Search usages…"
                  className="w-full px-2 py-1 text-xs bg-slate-700 border-b border-slate-600 text-slate-200 placeholder-slate-500 focus:outline-none rounded-t"
                />
                {!addUsageSearch.trim() && (
                  <div className="px-2 py-1.5 border-b border-slate-600">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-700/50 rounded px-2 py-1.5">
                      <svg className="w-3 h-3 text-lime-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Type a new name to create a custom usage</span>
                    </div>
                  </div>
                )}
                <div className="max-h-40 overflow-y-auto">
                  {filteredAvailableUsages.map(u => (
                    <div key={u} className="flex items-center group hover:bg-slate-700">
                      <button
                        onClick={() => addUsage(u)}
                        className="flex-1 text-left px-2 py-1.5 text-xs text-slate-200 flex items-center gap-1.5"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getUsageColor(u) }} />
                        {formatUsageLabel(u)}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); removeLimitsUsage(u); removeCustomUsageColor(u); }}
                        className="px-2 py-1.5 opacity-0 group-hover:opacity-40 hover:!opacity-100 text-slate-400 hover:text-rose-400 transition-opacity text-xs leading-none"
                        title={`Delete "${u}" zone`}
                      >×</button>
                    </div>
                  ))}
                  {addUsageSearch.trim() && !availableUsages.some(u => u.toLowerCase() === addUsageSearch.trim().toLowerCase()) && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-slate-600">
                      <input
                        type="color"
                        value={pendingUsageColor}
                        onChange={e => setPendingUsageColor(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent flex-shrink-0"
                        title="Pick color"
                      />
                      <button
                        onClick={() => {
                          const name = addUsageSearch.trim();
                          setCustomUsageColor(name, pendingUsageColor);
                          if (limitsDefinition) updateLimitsDefinition({ ...limitsDefinition, usages: [...limitsDefinition.usages, name] });
                          addUsage(name);
                        }}
                        className="flex-1 text-left text-xs text-lime-300 hover:text-lime-200"
                      >
                        Create "{addUsageSearch.trim()}"
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Flags</p>
          <div className="space-y-2">
            {(Object.keys(type.flags) as (keyof typeof type.flags)[]).map(flag => (
              <label key={flag} className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer" title={FLAG_TOOLTIPS[flag]}>
                <input
                  type="checkbox"
                  checked={type.flags[flag] === 1}
                  onChange={e => onUpdate({ flags: { ...type.flags, [flag]: e.target.checked ? 1 : 0 } })}
                  className="accent-lime-500"
                />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export function TypesEditor({ isActive }: { isActive: boolean }) {
  // Subscribe to the slices this editor uses, not the whole mission, so
  // edits in other tabs don't re-render this (always-mounted) component.
  const types = useServerStore(s => s.mission!.types);
  const spawnableTypes = useServerStore(s => s.mission!.spawnableTypes);
  const updateType = useServerStore(s => s.updateType);
  const undoType = useServerStore(s => s.undoType);
  const typeHistory = useServerStore(s => s.typeHistory);
  const limitsDefinition = useServerStore(s => s.limitsDefinition);
  const typeFilter = useUiStore(s => s.typeFilter);
  const setTypeFilter = useUiStore(s => s.setTypeFilter);
  const categoryFilter = useUiStore(s => s.categoryFilter);
  const setCategoryFilter = useUiStore(s => s.setCategoryFilter);
  const categoryOverrides = useUiStore(s => s.categoryOverrides);
  const setCategoryOverride = useUiStore(s => s.setCategoryOverride);
  const clearCategoryOverride = useUiStore(s => s.clearCategoryOverride);
  const removeLimitsUsage = useServerStore(s => s.removeLimitsUsage);
  const removeCustomUsageColor = useUiStore(s => s.removeCustomUsageColor);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('');
  const [usageFilter, setUsageFilter] = useState('');
  const [usageFilterOpen, setUsageFilterOpen] = useState(false);
  const [usageFilterSearch, setUsageFilterSearch] = useState('');
  const usageFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!usageFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (usageFilterRef.current && !usageFilterRef.current.contains(e.target as Node)) {
        setUsageFilterOpen(false);
        setUsageFilterSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [usageFilterOpen]);

  const [sourceFilter, setSourceFilter] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [sortCol, setSortCol] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [sortedNames, setSortedNames] = useState<string[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [listReady, setListReady] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const requestKeyRef = useRef(new Map<number, string>());
  const resultCacheRef = useRef(new Map<string, string[]>());
  const pendingQueryKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const nextQueryRef = useRef<{ query: WorkerQuery; cacheKey: string } | null>(null);
  const lastSyncedRowsRef = useRef<typeof workerRows | null>(null);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const undoTooltip = useMemo(() => {
    if (typeHistory.length === 0) return '';

    function diffEntry(name: string, prev: DayZType, current: DayZType): string[] {
      const lines: string[] = [];
      const numKeys = ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax', 'cost'] as const;
      for (const k of numKeys) {
        if (prev[k] !== current[k]) lines.push(`    ${k}: ${prev[k]} → ${current[k]}`);
      }
      if (prev.category !== current.category)
        lines.push(`    category: ${prev.category ?? 'none'} → ${current.category ?? 'none'}`);
      const prevTiers = prev.tiers.join(', ') || 'none';
      const curTiers = current.tiers.join(', ') || 'none';
      if (prevTiers !== curTiers) lines.push(`    tiers: ${prevTiers} → ${curTiers}`);
      const prevUsages = prev.usages.join(', ') || 'none';
      const curUsages = current.usages.join(', ') || 'none';
      if (prevUsages !== curUsages) lines.push(`    usages: ${prevUsages} → ${curUsages}`);
      for (const k of Object.keys(prev.flags) as (keyof typeof prev.flags)[]) {
        if (prev.flags[k] !== current.flags[k])
          lines.push(`    ${k.replace(/_/g, ' ')}: ${prev.flags[k] ? 'on' : 'off'} → ${current.flags[k] ? 'on' : 'off'}`);
      }
      return lines.length > 0 ? [`  ${name}`, ...lines] : [`  ${name} (no visible diff)`];
    }

    const SHOW = 3;
    const entries = typeHistory.slice(0, SHOW);
    const lines: string[] = [`Undo history (${typeHistory.length} step${typeHistory.length !== 1 ? 's' : ''}):`];

    // Build a running "current" state per item as we walk back through history.
    // Seed only the few names in the shown entries — cloning the whole types
    // Map here ran on every keystroke just to build a hover tooltip.
    const snapshot = new Map<string, DayZType>();
    for (const { name } of entries) {
      const t = types.get(name);
      if (t) snapshot.set(name, t);
    }
    for (const { name, prev } of entries) {
      const current = snapshot.get(name);
      if (current) lines.push(...diffEntry(name, prev, current));
      else lines.push(`  ${name}`);
      snapshot.set(name, prev);
    }

    if (typeHistory.length > SHOW)
      lines.push(`  … and ${typeHistory.length - SHOW} older step${typeHistory.length - SHOW !== 1 ? 's' : ''}`);

    return lines.join('\n');
  }, [typeHistory, types]);

  function handleSort(col: typeof sortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function sortArrow(col: typeof sortCol) {
    if (col !== sortCol) return <span className="opacity-20">↕</span>;
    return <span>{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const allTypes = useMemo(() => Array.from(types.values()), [types]);
  const attachmentNames = useMemo(() => buildAttachmentNames(spawnableTypes), [spawnableTypes]);

  const allUsages = useMemo(() => {
    const s = new Set<string>();
    limitsDefinition?.usages.forEach(u => s.add(u));
    for (const t of types.values()) t.usages.forEach(u => s.add(u));
    return [...s].sort();
  }, [types, limitsDefinition]);

  const allSources = useMemo(() => {
    const s = new Set(allTypes.map(t => t.source).filter(Boolean));
    return Array.from(s).sort();
  }, [allTypes]);

  const topCategoryOptions = useMemo(
    () => [...CATEGORY_OPTIONS].sort((a, b) => (CATEGORY_LABELS[a] ?? a).localeCompare(CATEGORY_LABELS[b] ?? b)),
    []
  );

  const displayCategoryByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of allTypes) {
      map.set(t.name, displayCategory(t, attachmentNames, categoryOverrides));
    }
    return map;
  }, [allTypes, attachmentNames, categoryOverrides]);

  const workerRows = useMemo(() => {
    return allTypes.map(t => ({
      name: t.name,
      category: t.category ?? '',
      source: t.source,
      tiers: t.tiers,
      usages: t.usages,
      nominal: t.nominal,
      min: t.min,
      resolvedCategory: displayCategoryByName.get(t.name) ?? t.category ?? '__none__',
    }));
  }, [allTypes, displayCategoryByName]);

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/typesFilterWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    lastSyncedRowsRef.current = null;
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const data = event.data;
      if (data.type !== 'result') return;
      if (data.requestId !== requestIdRef.current) return;
      
      const cacheKey = requestKeyRef.current.get(data.requestId);
      if (cacheKey) {
        resultCacheRef.current.set(cacheKey, data.names);
        // Keep cache bounded to avoid unbounded growth.
        if (resultCacheRef.current.size > 40) {
          const firstKey = resultCacheRef.current.keys().next().value;
          if (firstKey) resultCacheRef.current.delete(firstKey);
        }
        
        // Clear pending query tracker
        if (pendingQueryKeyRef.current === cacheKey) {
          pendingQueryKeyRef.current = null;
        }
      }
      
      setSortedNames(data.names);
      
      setIsComputing(false);
      
      // After state updates, check if there's a queued query waiting.
      // Use microtask to let React render first, then process the next request.
      if (nextQueryRef.current) {
        const queued = nextQueryRef.current;
        nextQueryRef.current = null;
        
        queueMicrotask(() => {
          if (!workerRef.current) return;
          if (!isActiveRef.current) return;
          
          requestIdRef.current += 1;
          const nextRequestId = requestIdRef.current;
          requestKeyRef.current.set(nextRequestId, queued.cacheKey);
          pendingQueryKeyRef.current = queued.cacheKey;
          inFlightRef.current = true;
          setIsComputing(true);
          
          workerRef.current!.postMessage({ type: 'compute', requestId: nextRequestId, query: queued.query });
        });
      } else {
        // No queued request, mark as ready for new requests
        inFlightRef.current = false;
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;
    if (!isActive) return;
    if (lastSyncedRowsRef.current === workerRows) return;

    const sync = () => {
      if (!workerRef.current) return;
      lastSyncedRowsRef.current = workerRows;
      resultCacheRef.current.clear();
      requestKeyRef.current.clear();
      pendingQueryKeyRef.current = null;
      nextQueryRef.current = null;
      inFlightRef.current = false;
      workerRef.current.postMessage({ type: 'setData', rows: workerRows });
    };

    // First sync (fresh worker) posts immediately; edits debounce so rapid
    // typing doesn't re-serialize the whole dataset per keystroke.
    if (lastSyncedRowsRef.current === null) {
      sync();
      return;
    }
    const timer = setTimeout(sync, 250);
    return () => clearTimeout(timer);
  }, [workerRows, isActive]);

  useEffect(() => {
    if (!isActive) {
      setListReady(false);
      return;
    }
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      setListReady(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const worker = workerRef.current;
    if (!worker) return;
    const cacheKey = JSON.stringify({
      typeFilter,
      tierFilter,
      usageFilter,
      sourceFilter,
      categoryFilter,
      showInactive,
      sortCol,
      sortDir,
    });
    const cached = resultCacheRef.current.get(cacheKey);
    if (cached) {
      setSortedNames(cached);
      setIsComputing(false);
      return;
    }
    
    const query: WorkerQuery = {
      typeFilter,
      tierFilter,
      usageFilter,
      sourceFilter,
      categoryFilter,
      showInactive,
      sortCol,
      sortDir,
    };
    
    // If a request is already in flight, queue this one for later
    // This prevents worker queue flooding by holding at most 1 queued request
    if (inFlightRef.current) {
      nextQueryRef.current = { query, cacheKey };
      return;
    }
    
    // Skip posting if the same query is already pending
    if (pendingQueryKeyRef.current === cacheKey) {
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    requestKeyRef.current.set(requestId, cacheKey);
    
    // Mark this query as pending and in flight
    pendingQueryKeyRef.current = cacheKey;
    inFlightRef.current = true;
    
    
    setIsComputing(true);
    worker.postMessage({ type: 'compute', requestId, query });
  }, [typeFilter, tierFilter, usageFilter, sourceFilter, categoryFilter, showInactive, sortCol, sortDir, workerRows, isActive]);

  const sorted = useMemo(
    () => sortedNames.map(name => types.get(name)).filter((t): t is DayZType => !!t),
    [sortedNames, types]
  );

  const virtualizer = useVirtualizer({
    count: listReady ? sorted.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 4,
  });

  const selectedType = selectedName ? types.get(selectedName) : null;

  const handleUpdate = useCallback((name: string, patch: Partial<DayZType>) => {
    updateType(name, patch);
  }, [updateType]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex-1 max-w-xs">
            <SearchBar value={typeFilter} onChange={setTypeFilter} placeholder="Search items..." />
          </div>

          <div className="flex gap-1">
            <button
              onClick={() => setTierFilter('')}
              className={`px-2 py-1 rounded text-xs ${!tierFilter ? 'bg-lime-500 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
            >
              All
            </button>
            {TIER_OPTIONS.map(t => (
              <button
                key={t}
                onClick={() => setTierFilter(tierFilter === t ? '' : t)}
                className="px-2 py-1 rounded text-xs font-medium border transition-all"
                style={tierFilter === t
                  ? { backgroundColor: `${TIER_COLORS[t]}33`, color: TIER_COLORS[t], borderColor: `${TIER_COLORS[t]}88` }
                  : { backgroundColor: 'transparent', color: '#64748b', borderColor: 'transparent' }
                }
              >
                {t.replace('Tier', 'T')}
              </button>
            ))}
          </div>

          <div className="relative" ref={usageFilterRef}>
            <button
              onClick={() => { setUsageFilterOpen(v => !v); setUsageFilterSearch(''); }}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500"
            >
              {usageFilter
                ? <><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getUsageColor(usageFilter) }} />{formatUsageLabel(usageFilter)}</>
                : 'All usages'
              }
              <span className="text-slate-500 ml-0.5">▾</span>
            </button>
            {usageFilterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg w-48">
                <input
                  autoFocus
                  type="text"
                  value={usageFilterSearch}
                  onChange={e => setUsageFilterSearch(e.target.value)}
                  placeholder="Search usages…"
                  className="w-full px-2 py-1 text-xs bg-slate-700 border-b border-slate-600 text-slate-200 placeholder-slate-500 focus:outline-none rounded-t"
                />
                <div className="max-h-52 overflow-y-auto">
                  {!usageFilterSearch.trim() && (
                    <button
                      onClick={() => { setUsageFilter(''); setUsageFilterOpen(false); setUsageFilterSearch(''); }}
                      className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-700 ${!usageFilter ? 'text-lime-400' : 'text-slate-400'}`}
                    >All usages</button>
                  )}
                  {allUsages.filter(u => u.toLowerCase().includes(usageFilterSearch.toLowerCase())).map(u => (
                    <div key={u} className="flex items-center group hover:bg-slate-700">
                      <button
                        onClick={() => { setUsageFilter(u); setUsageFilterOpen(false); setUsageFilterSearch(''); }}
                        className="flex-1 text-left px-2 py-1.5 text-xs text-slate-200 flex items-center gap-1.5"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getUsageColor(u) }} />
                        {formatUsageLabel(u)}
                        {usageFilter === u && <span className="ml-auto text-lime-400">✓</span>}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); removeLimitsUsage(u); removeCustomUsageColor(u); if (usageFilter === u) setUsageFilter(''); }}
                        className="px-2 py-1.5 opacity-0 group-hover:opacity-40 hover:!opacity-100 text-slate-400 hover:text-rose-400 transition-opacity text-xs leading-none"
                        title={`Delete "${u}" zone`}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700"
          >
            <option value="">All categories</option>
            {topCategoryOptions.map(cat => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</option>
            ))}
          </select>


          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700"
          >
            <option value="">All files</option>
            {allSources.map(src => (
              <option key={src} value={src}>{src.split(/[\\/]/).pop()}</option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-lime-500" />
            Show inactive
          </label>

          <span className="text-xs text-slate-500">{sorted.length} / {allTypes.length}{isComputing ? ' (updating...)' : ''}{!listReady && isActive ? ' (rendering...)' : ''}</span>

          {typeHistory.length > 0 && (
            <button
              onClick={undoType}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              title={undoTooltip}
            >
              ↩ Undo
            </button>
          )}

        </div>

        <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900 select-none">
          {([
            { col: 'name', label: 'Name', cls: 'w-52' },
            { col: 'category', label: 'Category', cls: 'w-24' },
            { col: 'tiers', label: 'Tiers', cls: 'w-32' },
            { col: 'usages', label: 'Usages', cls: 'w-40' },
          ] as const).map(({ col, label, cls }) => (
            <button
              key={col}
              onClick={() => handleSort(col)}
              className={`${cls} flex items-center gap-1 hover:text-slate-400 transition-colors text-left ${sortCol === col ? 'text-slate-400' : ''}`}
            >
              {label} {sortArrow(col)}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <button onClick={() => handleSort('min')} className={`hover:text-slate-400 transition-colors ${sortCol === 'min' ? 'text-slate-400' : ''}`}>Min {sortArrow('min')}</button>
            <span className="text-slate-500"> / </span>
            <button onClick={() => handleSort('nominal')} className={`hover:text-slate-400 transition-colors ${sortCol === 'nominal' ? 'text-slate-400' : ''}`}>Nominal {sortArrow('nominal')}</button>
          </div>
          <span className="ml-auto">Flags</span>
        </div>

        <div ref={parentRef} className="flex-1 overflow-y-auto">
          {!listReady ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-10 rounded bg-slate-800/60 animate-pulse" />
              ))}
            </div>
          ) : isComputing && sorted.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="h-10 rounded bg-slate-800/70 animate-pulse" />
              ))}
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vi => {
                const t = sorted[vi.index];
                return (
                  <div
                    key={t.name}
                    style={{ position: 'absolute', top: vi.start, width: '100%' }}
                  >
                    <TypeRow
                      type={t}
                      resolvedCategory={displayCategoryByName.get(t.name) ?? t.category ?? '__none__'}
                      isSelected={selectedName === t.name}
                      onSelect={() => setSelectedName(selectedName === t.name ? null : t.name)}
                      onUpdate={patch => handleUpdate(t.name, patch)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedType && (
        <DetailPanel
          type={selectedType}
          onUpdate={patch => handleUpdate(selectedType.name, patch)}
          onClose={() => setSelectedName(null)}
          allUsages={allUsages}
          attachmentNames={attachmentNames}
          categoryOverrides={categoryOverrides}
          setCategoryOverride={setCategoryOverride}
          clearCategoryOverride={clearCategoryOverride}
        />
      )}
    </div>
  );
}
