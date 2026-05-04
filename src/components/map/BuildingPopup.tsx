import { useMemo, useState } from 'react';
import type { BuildingInstance, SpawnableType, DayZType } from '../../types/dayz';
import { TIER_COLORS } from '../../types/map';
import { CATEGORY_LABELS, CATEGORY_ORDER, displayCategory, buildAttachmentNames } from '../../lib/itemClassifier';
import { useUiStore } from '../../store/uiStore';

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

function CategorySection({ label, items, autoExpand }: { label: string; items: DayZType[]; autoExpand?: boolean }) {
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
          <span className="text-slate-500 text-xs">{activeCount} active / {items.length}</span>
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
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
                      <div className="text-right flex-shrink-0 text-xs">
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


export function BuildingPopup({ building, spawnableTypes, types, tiers }: Props) {
  const categoryFilter  = useUiStore(s => s.categoryFilter);
  const attachmentNames = useMemo(() => buildAttachmentNames(spawnableTypes), [spawnableTypes]);

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

  // Group by derived display category
  const byCategory = useMemo(() => {
    const map = new Map<string, DayZType[]>();
    for (const item of allItems) {
      const key = displayCategory(item, attachmentNames);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [allItems]);

  // Sort category keys: known order first, then alphabetical unknowns, __none__ last
  const sortedCategories = useMemo(() => {
    const keys = [...byCategory.keys()];
    return keys.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });
  }, [byCategory]);


  return (
    <div className="text-xs w-80 max-h-[480px] overflow-y-auto">
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

      {building.containers.length === 0 ? (
        <p className="text-slate-600 italic">no container data</p>
      ) : (
        <>
          {sortedCategories.map(cat => (
            <CategorySection
              key={cat}
              label={cat === '__none__' ? 'Uncategorized' : (CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1))}
              items={byCategory.get(cat)!}
              autoExpand={!!categoryFilter && cat === categoryFilter}
            />
          ))}
        </>
      )}
    </div>
  );
}
