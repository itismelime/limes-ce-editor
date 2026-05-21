import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BuildingInstance, DayZType } from '../../types/dayz';
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
}

const EMPTY_TYPES = new Map<string, DayZType>();

function matchesContainer(
  type: DayZType,
  containerTags: string[],
  containerCategories: string[],
): boolean {
  const isUnrestricted = type.usages.length === 0 || type.usages.every(u => u === '');
  const normalizedTags = containerTags.map(tag => tag.toLowerCase());
  const normalizedCategories = containerCategories.map(category => category.toLowerCase());
  const usageMatch =
    isUnrestricted ||
    normalizedTags.length === 0 ||
    type.usages.some(u => normalizedTags.includes(u.toLowerCase()));
  const catMatch =
    normalizedCategories.length > 0 &&
    type.category !== null &&
    normalizedCategories.includes(type.category.toLowerCase());
  return usageMatch && catMatch;
}

function CategorySection({
  label,
  categoryKey,
  items,
  tierOptions,
  autoExpand,
  onBlockCategory,
  onSetItemNominal,
  onSetItemMin,
  onToggleItemTier,
  onOpenAddModal,
}: {
  label: string;
  categoryKey: string;
  items: DayZType[];
  tierOptions: string[];
  autoExpand?: boolean;
  onBlockCategory: (category: string) => void;
  onSetItemNominal: (itemName: string, nominal: number) => void;
  onSetItemMin: (itemName: string, min: number) => void;
  onToggleItemTier: (itemName: string, tier: string) => void;
  onOpenAddModal: (category: string) => void;
}) {
  const [open, setOpen]         = useState(autoExpand ?? false);
  const [search, setSearch]     = useState('');
  const [sortMode, setSortMode] = useState<'az' | 'nominal' | 'min'>('az');
  const [openTierDropdown, setOpenTierDropdown] = useState<string | null>(null);
  const [nominalDraftByItem, setNominalDraftByItem] = useState<Record<string, string>>({});
  const [minDraftByItem, setMinDraftByItem] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!openTierDropdown) return;
    const close = () => setOpenTierDropdown(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openTierDropdown]);

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

  const getNominalDraft = (item: DayZType) => nominalDraftByItem[item.name] ?? String(item.nominal);
  const getMinDraft = (item: DayZType) => minDraftByItem[item.name] ?? String(item.min);

  const commitNominal = (item: DayZType) => {
    const raw = (nominalDraftByItem[item.name] ?? String(item.nominal)).trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setNominalDraftByItem(prev => ({ ...prev, [item.name]: String(item.nominal) }));
      return;
    }
    onSetItemNominal(item.name, Math.max(0, parsed));
  };

  const commitMin = (item: DayZType) => {
    const raw = (minDraftByItem[item.name] ?? String(item.min)).trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setMinDraftByItem(prev => ({ ...prev, [item.name]: String(item.min) }));
      return;
    }
    onSetItemMin(item.name, Math.max(0, parsed));
  };

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
                      <span className="text-slate-300 text-xs truncate" title={item.name}>{item.name}</span>
                      <div className="text-right flex-shrink-0 text-xs flex items-center gap-1">
                        <div className="flex items-center gap-1" title="Nominal">
                          <span className="text-[10px] text-slate-500">N</span>
                          <input
                            type="number"
                            min={0}
                            value={getNominalDraft(item)}
                            onChange={e => setNominalDraftByItem(prev => ({ ...prev, [item.name]: e.target.value }))}
                            onBlur={() => commitNominal(item)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitNominal(item);
                            }}
                            className="h-5 w-12 bg-slate-800 border border-slate-700 rounded px-1 text-[10px] text-slate-300"
                          />
                        </div>
                        <div className="flex items-center gap-1" title="Minimum">
                          <span className="text-[10px] text-slate-500">M</span>
                          <input
                            type="number"
                            min={0}
                            value={getMinDraft(item)}
                            onChange={e => setMinDraftByItem(prev => ({ ...prev, [item.name]: e.target.value }))}
                            onBlur={() => commitMin(item)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitMin(item);
                            }}
                            className="h-5 w-12 bg-slate-800 border border-slate-700 rounded px-1 text-[10px] text-slate-300"
                          />
                        </div>
                        {tierOptions.length > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setOpenTierDropdown(openTierDropdown === item.name ? null : item.name)}
                              className="h-5 px-1.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-300 hover:border-slate-500 whitespace-nowrap"
                            >
                              {item.tiers.length === 0
                                ? 'Tiers ▾'
                                : item.tiers.map(t => t.replace(/^Tier/i, 'T')).join(', ') + ' ▾'}
                            </button>
                            {openTierDropdown === item.name && (
                              <div
                                className="absolute right-0 top-6 z-50 bg-slate-900 border border-slate-700 rounded shadow-lg py-1 min-w-[80px]"
                                onMouseDown={e => e.stopPropagation()}
                              >
                                {tierOptions.map(tier => {
                                  const hasTier = item.tiers.some(t => t.toLowerCase() === tier.toLowerCase());
                                  return (
                                    <label
                                      key={tier}
                                      className="flex items-center gap-2 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer"
                                      onMouseDown={e => {
                                        e.preventDefault();
                                        onToggleItemTier(item.name, tier);
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        readOnly
                                        checked={hasTier}
                                        className="accent-slate-500"
                                      />
                                      {tier}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
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

function tierNum(tier: string): number | null {
  const m = /^Tier(\d+)$/i.exec(tier.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
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

  useEffect(() => {
    if (open) {
      const matchedDefault = categories.find(cat => cat.toLowerCase() === defaultCategory.toLowerCase()) ?? defaultCategory;
      setCategoryFilter(matchedDefault);
      setSearch('');
    }
  }, [open, defaultCategory, categories]);

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

  useEffect(() => {
    if (usageSearch.trim()) setPendingUsageColor(getUsageColor(usageSearch.trim()));
  }, [usageSearch]);

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
        if (!matchesContainer(type, container.tags, container.categories)) continue;
        seen.add(type.name);
        result.push(type);
      }
    }
    return result.sort((a, b) => b.nominal - a.nominal);
  }, [building.containers, types, originalMapGroupProto, building.typeName]);

  const effectiveItems = useMemo(() => {
    const activeUsages = zoneUsages.filter(u => u && u !== 'unknown');
    const activeTiers  = zoneTiers.filter(t => t && t !== 'unknown');
    const hasZone = activeUsages.length > 0 || activeTiers.length > 0;
    if (!hasZone || !zoneFilterActive) return allItems;
    return allItems.filter(item => {
      const usageOk = activeUsages.length === 0 || item.usages.length === 0 ||
        item.usages.some(u => activeUsages.some(z => z.toLowerCase() === u.toLowerCase()));
      const tierOk = activeTiers.length === 0 || item.tiers.length === 0 ||
        item.tiers.some(t => activeTiers.some(z => z.toLowerCase() === t.toLowerCase()));
      return usageOk && tierOk;
    });
  }, [allItems, zoneFilterActive, zoneUsages, zoneTiers]);

  // Items that match container categories but lack zone usages → can be tagged to spawn here
  const tagSearchResults = useMemo(() => {
    if (!tagSearch.trim()) return [];
    const activeUsages = zoneUsages.filter(u => u && u !== 'unknown');
    if (activeUsages.length === 0) return [];
    const q = tagSearch.trim().toLowerCase();
    const results: DayZType[] = [];
    for (const item of types.values()) {
      if (!item.name.toLowerCase().includes(q)) continue;
      // must match at least one container's category
      const catMatch = building.containers.some(c =>
        c.categories.length === 0 || (item.category && c.categories.some(cat => cat.toLowerCase() === item.category!.toLowerCase()))
      );
      if (!catMatch) continue;
      // exclude items already matching all zone usages
      const alreadyTagged = activeUsages.every(u => item.usages.some(iu => iu.toLowerCase() === u.toLowerCase()));
      if (alreadyTagged) continue;
      results.push(item);
      if (results.length >= 30) break;
    }
    return results;
  }, [tagSearch, types, zoneUsages, building.containers]);

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

  const availableTierOptions = useMemo(() => {
    let maxTier = 4;
    for (const tier of tiers) {
      const n = tierNum(tier);
      if (n !== null && n > maxTier) maxTier = n;
    }
    for (const type of types.values()) {
      for (const tier of type.tiers) {
        const n = tierNum(tier);
        if (n !== null && n > maxTier) maxTier = n;
      }
    }
    // Always show at least Tier1–Tier7 so users can assign any tier
    if (maxTier < 7) maxTier = 7;
    return Array.from({ length: maxTier }, (_, i) => `Tier${i + 1}`);
  }, [types, tiers]);

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

  const hasZoneData = (zoneTiers.filter(t => t && t !== 'unknown').length > 0) ||
    (zoneUsages.filter(u => u && u !== 'unknown').length > 0);

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

  const cleanZoneTiers  = zoneTiers.filter(t => t && t !== 'unknown');
  const cleanZoneUsages = zoneUsages.filter(u => u && u !== 'unknown');
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

  const handleSetItemNominal = (itemName: string, nominal: number) => {
    const type = types.get(itemName);
    if (!type) return;
    const nextNominal = Math.max(0, nominal);
    if (type.nominal === nextNominal) {
      setSaveStatus(`${itemName} nominal already ${nextNominal}.`);
      return;
    }
    updateType(itemName, { nominal: nextNominal });
    setSaveStatus(`${itemName} nominal set to ${nextNominal}.`);
  };

  const handleSetItemMin = (itemName: string, min: number) => {
    const type = types.get(itemName);
    if (!type) return;
    const nextMin = Math.max(0, min);
    if (type.min === nextMin) {
      setSaveStatus(`${itemName} min already ${nextMin}.`);
      return;
    }
    updateType(itemName, { min: nextMin });
    setSaveStatus(`${itemName} min set to ${nextMin}.`);
  };

  const handleToggleItemTier = (itemName: string, tier: string) => {
    const type = types.get(itemName);
    if (!type || !tier) return;
    const hasTier = type.tiers.some((t: string) => t.toLowerCase() === tier.toLowerCase());
    if (hasTier) {
      updateType(itemName, { tiers: type.tiers.filter((t: string) => t.toLowerCase() !== tier.toLowerCase()) });
      setSaveStatus(`Removed ${tier} from ${itemName}.`);
      return;
    }
    updateType(itemName, { tiers: [...type.tiers, tier] });
    setSaveStatus(`Added ${tier} to ${itemName}.`);
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
      {(cleanZoneTiers.length > 0 || cleanZoneUsages.length > 0) && (
        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500">Zone:</span>
          {cleanZoneTiers.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ backgroundColor: TIER_COLORS[t] ?? TIER_COLORS.unknown }}>{t}</span>
          ))}
          {cleanZoneUsages.map(u => (
            <span key={u} className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }}>{formatUsageLabel(u)}</span>
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

      {hasZoneData && zoneUsages.filter(u => u && u !== 'unknown').length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setTagSearchOpen(v => !v)}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-600 bg-slate-800/60 text-slate-400 hover:text-slate-200 w-full text-left"
          >
            {tagSearchOpen ? '▲' : '▼'} Tag items to spawn here
          </button>
          {tagSearchOpen && (
            <div className="mt-1 border border-slate-700 rounded-lg overflow-hidden">
              <input
                autoFocus
                value={tagSearch}
                onChange={e => setTagSearch(e.target.value)}
                placeholder="Search item name…"
                className="w-full px-2 py-1.5 text-xs bg-slate-800 border-b border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none"
              />
              {tagSearch.trim() && tagSearchResults.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-slate-500">No untagged items match</p>
              )}
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/60">
                {tagSearchResults.map(item => {
                  const activeUsages = zoneUsages.filter(u => u && u !== 'unknown');
                  const missing = activeUsages.filter(u => !item.usages.some(iu => iu.toLowerCase() === u.toLowerCase()));
                  return (
                    <div key={item.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/40">
                      <span className="flex-1 text-[11px] text-slate-300 truncate" title={item.name}>{item.name}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {missing.map(u => (
                          <span key={u} className="px-1 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: getUsageColor(u), color: getUsageTextColor(getUsageColor(u)) }}>{u}</span>
                        ))}
                        <button
                          onClick={() => {
                            updateType(item.name, { usages: [...item.usages, ...missing] });
                            setSaveStatus(`Tagged ${item.name} with ${missing.join(', ')}.`);
                          }}
                          className="px-2 py-0.5 rounded text-[10px] bg-lime-900/50 border border-lime-700 text-lime-300 hover:bg-lime-900/80"
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

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
              tierOptions={availableTierOptions}
              autoExpand={!!categoryFilter && cat === categoryFilter}
              onBlockCategory={(category) => { void handleRemoveCategory(category); }}
              onSetItemNominal={handleSetItemNominal}
              onSetItemMin={handleSetItemMin}
              onToggleItemTier={handleToggleItemTier}
              onOpenAddModal={(category) => openAddModal(category)}
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
