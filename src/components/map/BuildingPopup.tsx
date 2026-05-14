import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BuildingInstance, DayZType } from '../../types/dayz';
import { TIER_COLORS, getUsageColor, formatUsageLabel } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';

interface Props {
  building: BuildingInstance;
  tiers: string[];
  zoneTier?: string | null;
  zoneUsage?: string | null;
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
  onOpenTierModal,
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
  onOpenTierModal: (category: string) => void;
}) {
  const [open, setOpen]         = useState(autoExpand ?? false);
  const [search, setSearch]     = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
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
      if (activeOnly && t.nominal === 0) return false;
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
  }, [items, activeOnly, search, sortMode]);

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
            className="w-5 h-5 rounded border border-emerald-700/70 bg-emerald-900/40 text-emerald-300 hover:text-emerald-200"
            title="Add this category to building type (XML)"
          >
            +
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenTierModal(categoryKey);
            }}
            className="w-5 h-5 rounded border border-amber-700/70 bg-amber-900/40 text-amber-300 hover:text-amber-200"
            title="Remove one tier for this category (types.xml)"
          >
            T
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBlockCategory(categoryKey);
            }}
            className="w-5 h-5 rounded border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:text-rose-200"
            title="Remove this category from building type (XML)"
          >
            x
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
            <label className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap cursor-pointer select-none">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={e => setActiveOnly(e.target.checked)}
                className="accent-slate-500"
              />
              Active only
            </label>
          </div>
          <div className="overflow-y-auto max-h-52">
            {filtered.length === 0 ? (
              <p className="text-slate-600 italic text-xs px-3 py-2">No items match</p>
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
                <p className="text-slate-700 text-xs px-3 py-1">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type TierPatch = {
  name: string;
  source: string;
  oldTiers: string[];
  newTiers: string[];
};

function tierNum(tier: string): number | null {
  const m = /^Tier(\d+)$/i.exec(tier.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function TierGateModal({
  open,
  onClose,
  category,
  tierOptions,
  selectedTier,
  setSelectedTier,
  preview,
  applying,
  onApply,
  status,
}: {
  open: boolean;
  onClose: () => void;
  category: string;
  tierOptions: string[];
  selectedTier: string;
  setSelectedTier: (v: string) => void;
  preview: { patches: TierPatch[]; noTierCount: number; noHigherCount: number };
  applying: boolean;
  onApply: () => void;
  status: string | null;
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-[1px] flex items-center justify-center p-2"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-[310px] max-h-[90%] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">Tier Gate Category (types.xml)</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-200 text-xs"
          >
            x
          </button>
        </div>

        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="text-[11px] text-slate-400">Category: <span className="text-slate-200">{category}</span></div>
          <select
            value={selectedTier}
            onChange={e => setSelectedTier(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            <option value="">Select tier to remove...</option>
            {tierOptions.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="text-[11px] text-slate-500">
            Will remove selected tier only when item still has a higher tier. This avoids making entries unrestricted.
          </div>
        </div>

        <div className="p-3 space-y-1 border-b border-slate-800 text-[11px]">
          <div className="text-emerald-300">Will update: {preview.patches.length}</div>
          <div className="text-slate-500">Already not in tier: {preview.noTierCount}</div>
          <div className="text-slate-500">Blocked (no higher tier): {preview.noHigherCount}</div>
          {preview.patches.length > 0 && (
            <div className="max-h-28 overflow-y-auto mt-1 border border-slate-800 rounded p-1">
              {preview.patches.slice(0, 20).map(p => (
                <div key={p.name} className="text-slate-300 truncate">{p.name}</div>
              ))}
              {preview.patches.length > 20 && (
                <div className="text-slate-500">+{preview.patches.length - 20} more</div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 flex items-center justify-between gap-2">
          <button
            onClick={onApply}
            disabled={!selectedTier || preview.patches.length === 0 || applying}
            className="px-3 py-1 rounded bg-amber-900/40 border border-amber-700 text-amber-200 disabled:opacity-50"
          >
            {applying ? 'Applying...' : 'Stage Changes'}
          </button>
          {status && <span className="text-[11px] text-slate-400">{status}</span>}
        </div>
      </div>
    </div>,
    document.body,
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
        className="w-[310px] max-h-[90%] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex flex-col"
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
            className="text-slate-400 hover:text-slate-200 text-xs"
          >
            x
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
                className="px-2 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-xs"
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
  zoneTier,
  zoneUsage,
  protoTiers = [],
  inferredTier,
  embedded = false,
}: Props) {
  const types = useServerStore(s => s.mission?.types ?? EMPTY_TYPES);
  const categoryFilter  = useUiStore(s => s.categoryFilter);
  const dirty = useServerStore(s => s.dirty);
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
  const updateType = useServerStore(s => s.updateType);
  const setShowSaveReview = useUiStore(s => s.setShowSaveReview);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState('');
  const [showTierModal, setShowTierModal] = useState(false);
  const [tierModalCategory, setTierModalCategory] = useState('');
  const [tierModalTier, setTierModalTier] = useState('');
  const [tierApplying, setTierApplying] = useState(false);
  const [tierStatus, setTierStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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

  const effectiveItems = allItems;

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

  // Group by derived display category
  const byCategory = useMemo(() => {
    const map = new Map<string, DayZType[]>();
    for (const item of effectiveItems) {
      const key = (item.category ?? '__none__').toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [effectiveItems]);

  // Sort category keys: known order first, then alphabetical unknowns, __none__ last
  const sortedCategories = useMemo(() => {
    const keys = [...byCategory.keys()];
    return keys.sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });
  }, [byCategory]);

  const hasZoneTier = !!zoneTier && zoneTier !== 'unknown';
  const orderedProtoTiers = [...new Set(protoTiers)];
  const hasInferredTier = !!inferredTier && inferredTier !== 'unknown';
  const displaySourceSignals = useMemo(() => {
    const normalizedTiers = [...new Set(tiers.map(t => t.trim()).filter(Boolean))];
    const normalizedUsages = [...new Set(building.usages.map(u => u.trim()).filter(Boolean))];
    const normalizedZoneUsage = zoneUsage?.trim() ?? '';

    const hasKnownTier = normalizedTiers.some(t => t.toLowerCase() !== 'unknown');
    const hasKnownUsage = normalizedUsages.some(u => u.toLowerCase() !== 'unknown');
    const hasKnownZoneUsage = normalizedZoneUsage !== '' && normalizedZoneUsage.toLowerCase() !== 'unknown';
    const hasKnownSignal = hasKnownTier || hasKnownUsage || hasKnownZoneUsage;

    const visibleTiers = hasKnownSignal
      ? normalizedTiers.filter(t => t.toLowerCase() !== 'unknown')
      : normalizedTiers;

    const visibleUsages = hasKnownSignal
      ? normalizedUsages.filter(u => u.toLowerCase() !== 'unknown')
      : normalizedUsages;

    const showZoneUsageBadge = normalizedZoneUsage !== '' && (
      normalizedZoneUsage.toLowerCase() !== 'unknown' || !hasKnownSignal
    );

    return {
      visibleTiers,
      visibleUsages,
      showZoneUsageBadge,
      zoneUsageValue: normalizedZoneUsage,
    };
  }, [tiers, building.usages, zoneUsage]);

  const openAddModal = (category = '') => {
    setAddModalCategory(category);
    setShowAddModal(true);
  };

  const openTierModal = (category = '') => {
    setTierModalCategory(category);
    setTierModalTier('');
    setTierStatus(null);
    setShowTierModal(true);
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

  const tierPreview = useMemo(() => {
    if (!tierModalCategory || !tierModalTier) {
      return { patches: [] as TierPatch[], noTierCount: 0, noHigherCount: 0 };
    }

    const targetNum = tierNum(tierModalTier);
    if (targetNum == null) {
      return { patches: [] as TierPatch[], noTierCount: 0, noHigherCount: 0 };
    }

    let noTierCount = 0;
    let noHigherCount = 0;
    const patches: TierPatch[] = [];

    for (const type of types.values()) {
      const cat = (type.category ?? '__none__').toLowerCase();
      if (cat !== tierModalCategory) continue;

      const hasTargetTier = type.tiers.includes(tierModalTier);
      if (!hasTargetTier) {
        noTierCount += 1;
        continue;
      }

      const hasHigherTier = type.tiers.some((t: string) => {
        const n = tierNum(t);
        return n != null && n > targetNum;
      });

      if (!hasHigherTier) {
        noHigherCount += 1;
        continue;
      }

      const newTiers = type.tiers.filter((t: string) => t !== tierModalTier);
      if (newTiers.length === 0) {
        noHigherCount += 1;
        continue;
      }

      patches.push({
        name: type.name,
        source: type.source,
        oldTiers: type.tiers,
        newTiers,
      });
    }

    return { patches, noTierCount, noHigherCount };
  }, [types, tierModalCategory, tierModalTier]);

  const tierOptionsForCategory = useMemo(() => {
    if (!tierModalCategory) return [] as string[];
    const set = new Set<string>();
    for (const type of types.values()) {
      const cat = (type.category ?? '__none__').toLowerCase();
      if (cat !== tierModalCategory) continue;
      for (const tier of type.tiers) {
        if (/^Tier\d+$/i.test(tier)) set.add(tier);
      }
    }
    return [...set].sort((a, b) => (tierNum(a) ?? 0) - (tierNum(b) ?? 0));
  }, [types, tierModalCategory]);

  const applyTierGate = async () => {
    if (!tierModalTier || tierPreview.patches.length === 0) return;
    setTierApplying(true);
    setTierStatus(null);

    try {
      for (const patch of tierPreview.patches) {
        updateType(patch.name, { tiers: patch.newTiers });
      }

      setTierStatus(`Staged ${tierPreview.patches.length} item(s).`);
    } catch {
      setTierStatus('Failed to stage tier edits.');
    } finally {
      setTierApplying(false);
    }
  };

  const pendingTypeSources = dirty.typesSources.length;
  const pendingMapProto = dirty.mapGroupProto;
  const hasPending = pendingMapProto || pendingTypeSources > 0;


  return (
    <div className={embedded ? 'relative text-xs h-full overflow-y-auto p-3' : 'relative text-xs w-80 max-h-[480px] overflow-y-auto'}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-mono font-semibold text-slate-100 break-all">{building.typeName}</p>
        <span className="text-slate-500 whitespace-nowrap">lootmax {building.lootmax}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {displaySourceSignals.visibleTiers.map(t => (
          <span
            key={t}
            className="px-1.5 py-0.5 rounded text-white text-xs font-semibold"
            style={{ backgroundColor: TIER_COLORS[t] ?? TIER_COLORS.unknown }}
          >{t}</span>
        ))}
        {displaySourceSignals.showZoneUsageBadge && (
          <span
            className="px-1.5 py-0.5 rounded text-white text-xs font-semibold"
            style={{ backgroundColor: getUsageColor(displaySourceSignals.zoneUsageValue) }}
            title="CE zone type (from usage layer)"
          >{formatUsageLabel(displaySourceSignals.zoneUsageValue)}</span>
        )}
        {displaySourceSignals.visibleUsages.length > 0 && (
          <span className="text-slate-400">{displaySourceSignals.visibleUsages.map(formatUsageLabel).join(' · ')}</span>
        )}
      </div>
      {(hasZoneTier || orderedProtoTiers.length > 0 || hasInferredTier) && (
        <div className="mb-3 text-[11px] text-slate-500">
          Tier source:
          {hasZoneTier && (
            <span className="ml-1 text-sky-300">zone {zoneTier}</span>
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

      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => openAddModal()}
          className="w-6 h-6 rounded border border-emerald-700/70 bg-emerald-900/40 text-emerald-300 hover:text-emerald-200"
          title="Add category to this building type"
        >
          +
        </button>
        <div className="flex items-center gap-2">
          {hasPending && (
            <span className="text-[10px] text-amber-400">
              Pending: {pendingMapProto ? 'mapgroupproto' : ''}{pendingMapProto && pendingTypeSources > 0 ? ' + ' : ''}{pendingTypeSources > 0 ? `${pendingTypeSources} types file(s)` : ''}
            </span>
          )}
          <button
            onClick={() => setShowSaveReview(true)}
            disabled={!hasPending}
            className="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-200 disabled:opacity-50"
            title="Review and save all pending XML changes"
          >
            Save Pending
          </button>
        </div>
      </div>
      {saveStatus && <div className="mb-2 text-[11px] text-slate-400">{saveStatus}</div>}

      {building.containers.length === 0 ? (
        <p className="text-slate-600 italic">no container data</p>
      ) : (
        <>
          {sortedCategories.map(cat => (
            <CategorySection
              key={cat}
              categoryKey={cat.toLowerCase()}
              label={cat === '__none__' ? 'Uncategorized' : cat}
              items={byCategory.get(cat)!}
              tierOptions={availableTierOptions}
              autoExpand={!!categoryFilter && cat === categoryFilter}
              onBlockCategory={(category) => { void handleRemoveCategory(category); }}
              onSetItemNominal={handleSetItemNominal}
              onSetItemMin={handleSetItemMin}
              onToggleItemTier={handleToggleItemTier}
              onOpenAddModal={(category) => openAddModal(category)}
              onOpenTierModal={(category) => openTierModal(category)}
            />
          ))}

          {sortedCategories.length === 0 && (
            <p className="text-slate-600 italic">No loot after overrides</p>
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

      <TierGateModal
        open={showTierModal}
        onClose={() => setShowTierModal(false)}
        category={tierModalCategory === '__none__' ? 'Uncategorized' : tierModalCategory}
        tierOptions={tierOptionsForCategory}
        selectedTier={tierModalTier}
        setSelectedTier={setTierModalTier}
        preview={tierPreview}
        applying={tierApplying}
        onApply={() => { void applyTierGate(); }}
        status={tierStatus}
      />
    </div>
  );
}
