import { useMemo, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import { NumberInput } from '../shared/NumberInput';
import type { DayZType } from '../../types/dayz';
import { TIER_COLORS } from '../../types/map';

const TIER_OPTIONS = ['Tier1', 'Tier2', 'Tier3', 'Tier4'];

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

function TypeRow({
  type,
  isSelected,
  onSelect,
  onUpdate,
}: {
  type: DayZType;
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

      <span className="w-24 text-slate-500 text-xs truncate">{type.category ?? '—'}</span>

      <div className="flex gap-1 w-32">
        {type.tiers.map(t => <TierBadge key={t} tier={t} />)}
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

function DetailPanel({ type, onUpdate, onClose }: {
  type: DayZType;
  onUpdate: (patch: Partial<DayZType>) => void;
  onClose: () => void;
}) {
  const toggleTier = (tier: string) => {
    const tiers = type.tiers.includes(tier)
      ? type.tiers.filter(t => t !== tier)
      : [...type.tiers, tier];
    onUpdate({ tiers });
  };

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="font-mono text-sm text-slate-200 truncate">{type.name}</span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-400 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Quantities</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Nominal', key: 'nominal' as const },
              { label: 'Min', key: 'min' as const },
              { label: 'Lifetime (s)', key: 'lifetime' as const },
              { label: 'Restock (s)', key: 'restock' as const },
              { label: 'Quant Min', key: 'quantmin' as const },
              { label: 'Quant Max', key: 'quantmax' as const },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="text-xs text-slate-500 block mb-1">{label}</label>
                <NumberInput
                  value={type[key]}
                  onChange={v => onUpdate({ [key]: v })}
                  min={key === 'quantmin' ? -1 : 0}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tiers</p>
          <div className="flex flex-wrap gap-2">
            {TIER_OPTIONS.map(tier => {
              const active = type.tiers.includes(tier);
              const color = TIER_COLORS[tier];
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

        {type.usages.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Usage Zones</p>
            <div className="flex flex-wrap gap-1">
              {type.usages.map(u => (
                <span key={u} className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{u}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TypesEditor() {
  const mission = useServerStore(s => s.mission)!;
  const updateType = useServerStore(s => s.updateType);
  const saveTypes = useServerStore(s => s.saveTypes);
  const isDirty = useServerStore(s => s.dirty.types);
  const typeFilter = useUiStore(s => s.typeFilter);
  const setTypeFilter = useUiStore(s => s.setTypeFilter);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('');
  const parentRef = useRef<HTMLDivElement>(null);

  const allTypes = useMemo(() => Array.from(mission.types.values()), [mission.types]);

  const filtered = useMemo(() => {
    const q = typeFilter.toLowerCase();
    return allTypes.filter(t => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q) || t.category?.toLowerCase().includes(q);
      const matchesTier = !tierFilter || t.tiers.includes(tierFilter);
      return matchesSearch && matchesTier;
    });
  }, [allTypes, typeFilter, tierFilter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const selectedType = selectedName ? mission.types.get(selectedName) : null;

  const handleUpdate = useCallback((name: string, patch: Partial<DayZType>) => {
    updateType(name, patch);
  }, [updateType]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex-1 max-w-xs">
            <SearchBar value={typeFilter} onChange={setTypeFilter} placeholder="Search items…" />
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

          <span className="text-xs text-slate-600">{filtered.length} / {allTypes.length}</span>
          <SaveButton isDirty={isDirty} onSave={saveTypes} label="Save types.xml" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50">
          <span className="w-52">Name</span>
          <span className="w-24">Category</span>
          <span className="w-32">Tiers</span>
          <span>Min / Nominal</span>
          <span className="ml-auto">Flags</span>
        </div>

        {/* Virtual list */}
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vi => {
              const t = filtered[vi.index];
              return (
                <div
                  key={t.name}
                  style={{ position: 'absolute', top: vi.start, width: '100%' }}
                >
                  <TypeRow
                    type={t}
                    isSelected={selectedName === t.name}
                    onSelect={() => setSelectedName(selectedName === t.name ? null : t.name)}
                    onUpdate={patch => handleUpdate(t.name, patch)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedType && (
        <DetailPanel
          type={selectedType}
          onUpdate={patch => handleUpdate(selectedType.name, patch)}
          onClose={() => setSelectedName(null)}
        />
      )}
    </div>
  );
}
