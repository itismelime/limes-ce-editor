import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BuildingInstance, DayZType } from '../../types/dayz';
import { TIER_COLORS } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';

interface Props {
  building: BuildingInstance;
  types: Map<string, DayZType>;
  tiers: string[];
  zoneTier?: string | null;
  protoTiers?: string[];
  inferredTier?: string | null;
}

function matchesContainer(
  type: DayZType,
  containerTags: string[],
  containerCategories: string[],
): boolean {
  const isUnrestricted = type.usages.length === 0 || type.usages.every(u => u === '');
  const usageMatch =
    isUnrestricted ||
    containerTags.length === 0 ||
    type.usages.some(u => containerTags.includes(u.toLowerCase()));
  const catMatch =
    containerCategories.length === 0 ||
    (type.category !== null && containerCategories.includes(type.category.toLowerCase()));
  return usageMatch && catMatch;
}

function CategorySection({
  label,
  categoryKey,
  items,
  autoExpand,
  onBlockCategory,
  onOpenAddModal,
  onOpenTierModal,
}: {
  label: string;
  categoryKey: string;
  items: DayZType[];
  autoExpand?: boolean;
  onBlockCategory: (category: string) => void;
  onOpenAddModal: (category: string) => void;
  onOpenTierModal: (category: string) => void;
}) {
  const [open, setOpen]         = useState(autoExpand ?? false);
  const [search, setSearch]     = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const activeCount = items.filter(t => t.nominal > 0).length;
  const filtered = items.filter(t => {
    if (activeOnly && t.nominal === 0) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="mb-2 border border-slate-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/60 hover:bg-slate-800 transition-colors text-left"
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
      </button>

      {open && (
        <div className="border-t border-slate-800">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/60">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter…"
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <label className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap cursor-pointer select-none">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={e => setActiveOnly(e.target.checked)}
                className="accent-indigo-500"
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
                      <span className="text-slate-300 text-xs truncate">{item.name}</span>
                      <div className="text-right flex-shrink-0 text-xs flex items-center gap-2">
                        <span className={item.nominal > 0 ? 'text-slate-400' : 'text-slate-700'}>{item.nominal} nom</span>
                        <span className="text-slate-600"> · {item.min} min</span>
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
    document.body
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
      setCategoryFilter(defaultCategory);
      setSearch('');
    }
  }, [open, defaultCategory]);

  const filteredItems = useMemo(() => {
    const rows: DayZType[] = [];
    for (const type of types.values()) {
      const categoryKey = (type.category ?? '__none__').toLowerCase();
      if (categoryFilter && categoryKey !== categoryFilter) continue;
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
              const cat = (type.category ?? '__none__').toLowerCase();
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


export function BuildingPopup({ building, types, tiers, zoneTier, protoTiers = [], inferredTier }: Props) {
  const categoryFilter  = useUiStore(s => s.categoryFilter);
  const dirty = useServerStore(s => s.dirty);
  const addBuildingCategory = useServerStore(s => s.addBuildingCategory);
  const removeBuildingCategory = useServerStore(s => s.removeBuildingCategory);
  const saveMapGroupProto = useServerStore(s => s.saveMapGroupProto);
  const updateType = useServerStore(s => s.updateType);
  const saveTypesSource = useServerStore(s => s.saveTypesSource);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState('');
  const [showTierModal, setShowTierModal] = useState(false);
  const [tierModalCategory, setTierModalCategory] = useState('');
  const [tierModalTier, setTierModalTier] = useState('');
  const [tierApplying, setTierApplying] = useState(false);
  const [tierStatus, setTierStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [savingPending, setSavingPending] = useState(false);

  // Aggregate all eligible items across all containers, deduplicated
  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const result: DayZType[] = [];
    for (const container of building.containers) {
      for (const type of types.values()) {
        if (!seen.has(type.name) && matchesContainer(type, container.tags, container.categories)) {
          seen.add(type.name);
          result.push(type);
        }
      }
    }
    return result.sort((a, b) => b.nominal - a.nominal);
  }, [building.containers, types]);

  const effectiveItems = allItems;

  const selectableCategories = useMemo(() => {
    const keys = new Set<string>();
    for (const type of types.values()) {
      keys.add((type.category ?? '__none__').toLowerCase());
    }
    return [...keys].sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });
  }, [types]);

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

      const hasHigherTier = type.tiers.some(t => {
        const n = tierNum(t);
        return n != null && n > targetNum;
      });

      if (!hasHigherTier) {
        noHigherCount += 1;
        continue;
      }

      const newTiers = type.tiers.filter(t => t !== tierModalTier);
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

  const savePendingChanges = async () => {
    if (!hasPending || savingPending) return;
    const parts: string[] = [];
    if (pendingMapProto) parts.push('mapgroupproto.xml');
    if (pendingTypeSources > 0) parts.push(`${pendingTypeSources} types.xml source file(s)`);

    const proceed = window.confirm(`Save pending changes?\n\nThis will write: ${parts.join(' + ')}`);
    if (!proceed) return;

    setSavingPending(true);
    setSaveStatus(null);
    try {
      if (pendingMapProto) await saveMapGroupProto();
      const sources = [...dirty.typesSources];
      for (const source of sources) {
        await saveTypesSource(source);
      }
      setSaveStatus('Pending changes saved.');
    } catch {
      setSaveStatus('Failed to save pending changes.');
    } finally {
      setSavingPending(false);
    }
  };


  return (
    <div className="relative text-xs w-80 max-h-[480px] overflow-y-auto">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-mono font-semibold text-slate-100 break-all">{building.typeName}</p>
        <span className="text-slate-500 whitespace-nowrap">lootmax {building.lootmax}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {tiers.map(t => (
          <span
            key={t}
            className="px-1.5 py-0.5 rounded text-white text-xs font-semibold"
            style={{ backgroundColor: TIER_COLORS[t] ?? TIER_COLORS.unknown }}
          >{t}</span>
        ))}
        {building.usages.length > 0 && (
          <span className="text-slate-400">{building.usages.join(' · ')}</span>
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
            onClick={() => { void savePendingChanges(); }}
            disabled={!hasPending || savingPending}
            className="px-2 py-0.5 rounded border border-indigo-700/70 bg-indigo-900/40 text-indigo-300 disabled:opacity-50"
            title="Save all pending XML changes"
          >
            {savingPending ? 'Saving...' : 'Save Pending'}
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
              autoExpand={!!categoryFilter && cat === categoryFilter}
              onBlockCategory={(category) => { void handleRemoveCategory(category); }}
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
