import { useMemo, useState, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { NumberInput } from '../shared/NumberInput';
import type { DayZType } from '../../types/dayz';
import { TIER_COLORS, getUsageColor, formatUsageLabel } from '../../types/map';
import { CATEGORY_LABELS, CATEGORY_OPTIONS, displayCategory, buildAttachmentNames } from '../../lib/itemClassifier';
import { SELECTED_ROW_CLASS } from '../shared/ui';
import { TypeDetailPanel } from '../shared/TypeDetailPanel';
import { basename } from '../../lib/fileDiscovery';

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
        isSelected ? SELECTED_ROW_CLASS : ''
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
              <option key={src} value={src}>{basename(src)}</option>
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
        <TypeDetailPanel
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
