import { useMemo, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import { NumberInput } from '../shared/NumberInput';
import type { DayZType } from '../../types/dayz';
import { TIER_COLORS, getUsageColor } from '../../types/map';
import { readFile, writeFile } from '../../lib/fileDiscovery';
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
      {usage}
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
      className={`flex items-center gap-3 px-4 py-2 text-sm border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/50 transition-colors ${
        isSelected ? 'bg-indigo-950/40 border-l-2 border-l-indigo-500' : ''
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
        <span className="text-xs text-slate-600 w-8 text-right">min</span>
        <NumberInput value={type.min} onChange={v => onUpdate({ min: v })} min={0} />
        <span className="text-xs text-slate-600 w-12 text-right">nominal</span>
        <NumberInput value={type.nominal} onChange={v => onUpdate({ nominal: v })} min={0} />
      </div>

      <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={type.flags.count_in_map === 1}
            onChange={e => onUpdate({ flags: { ...type.flags, count_in_map: e.target.checked ? 1 : 0 } })}
            className="accent-indigo-500"
          />
          Map
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
          <input
            type="checkbox"
            checked={type.flags.deloot === 1}
            onChange={e => onUpdate({ flags: { ...type.flags, deloot: e.target.checked ? 1 : 0 } })}
            className="accent-indigo-500"
          />
          Deloot
        </label>
      </div>
    </div>
  );
}

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
  const toggleTier = (tier: string) => {
    const tiers = type.tiers.includes(tier)
      ? type.tiers.filter(t => t !== tier)
      : [...type.tiers, tier];
    onUpdate({ tiers });
  };

  const removeUsage = (u: string) => onUpdate({ usages: type.usages.filter(x => x !== u) });
  const addUsage = (u: string) => { if (u && !type.usages.includes(u)) onUpdate({ usages: [...type.usages, u] }); };

  const availableUsages = allUsages.filter(u => !type.usages.includes(u));
  const manualOverride = categoryOverrides[type.name.toLowerCase()] ?? '';
  const effectiveCategory = displayCategory(type, attachmentNames, categoryOverrides);

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex flex-col min-w-0 mr-2">
          <span className="font-mono text-sm text-slate-200 truncate">{type.name}</span>
          <span className="text-xs text-slate-600 truncate font-mono">{type.source.split(/[\\/]/).pop()}</span>
        </div>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-400 text-lg leading-none">x</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Category</p>
          <input
            type="text"
            value={type.category ?? ''}
            onChange={e => onUpdate({ category: e.target.value || null })}
            placeholder="none"
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
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
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
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
              { label: 'Nominal', key: 'nominal' as const, min: 0 },
              { label: 'Min', key: 'min' as const, min: 0 },
              { label: 'Lifetime (s)', key: 'lifetime' as const, min: 0 },
              { label: 'Restock (s)', key: 'restock' as const, min: 0 },
              { label: 'Quant Min', key: 'quantmin' as const, min: -1 },
              { label: 'Quant Max', key: 'quantmax' as const, min: -1 },
              { label: 'Cost', key: 'cost' as const, min: 0 },
            ] as const).map(({ label, key, min }) => (
              <div key={key}>
                <label className="text-xs text-slate-500 block mb-1">{label}</label>
                <NumberInput value={type[key]} onChange={v => onUpdate({ [key]: v })} min={min} className="w-full" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Tiers {type.tiers.length === 0 && <span className="text-slate-700 normal-case font-normal">(none)</span>}
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
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Usage Zones</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {type.usages.length === 0 && <span className="text-xs text-slate-700">none</span>}
            {type.usages.map(u => (
              <span key={u} className="flex items-center gap-1 text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                {u}
                <button onClick={() => removeUsage(u)} className="text-slate-600 hover:text-red-400 leading-none">x</button>
              </span>
            ))}
          </div>
          {availableUsages.length > 0 && (
            <select
              defaultValue=""
              onChange={e => { addUsage(e.target.value); e.target.value = ''; }}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-400 focus:outline-none focus:border-indigo-500"
            >
              <option value="" disabled>Add usage...</option>
              {availableUsages.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Flags</p>
          <div className="space-y-2">
            {(Object.keys(type.flags) as (keyof typeof type.flags)[]).map(flag => (
              <label key={flag} className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={type.flags[flag] === 1}
                  onChange={e => onUpdate({ flags: { ...type.flags, [flag]: e.target.checked ? 1 : 0 } })}
                  className="accent-indigo-500"
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

export function TypesEditor() {
  const mission = useServerStore(s => s.mission)!;
  const updateType = useServerStore(s => s.updateType);
  const undoType = useServerStore(s => s.undoType);
  const revertTypesSource = useServerStore(s => s.revertTypesSource);
  const saveTypesSource = useServerStore(s => s.saveTypesSource);
  const dirtyTypesSources = useServerStore(s => s.dirty.typesSources);
  const typeHistory = useServerStore(s => s.typeHistory);
  const typeFilter = useUiStore(s => s.typeFilter);
  const setTypeFilter = useUiStore(s => s.setTypeFilter);
  const activeTab = useUiStore(s => s.activeTab);
  const categoryFilter = useUiStore(s => s.categoryFilter);
  const setCategoryFilter = useUiStore(s => s.setCategoryFilter);
  const categoryOverrides = useUiStore(s => s.categoryOverrides);
  const setCategoryOverride = useUiStore(s => s.setCategoryOverride);
  const clearCategoryOverride = useUiStore(s => s.clearCategoryOverride);
  const importCategoryOverrides = useUiStore(s => s.importCategoryOverrides);
  const clearCategoryOverrides = useUiStore(s => s.clearCategoryOverrides);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('');
  const [usageFilter, setUsageFilter] = useState('');
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

  function handleSort(col: typeof sortCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function sortArrow(col: typeof sortCol) {
    if (col !== sortCol) return <span className="opacity-20">↕</span>;
    return <span>{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const allTypes = useMemo(() => Array.from(mission.types.values()), [mission.types]);
  const attachmentNames = useMemo(() => buildAttachmentNames(mission.spawnableTypes), [mission.spawnableTypes]);

  const allUsages = useMemo(() => {
    const s = new Set<string>();
    for (const t of mission.types.values()) t.usages.forEach(u => s.add(u));
    return [...s].sort();
  }, [mission.types]);

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
          if (useUiStore.getState().activeTab !== 'types') return;
          
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
    if (activeTab !== 'types') return;
    if (lastSyncedRowsRef.current === workerRows) return;

    lastSyncedRowsRef.current = workerRows;
    resultCacheRef.current.clear();
    requestKeyRef.current.clear();
    pendingQueryKeyRef.current = null;
    nextQueryRef.current = null;
    inFlightRef.current = false;
    workerRef.current.postMessage({ type: 'setData', rows: workerRows });
  }, [workerRows, activeTab]);

  useEffect(() => {
    if (activeTab !== 'types') {
      setListReady(false);
      return;
    }
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      setListReady(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'types') return;
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
  }, [typeFilter, tierFilter, usageFilter, sourceFilter, categoryFilter, showInactive, sortCol, sortDir, workerRows, activeTab]);

  const sorted = useMemo(
    () => sortedNames.map(name => mission.types.get(name)).filter((t): t is DayZType => !!t),
    [sortedNames, mission.types]
  );

  const virtualizer = useVirtualizer({
    count: listReady ? sorted.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 4,
  });

  const selectedType = selectedName ? mission.types.get(selectedName) : null;

  const handleUpdate = useCallback((name: string, patch: Partial<DayZType>) => {
    updateType(name, patch);
  }, [updateType]);

  async function handleImportOverrides() {
    const selected = await open({
      multiple: false,
      title: 'Select category override JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const raw = await readFile(selected);
      const parsed = JSON.parse(raw) as { overrides?: Record<string, string> } | Record<string, string>;
      const source = 'overrides' in parsed && parsed.overrides ? parsed.overrides : parsed;
      const allowed = new Set(CATEGORY_OPTIONS);
      const normalized: Record<string, string> = {};
      for (const [name, category] of Object.entries(source)) {
        if (typeof category !== 'string') continue;
        if (!allowed.has(category)) continue;
        normalized[name.toLowerCase()] = category;
      }
      importCategoryOverrides(normalized);
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to import category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleExportOverrides() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Choose folder for override export',
    });
    if (!folder || typeof folder !== 'string') return;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      overrides: categoryOverrides,
    };
    try {
      await writeFile(`${folder}/looteditor-category-overrides.json`, JSON.stringify(payload, null, 2));
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to export category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

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
              className={`px-2 py-1 rounded text-xs ${!tierFilter ? 'bg-slate-600 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
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

          <select
            value={usageFilter}
            onChange={e => setUsageFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700"
          >
            <option value="">All usages</option>
            {allUsages.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

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

          <button
            onClick={handleImportOverrides}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
          >
            Import map
          </button>

          <button
            onClick={handleExportOverrides}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
          >
            Export map
          </button>

          <button
            onClick={clearCategoryOverrides}
            className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700 hover:text-red-400"
            title="Clear all manual category overrides"
          >
            Clear map
          </button>

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
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-indigo-500" />
            Show inactive
          </label>

          <span className="text-xs text-slate-600">{sorted.length} / {allTypes.length}{isComputing ? ' (updating...)' : ''}{!listReady && activeTab === 'types' ? ' (rendering...)' : ''}</span>

          {typeHistory.length > 0 && (
            <button
              onClick={undoType}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
              title={`Undo (${typeHistory.length} step${typeHistory.length !== 1 ? 's' : ''})`}
            >
              ↩ Undo
            </button>
          )}

          {!sourceFilter ? (
            <button
              disabled
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-500 cursor-not-allowed"
            >
              Select a file to save
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {dirtyTypesSources.includes(sourceFilter) && (
                <button
                  onClick={() => revertTypesSource(sourceFilter)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-600 text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
                >
                  Revert
                </button>
              )}
              <SaveButton
                isDirty={dirtyTypesSources.includes(sourceFilter)}
                onSave={() => saveTypesSource(sourceFilter)}
                label={`Save ${sourceFilter.split(/[\\/]/).pop()}`}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50 select-none">
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
            <span className="text-slate-700"> / </span>
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
