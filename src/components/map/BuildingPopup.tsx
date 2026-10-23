import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BuildingInstance, DayZType } from '../../types/dayz';
import { containerAcceptsType } from '../../lib/lootResolver';
import { TIER_COLORS, getUsageColor, getUsageTextColor, formatUsageLabel } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { displayCategory, buildAttachmentNames, CATEGORY_LABELS } from '../../lib/itemClassifier';

interface Props {
  building: BuildingInstance;
  tiers: string[];
  zoneTiers?: string[];
  zoneUsages?: string[];
  protoTiers?: string[];
  inferredTier?: string | null;
  embedded?: boolean;
  onSelectItem?: (typeName: string) => void;
}

const EMPTY_TYPES = new Map<string, DayZType>();

function CategorySection({
  label,
  categoryKey,
  items,
  autoExpand,
  onBlockCategory,
  onOpenAddModal,
  onSelectItem,
}: {
  label: string;
  categoryKey: string;
  items: DayZType[];
  autoExpand?: boolean;
  onBlockCategory: (category: string) => void;
  onOpenAddModal: (category: string) => void;
  onSelectItem?: (typeName: string) => void;
}) {
  const [open, setOpen]         = useState(autoExpand ?? false);
  const [search, setSearch]     = useState('');
  const [sortMode, setSortMode] = useState<'az' | 'nominal' | 'min'>('az');

  const activeCount = items.filter(t => t.nominal > 0).length;
  const filtered = useMemo(() => {
    const next = items.filter(t => {
      if (t.nominal === 0) return false;
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    next.sort((a, b) => {
      if (sortMode === 'nominal') {
        return b.nominal - a.nominal || a.name.localeCompare(b.name);
      }
      if (sortMode === 'min') {
        return b.min - a.min || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

    return next;
  }, [items, search, sortMode]);

  return (
    <div className="mb-2 border border-slate-800 rounded-lg overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left cursor-pointer"
      >
        <span className="text-slate-200 font-semibold text-xs">{label}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-slate-500 text-xs w-[92px] text-right">{activeCount} active / {items.length}</span>
          <span className="text-slate-500 text-xs w-3 text-center">{open ? '▲' : '▼'}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenAddModal(categoryKey);
            }}
            className="w-5 h-5 rounded-md border border-lime-700/70 bg-lime-900/40 text-lime-300 hover:text-lime-200"
            title="Add this category to building type (XML)"
          >
            +
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBlockCategory(categoryKey);
            }}
            className="w-5 h-5 rounded-md border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:text-rose-200 flex items-center justify-center"
            title="Remove this category from building type (XML)"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-800">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter…"
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as 'az' | 'nominal' | 'min')}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300"
              title="Sort items"
            >
              <option value="az">A-Z</option>
              <option value="nominal">Highest nominal</option>
              <option value="min">Highest min</option>
            </select>
          </div>
          <div className="overflow-y-auto max-h-52">
            {filtered.length === 0 ? (
              <p className="text-slate-500 italic text-xs px-3 py-2">No items match</p>
            ) : (
              <>
                <div className="divide-y divide-slate-800/50">
                  {filtered.map(item => (
                    <div
                      key={item.name}
                      className={`flex items-center justify-between gap-2 px-3 py-1 hover:bg-slate-800/30 ${item.nominal === 0 ? 'opacity-40' : ''}`}
                    >
                      <span className="text-slate-300 text-xs truncate flex-1" title={item.name}>{item.name}</span>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 whitespace-nowrap" title="Nominal / Min">
                          N {item.nominal} · M {item.min}
                        </span>
                        {item.tiers.length > 0 && (
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">
                            {item.tiers.map(t => t.replace(/^Tier/i, 'T')).join(', ')}
                          </span>
                        )}
                        {onSelectItem && (
                          <button
                            onClick={() => onSelectItem(item.name)}
                            className="h-5 px-2 rounded-md border border-lime-700/70 bg-lime-900/40 text-lime-300 hover:text-lime-200 text-[10px]"
                            title={`Edit ${item.name}`}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-slate-500 text-xs px-3 py-1">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddLootModal({
  open,
  onClose,
  types,
  categories,
  defaultCategory,
  onAddCategory,
}: {
  open: boolean;
  onClose: () => void;
  types: Map<string, DayZType>;
  categories: string[];
  defaultCategory: string;
  onAddCategory: (category: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const matchedDefault = categories.find(cat => cat.toLowerCase() === defaultCategory.toLowerCase()) ?? defaultCategory;
      setCategoryFilter(matchedDefault);
      setSearch('');
    }
  }

  const filteredItems = useMemo(() => {
    const rows: DayZType[] = [];
    for (const type of types.values()) {
      const categoryKey = type.category ?? '__none__';
      if (categoryFilter && categoryKey.toLowerCase() !== categoryFilter.toLowerCase()) continue;
      if (search && !type.name.toLowerCase().includes(search.toLowerCase())) continue;
      rows.push(type);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows.slice(0, 250);
  }, [types, categoryFilter, search]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-[1px] flex items-center justify-center p-2"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-[310px] max-h-[90%] bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Add Category (XML)</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-2 border-b border-slate-800 space-y-2">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            <option value="">All categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat === '__none__' ? 'Uncategorized' : cat}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search loot types (preview only)..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500"
            />
            {categoryFilter && (
              <button
                onClick={() => onAddCategory(categoryFilter)}
                className="h-8 px-3 rounded-lg bg-lime-900/40 border border-lime-700 text-lime-300 text-xs hover:text-lime-200"
                title="Add whole category to this building type"
              >
                +cat
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {filteredItems.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">No matching loot types.</div>
          ) : (
            filteredItems.map(type => {
              const cat = type.category ?? '__none__';
              return (
                <div key={type.name} className="px-3 py-1.5 border-b border-slate-800/60 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-200 truncate">{type.name}</div>
                    <div className="text-[10px] text-slate-500">{cat === '__none__' ? 'Uncategorized' : cat}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-slate-700 text-[10px] text-slate-500">
          Category operations are exact XML edits. Item-level per-building edits are not native in vanilla CE.
        </div>
      </div>
    </div>,
    document.body
  );
}


export function BuildingPopup({
  building: buildingProp,
  tiers,
  zoneTiers = [],
  zoneUsages = [],
  protoTiers = [],
  inferredTier,
  embedded = false,
  onSelectItem,
}: Props) {
  const types = useServerStore(s => s.mission?.types ?? EMPTY_TYPES);
  const spawnableTypes = useServerStore(s => s.mission?.spawnableTypes);
  const categoryOverrides = useUiStore(s => s.categoryOverrides);
  const categoryFilter  = useUiStore(s => s.categoryFilter);
  const attachmentNames = useMemo(() => buildAttachmentNames(spawnableTypes ?? new Map()), [spawnableTypes]);
  // Read live building from store so category edits are reflected immediately without
  // relying on Leaflet re-opening the popup with updated props.
  const liveBuildingInstances = useServerStore(s => s.buildingInstances);
  const building = useMemo(() => {
    const key = buildingProp.typeName.trim().toLowerCase();
    return liveBuildingInstances.find(b => b.typeName.trim().toLowerCase() === key) ?? buildingProp;
  }, [buildingProp, liveBuildingInstances]);
  const originalMapGroupProto = useServerStore(s => s.originalMapGroupProto);
  const addBuildingCategory = useServerStore(s => s.addBuildingCategory);
  const removeBuildingCategory = useServerStore(s => s.removeBuildingCategory);
  const addBuildingUsage = useServerStore(s => s.addBuildingUsage);
  const removeBuildingUsage = useServerStore(s => s.removeBuildingUsage);
  const limitsDefinition = useServerStore(s => s.limitsDefinition);
  const updateLimitsDefinition = useServerStore(s => s.updateLimitsDefinition);
  const updateType = useServerStore(s => s.updateType);
  const setCustomUsageColor = useUiStore(s => s.setCustomUsageColor);
  const removeCustomUsageColor = useUiStore(s => s.removeCustomUsageColor);
  const removeLimitsUsage = useServerStore(s => s.removeLimitsUsage);
  const addContainerTag = useServerStore(s => s.addContainerTag);
  const removeContainerTag = useServerStore(s => s.removeContainerTag);
  const addContainerCategory = useServerStore(s => s.addContainerCategory);
  const removeContainerCategory = useServerStore(s => s.removeContainerCategory);
  const updateContainerLootmax = useServerStore(s => s.updateContainerLootmax);
  const [containersOpen, setContainersOpen] = useState(false);
  const [zoneFilterActive, setZoneFilterActive] = useState(true);
  const [tagSearch, setTagSearch] = useState('');
  const [tagSearchOpen, setTagSearchOpen] = useState(false);
  const [addingUsageForItem, setAddingUsageForItem] = useState<string | null>(null);
  const [containerTagInputs, setContainerTagInputs] = useState<Record<string, string>>({});
  const [containerCatInputs, setContainerCatInputs] = useState<Record<string, string>>({});
  const [containerLootmaxDrafts, setContainerLootmaxDrafts] = useState<Record<string, string>>({});
  const [usageDropdownOpen, setUsageDropdownOpen] = useState(false);
  const [usageSearch, setUsageSearch] = useState('');
  const [pendingUsageColor, setPendingUsageColor] = useState('#94a3b8');
  const usageDropdownRef = useRef<HTMLDivElement>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [prevUsageSearch, setPrevUsageSearch] = useState(usageSearch);
  if (usageSearch !== prevUsageSearch) {
    setPrevUsageSearch(usageSearch);
    if (usageSearch.trim()) setPendingUsageColor(getUsageColor(usageSearch.trim()));
  }

  useEffect(() => {
    if (!usageDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (usageDropdownRef.current && !usageDropdownRef.current.contains(e.target as Node)) {
        setUsageDropdownOpen(false);
        setUsageSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [usageDropdownOpen]);

  useEffect(() => {
    if (!addingUsageForItem) return;
    const handler = () => setAddingUsageForItem(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addingUsageForItem]);

  const availableUsages = useMemo(() => {
    const current = new Set(building.usages.map(u => u.trim().toLowerCase()));
    const base = limitsDefinition?.usages ?? [];
    const fromInstances = liveBuildingInstances.flatMap(b => b.usages.map(u => u.trim())).filter(Boolean);
    return [...new Set([...base, ...fromInstances])].filter(u => !current.has(u.trim().toLowerCase()));
  }, [limitsDefinition, building.usages, liveBuildingInstances]);

  const filteredUsages = useMemo(() =>
    availableUsages.filter(u => u.toLowerCase().includes(usageSearch.toLowerCase())),
  [availableUsages, usageSearch]);

  // Aggregate all eligible items across all containers, deduplicated
  const allItems = useMemo(() => {
    const key = building.typeName.trim().toLowerCase();
    const originalEntry = originalMapGroupProto.get(key);
    const seen = new Set<string>();
    const result: DayZType[] = [];
    for (let i = 0; i < building.containers.length; i++) {
      const container = building.containers[i];
      // If this container originally had categories but now has none, the user explicitly
      // removed them all — treat as "no items" rather than "unrestricted".
      const originalCategories = originalEntry?.containers[i]?.categories ?? [];
      if (container.categories.length === 0 && originalCategories.length > 0) continue;
      for (const type of types.values()) {
        if (seen.has(type.name)) continue;
        if (!containerAcceptsType(type, container.tags, container.categories)) continue;
        seen.add(type.name);
        result.push(type);
      }
    }
    return result.sort((a, b) => b.nominal - a.nominal);
  }, [building.containers, types, originalMapGroupProto, building.typeName]);

  const effectiveItems = useMemo(() => {
    const ceUsages = zoneUsages.filter(u => u && u !== 'unknown');
    const buildingUsages = building.usages.filter(u => u && u !== 'unknown');
    // Merge CE territory usages + building proto usages (deduplicated, case-insensitive)
    const seenU = new Set<string>();
    const activeUsages = [...ceUsages, ...buildingUsages].filter(u => {
      const k = u.toLowerCase();
      if (seenU.has(k)) return false;
      seenU.add(k);
      return true;
    });
    // Tiers at this spot: value-flag zone at the position + tiers on the
    // building proto itself.
    const activeTiers = [...new Set([...zoneTiers, ...protoTiers])].filter(t => t && t !== 'unknown');
    const hasZone = activeUsages.length > 0 || activeTiers.length > 0;
    if (!hasZone || !zoneFilterActive) return allItems;
    // Vanilla CE: an item spawns here only if its usage flags intersect the
    // usages at this spot AND its value (tier) flags intersect the tiers.
    // An item with no flags on an axis is unrestricted on that axis, but a
    // flagged item can NOT spawn where the matching signal is absent.
    return allItems.filter(item => {
      const usageOk = item.usages.length === 0 ||
        item.usages.some(u => activeUsages.some(z => z.toLowerCase() === u.toLowerCase()));
      const tierOk = item.tiers.length === 0 ||
        item.tiers.some(t => activeTiers.some(z => z.toLowerCase() === t.toLowerCase()));
      return usageOk && tierOk;
    });
  }, [allItems, zoneFilterActive, zoneUsages, zoneTiers, protoTiers, building.usages]);

  const tagSearchResults = useMemo(() => {
    if (!tagSearch.trim()) return [];
    const q = tagSearch.trim().toLowerCase();
    const results: DayZType[] = [];
    for (const item of types.values()) {
      if (!item.name.toLowerCase().includes(q)) continue;
      results.push(item);
      if (results.length >= 50) break;
    }
    return results;
  }, [tagSearch, types]);

  const selectableCategories = useMemo(() => {
    const keys = new Map<string, string>();
    for (const type of types.values()) {
      const raw = type.category ?? '__none__';
      const normalized = raw.toLowerCase();
      if (!keys.has(normalized)) keys.set(normalized, raw);
    }
    return [...keys.values()].sort((a, b) => {
      if (a.toLowerCase() === '__none__') return 1;
      if (b.toLowerCase() === '__none__') return -1;
      return a.localeCompare(b);
    });
  }, [types]);

  const cleanZoneTiers  = zoneTiers.filter(t => t && t !== 'unknown');
  const cleanZoneUsages = zoneUsages.filter(u => u && u !== 'unknown');

  // Group by derived display category (Snipers, SMGs, etc.)
  // Also track raw XML category per display group for block/add operations
  const { byCategory, rawCategoryByDisplay } = useMemo(() => {
    const map = new Map<string, DayZType[]>();
    const rawMap = new Map<string, string>(); // displayKey → raw XML category
    for (const item of effectiveItems) {
      const displayKey = displayCategory(item, attachmentNames, categoryOverrides).toLowerCase();
      if (!map.has(displayKey)) map.set(displayKey, []);
      map.get(displayKey)!.push(item);
      if (!rawMap.has(displayKey)) rawMap.set(displayKey, item.category ?? '__none__');
    }
    return { byCategory: map, rawCategoryByDisplay: rawMap };
  }, [effectiveItems, attachmentNames, categoryOverrides]);

  const hasZoneData = cleanZoneTiers.length > 0 ||
    cleanZoneUsages.length > 0 ||
    building.usages.filter(u => u && u !== 'unknown').length > 0;

  // Sort category keys: known order first, then alphabetical unknowns, __none__ last
  // When zone filter active, hide categories where no items can spawn (nominal > 0)
  const sortedCategories = useMemo(() => {
    const zoneActive = hasZoneData && zoneFilterActive;
    const keys = [...byCategory.keys()].filter(cat => {
      if (!zoneActive) return true;
      return byCategory.get(cat)!.some(item => item.nominal > 0);
    });
    return keys.sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });
  }, [byCategory, hasZoneData, zoneFilterActive]);

  const hasZoneTier = cleanZoneTiers.length > 0;
  const orderedProtoTiers = [...new Set(protoTiers)];
  const hasInferredTier = !!inferredTier && inferredTier !== 'unknown';
  const displaySourceSignals = useMemo(() => {
    const normalizedTiers = [...new Set(tiers.map(t => t.trim()).filter(Boolean))];
    const normalizedUsages = [...new Set(building.usages.map(u => u.trim()).filter(Boolean))];
    const zoneUsageSet = new Set(cleanZoneUsages.map(u => u.toLowerCase()));

    const hasKnownTier = normalizedTiers.some(t => t.toLowerCase() !== 'unknown');
    const hasKnownUsage = normalizedUsages.some(u => u.toLowerCase() !== 'unknown');
    const hasKnownSignal = hasKnownTier || hasKnownUsage || cleanZoneUsages.length > 0;

    const visibleTiers = hasKnownSignal
      ? normalizedTiers.filter(t => t.toLowerCase() !== 'unknown')
      : normalizedTiers;

    // proto usages that aren't already shown as zone usages
    const visibleUsages = (hasKnownSignal
      ? normalizedUsages.filter(u => u.toLowerCase() !== 'unknown')
      : normalizedUsages
    ).filter(u => !zoneUsageSet.has(u.toLowerCase()));

    return { visibleTiers, visibleUsages };
  }, [tiers, building.usages, cleanZoneUsages]);

  const openAddModal = (category = '') => {
    setAddModalCategory(category);
    setShowAddModal(true);
  };

  const handleAddCategory = async (category: string) => {
    if (category === '__none__') return;
    addBuildingCategory(building.typeName, category);
    setSaveStatus('Category change staged.');
  };

  const handleRemoveCategory = async (category: string) => {
    if (category === '__none__') return;
    removeBuildingCategory(building.typeName, category);
    setSaveStatus('Category change staged.');
  };

  return (
    <div className={embedded ? 'relative text-xs h-full overflow-y-auto p-3' : 'relative text-xs w-80 max-h-[480px] overflow-y-auto'}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-mono font-semibold text-slate-100 break-all">{building.typeName}</p>
        <span className="text-slate-500 whitespace-nowrap">lootmax {building.lootmax}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {[...new Set([...cleanZoneTiers, ...displaySourceSignals.visibleTiers])].map(t => (
          <span
            key={t}
            className="px-1.5 py-0.5 rounded text-white text-xs font-semibold"
            style={{ backgroundColor: TIER_COLORS[t] ?? TIER_COLORS.unknown }}
          >{t}</span>
        ))}
        {cleanZoneUsages.map(u => (
          <span
            key={`zone-${u}`}
            className="px-1.5 py-0.5 rounded text-xs font-semibold"
            style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }}
            title="CE territory zone"
          >{formatUsageLabel(u)}</span>
        ))}
        {displaySourceSignals.visibleUsages.map(u => (
          <span
            key={u}
            className="group px-1.5 py-0.5 rounded text-xs font-semibold flex items-center gap-1"
            style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }}
            title="Building usage tag"
          >
            {formatUsageLabel(u)}
            <button
              onClick={() => removeBuildingUsage(building.typeName, u)}
              className="opacity-0 group-hover:opacity-70 hover:!opacity-100 leading-none transition-opacity"
              title={`Remove ${u}`}
            >×</button>
          </span>
        ))}
        <div className="relative" ref={usageDropdownRef}>
          <button
            onClick={() => { setUsageDropdownOpen(v => !v); setUsageSearch(''); }}
            className="px-1.5 py-0.5 rounded text-xs font-medium bg-lime-900/50 text-lime-300 hover:bg-lime-900/80 border border-lime-700/50"
            title="Add usage"
          >+ Add</button>
            {usageDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg w-44">
                <input
                  autoFocus
                  type="text"
                  value={usageSearch}
                  onChange={e => setUsageSearch(e.target.value)}
                  placeholder="Search usages…"
                  className="w-full px-2 py-1 text-xs bg-slate-700 border-b border-slate-600 text-slate-200 placeholder-slate-500 focus:outline-none rounded-t"
                />
                {!usageSearch.trim() && (
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
                  {filteredUsages.map(u => (
                    <div key={u} className="flex items-center group hover:bg-slate-700">
                      <button
                        onClick={() => { addBuildingUsage(building.typeName, u); setUsageDropdownOpen(false); setUsageSearch(''); }}
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
                  {usageSearch.trim() && !availableUsages.some(u => u.toLowerCase() === usageSearch.trim().toLowerCase()) && (
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
                          const name = usageSearch.trim();
                          setCustomUsageColor(name, pendingUsageColor);
                          if (limitsDefinition) updateLimitsDefinition({ ...limitsDefinition, usages: [...limitsDefinition.usages, name] });
                          addBuildingUsage(building.typeName, name);
                          setUsageDropdownOpen(false);
                          setUsageSearch('');
                        }}
                        className="flex-1 text-left text-xs text-lime-300 hover:text-lime-200"
                      >
                        Create "{usageSearch.trim()}"
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
      </div>
      {(hasZoneTier || orderedProtoTiers.length > 0 || hasInferredTier) && (
        <div className="mb-3 text-[11px] text-slate-500">
          Tier source:
          {hasZoneTier && (
            <span className="ml-1 text-sky-300">zone {cleanZoneTiers.join(' · ')}</span>
          )}
          {hasZoneTier && orderedProtoTiers.length > 0 && <span className="mx-1">+</span>}
          {orderedProtoTiers.length > 0 && (
            <span className="text-amber-300">house {orderedProtoTiers.join(' · ')}</span>
          )}
          {(hasZoneTier || orderedProtoTiers.length > 0) && hasInferredTier && <span className="mx-1">+</span>}
          {hasInferredTier && (
            <span className="text-fuchsia-300">inferred {inferredTier}</span>
          )}
        </div>
      )}

      {building.containers.length > 0 && (
        <div className="mb-3 border border-slate-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setContainersOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-300 font-medium"
          >
            <span>Containers ({building.containers.length})</span>
            <span className="text-slate-500">{containersOpen ? '▲' : '▼'}</span>
          </button>
          {containersOpen && (
            <div className="divide-y divide-slate-800">
              {building.containers.map(container => {
                const cKey = container.name;
                const lootDraft = containerLootmaxDrafts[cKey] ?? String(container.lootmax);
                const tagInput = containerTagInputs[cKey] ?? '';
                const catInput = containerCatInputs[cKey] ?? '';
                return (
                  <div key={cKey} className="px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-400 truncate flex-1" title={cKey}>{cKey}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[10px] text-slate-500">lootmax</span>
                        <input
                          type="number"
                          min={0}
                          value={lootDraft}
                          onChange={e => setContainerLootmaxDrafts(p => ({ ...p, [cKey]: e.target.value }))}
                          onBlur={() => {
                            const v = parseInt(lootDraft, 10);
                            if (!isNaN(v) && v >= 0) updateContainerLootmax(building.typeName, cKey, v);
                            setContainerLootmaxDrafts(p => ({ ...p, [cKey]: String(container.lootmax) }));
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="h-5 w-10 bg-slate-800 border border-slate-700 rounded px-1 text-[10px] text-slate-300"
                        />
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 mr-1">Tags:</span>
                      <span className="inline-flex flex-wrap gap-1 items-center">
                        {container.tags.map(tag => (
                          <span key={tag} className="group inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: getUsageColor(tag), color: getUsageTextColor(getUsageColor(tag)) }}>
                            {tag}
                            <button onClick={() => removeContainerTag(building.typeName, cKey, tag)} className="opacity-0 group-hover:opacity-80 hover:!opacity-100 leading-none">×</button>
                          </span>
                        ))}
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            value={tagInput}
                            onChange={e => setContainerTagInputs(p => ({ ...p, [cKey]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && tagInput.trim()) {
                                addContainerTag(building.typeName, cKey, tagInput.trim());
                                setContainerTagInputs(p => ({ ...p, [cKey]: '' }));
                              }
                            }}
                            placeholder="+ tag"
                            className="h-4 w-14 bg-slate-800/60 border border-slate-700 rounded px-1 text-[10px] text-slate-300 placeholder-slate-600"
                          />
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 mr-1">Categories:</span>
                      <span className="inline-flex flex-wrap gap-1 items-center">
                        {container.categories.map(cat => (
                          <span key={cat} className="group inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px]">
                            {cat}
                            <button onClick={() => removeContainerCategory(building.typeName, cKey, cat)} className="opacity-0 group-hover:opacity-80 hover:!opacity-100 leading-none">×</button>
                          </span>
                        ))}
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            value={catInput}
                            onChange={e => setContainerCatInputs(p => ({ ...p, [cKey]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && catInput.trim()) {
                                addContainerCategory(building.typeName, cKey, catInput.trim());
                                setContainerCatInputs(p => ({ ...p, [cKey]: '' }));
                              }
                            }}
                            placeholder="+ cat"
                            className="h-4 w-14 bg-slate-800/60 border border-slate-700 rounded px-1 text-[10px] text-slate-300 placeholder-slate-600"
                          />
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => openAddModal()}
          className="w-6 h-6 rounded-md border border-lime-700/70 bg-lime-900/40 text-lime-300 hover:text-lime-200"
          title="Add category to this building type"
        >
          +
        </button>
      </div>
      {hasZoneData && (
        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500">Zone:</span>
          {cleanZoneTiers.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ backgroundColor: TIER_COLORS[t] ?? TIER_COLORS.unknown }}>{t}</span>
          ))}
          {cleanZoneUsages.map(u => (
            <span key={u} className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }}>{formatUsageLabel(u)}</span>
          ))}
          {building.usages.filter(u => u && u !== 'unknown' && !cleanZoneUsages.some(z => z.toLowerCase() === u.toLowerCase())).map(u => (
            <span key={`proto-${u}`} className="px-1.5 py-0.5 rounded text-[10px] font-semibold opacity-70" style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }} title="Building proto usage">{formatUsageLabel(u)}</span>
          ))}
          <button
            onClick={() => setZoneFilterActive(v => !v)}
            className={`ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors ${zoneFilterActive ? 'border-sky-700 bg-sky-900/40 text-sky-300 hover:bg-sky-900/60' : 'border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            {zoneFilterActive ? 'Showing spawn zone only' : 'Show all'}
          </button>
        </div>
      )}
      {saveStatus && <div className="mb-2 text-[11px] text-slate-400">{saveStatus}</div>}

      <div className="mb-3 border border-slate-700 rounded-lg overflow-hidden">
          <button
            onClick={() => { setTagSearchOpen(v => !v); setAddingUsageForItem(null); }}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-300 font-medium"
          >
            <span>Tag items to spawn here</span>
            <span className="text-slate-500">{tagSearchOpen ? '▲' : '▼'}</span>
          </button>
          {tagSearchOpen && (
            <div className="border-t border-slate-800">
              <input
                autoFocus
                value={tagSearch}
                onChange={e => { setTagSearch(e.target.value); setAddingUsageForItem(null); }}
                placeholder="Search item name…"
                className="w-full px-3 py-1.5 text-xs bg-slate-800 border-b border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none"
              />
              {tagSearch.trim() && tagSearchResults.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-slate-500">No items match</p>
              )}
              {!tagSearch.trim() && (
                <p className="px-3 py-2 text-[11px] text-slate-500">Type to search all item types…</p>
              )}
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/50">
                {tagSearchResults.map(item => {
                  const seenZones = new Set<string>();
                  const availableZones = [...cleanZoneUsages, ...building.usages].filter(u => {
                    if (!u || u === 'unknown') return false;
                    if (item.usages.some(iu => iu.toLowerCase() === u.toLowerCase())) return false;
                    const key = u.toLowerCase();
                    if (seenZones.has(key)) return false;
                    seenZones.add(key);
                    return true;
                  });
                  const isPickingZone = addingUsageForItem === item.name;
                  return (
                    <div key={item.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/30">
                      <span className="flex-1 text-xs text-slate-300 truncate" title={item.name}>{item.name}</span>
                      <div className="relative flex-shrink-0">
                        <button
                          onClick={() => setAddingUsageForItem(isPickingZone ? null : item.name)}
                          className="h-5 px-2 rounded-md border border-lime-700/70 bg-lime-900/40 text-lime-300 hover:text-lime-200 text-[10px]"
                        >
                          + Add ▾
                        </button>
                        {isPickingZone && (
                          <div className="absolute right-0 top-6 z-50 bg-slate-900 border border-slate-700 rounded shadow-lg py-1 min-w-[120px]" onMouseDown={e => e.stopPropagation()}>
                            {availableZones.length === 0 ? (
                              <p className="px-3 py-1.5 text-[10px] text-slate-500 whitespace-nowrap">No zones at this position</p>
                            ) : (
                              availableZones.map(zone => (
                                <button
                                  key={zone}
                                  onClick={() => {
                                    const missingTiers = cleanZoneTiers.filter(t => !item.tiers.some(it => it.toLowerCase() === t.toLowerCase()));
                                    updateType(item.name, { usages: [...item.usages, zone], tiers: [...item.tiers, ...missingTiers] });
                                    const tierNote = missingTiers.length > 0 ? ` + ${missingTiers.join(', ')}` : '';
                                    setSaveStatus(`Tagged ${item.name} with ${zone}${tierNote}.`);
                                    setAddingUsageForItem(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                                >
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getUsageColor(zone) }} />
                                  {formatUsageLabel(zone)}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      {building.containers.length === 0 ? (
        <p className="text-slate-500 italic">no container data</p>
      ) : (
        <>
          {sortedCategories.map(cat => (
            <CategorySection
              key={cat}
              categoryKey={rawCategoryByDisplay.get(cat) ?? cat}
              label={cat === '__none__' ? 'Uncategorized' : (CATEGORY_LABELS[cat] ?? cat)}
              items={byCategory.get(cat)!}
              autoExpand={!!categoryFilter && cat === categoryFilter}
              onBlockCategory={(category) => { void handleRemoveCategory(category); }}
              onOpenAddModal={(category) => openAddModal(category)}
              onSelectItem={onSelectItem}
            />
          ))}

          {sortedCategories.length === 0 && (
            <p className="text-slate-500 italic">No loot after overrides</p>
          )}
        </>
      )}

      <AddLootModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        types={types}
        categories={selectableCategories}
        defaultCategory={addModalCategory}
        onAddCategory={(category) => { void handleAddCategory(category); }}
      />

    </div>
  );
}
