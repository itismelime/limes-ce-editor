import { useEffect, useMemo, useRef, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { NumberInput } from './NumberInput';
import { CloseButton } from './ui';
import { basename } from '../../lib/fileDiscovery';
import type { DayZType } from '../../types/dayz';
import { TIER_COLORS, tierOptions, getUsageColor, getUsageTextColor, formatUsageLabel } from '../../types/map';
import { CATEGORY_LABELS, CATEGORY_OPTIONS, displayCategory, buildAttachmentNames } from '../../lib/itemClassifier';


const FLAG_TOOLTIPS: Record<string, string> = {
  count_in_map: 'Count this item toward the map\'s total loot count',
  count_in_hoarder: 'Count this item when calculating hoarder limits',
  count_in_cargo: 'Count this item when it is stored inside a container',
  count_in_player: 'Count this item when carried by a player',
  crafted: 'Item is craftable — affects how it is counted and tracked',
  deloot: 'Dynamic loot — spawns only in dynamic (infected/event) zones, not static locations',
};

export function TypeDetailPanel({
  type,
  onUpdate,
  onClose,
  allUsages,
  attachmentNames,
  categoryOverrides,
  setCategoryOverride,
  clearCategoryOverride,
  className = 'w-80 border-l border-slate-800 bg-slate-900 flex flex-col',
}: {
  type: DayZType;
  onUpdate: (patch: Partial<DayZType>) => void;
  onClose: () => void;
  allUsages: string[];
  attachmentNames: Set<string>;
  categoryOverrides: Record<string, string>;
  setCategoryOverride: (typeName: string, category: string) => void;
  clearCategoryOverride: (typeName: string) => void;
  className?: string;
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

  const [prevAddUsageSearch, setPrevAddUsageSearch] = useState(addUsageSearch);
  if (addUsageSearch !== prevAddUsageSearch) {
    setPrevAddUsageSearch(addUsageSearch);
    const trimmed = addUsageSearch.trim();
    if (trimmed) setPendingUsageColor(getUsageColor(trimmed));
  }

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
  const deleteType = useServerStore(s => s.deleteType);
  const limitsValues = useServerStore(s => s.limitsDefinition?.values);
  const TIER_OPTIONS = useMemo(() => tierOptions(limitsValues), [limitsValues]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex flex-col min-w-0 mr-2">
          <span className="font-mono text-sm text-slate-200 truncate">{type.name}</span>
          <span className="text-xs text-slate-500 truncate font-mono">{basename(type.source)}</span>
        </div>
        <CloseButton onClick={onClose} />
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

        <button
          onClick={() => {
            if (window.confirm(`Delete ${type.name} from ${basename(type.source)}? It is removed from the file when you save.`)) {
              deleteType(type.name);
              onClose();
            }
          }}
          className="w-full px-3 py-1.5 rounded text-xs text-rose-400 border border-rose-900/60 hover:bg-rose-950/40 hover:border-rose-700 transition-colors"
        >
          Delete item
        </button>
      </div>
    </div>
  );
}

// Store-connected variant for hosts outside the Types editor (e.g. the map
// view): derives every prop from the stores given just a type name.
export function ConnectedTypeDetailPanel({
  typeName,
  onClose,
  className,
}: {
  typeName: string;
  onClose: () => void;
  className?: string;
}) {
  const types = useServerStore(s => s.mission?.types);
  const spawnableTypes = useServerStore(s => s.mission?.spawnableTypes);
  const limitsDefinition = useServerStore(s => s.limitsDefinition);
  const updateType = useServerStore(s => s.updateType);
  const categoryOverrides = useUiStore(s => s.categoryOverrides);
  const setCategoryOverride = useUiStore(s => s.setCategoryOverride);
  const clearCategoryOverride = useUiStore(s => s.clearCategoryOverride);

  const attachmentNames = useMemo(() => buildAttachmentNames(spawnableTypes ?? new Map()), [spawnableTypes]);
  const allUsages = useMemo(() => {
    const s = new Set<string>();
    limitsDefinition?.usages.forEach(u => s.add(u));
    for (const t of types?.values() ?? []) t.usages.forEach(u => s.add(u));
    return [...s].sort();
  }, [types, limitsDefinition]);

  const type = types?.get(typeName);
  if (!type) return null;

  return (
    <TypeDetailPanel
      type={type}
      onUpdate={patch => updateType(typeName, patch)}
      onClose={onClose}
      allUsages={allUsages}
      attachmentNames={attachmentNames}
      categoryOverrides={categoryOverrides}
      setCategoryOverride={setCategoryOverride}
      clearCategoryOverride={clearCategoryOverride}
      className={className}
    />
  );
}
