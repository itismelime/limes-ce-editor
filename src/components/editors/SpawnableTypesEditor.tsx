import { useMemo, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import type { SpawnableType } from '../../types/dayz';

function ItemList({ items, label }: { items: { name: string; chance: number }[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-slate-600 uppercase tracking-wider font-semibold mb-1">{label}</p>
      {items.map(item => (
        <div key={item.name} className="flex items-center justify-between py-0.5">
          <span className="font-mono text-xs text-slate-300 truncate">{item.name}</span>
          <span className="text-xs text-slate-500 ml-2 flex-shrink-0">{(item.chance * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function SpawnableTypesEditor() {
  const mission = useServerStore(s => s.mission)!;
  const saveSpawnableTypes = useServerStore(s => s.saveSpawnableTypes);
  const isDirty = useServerStore(s => s.dirty.spawnableTypes);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const allTypes = useMemo(() => Array.from(mission.spawnableTypes.values()), [mission.spawnableTypes]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return allTypes.filter(t => !q || t.name.toLowerCase().includes(q));
  }, [allTypes, filter]);

  const selectedType: SpawnableType | null = selected ? (mission.spawnableTypes.get(selected) ?? null) : null;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex-1 max-w-xs">
            <SearchBar value={filter} onChange={setFilter} placeholder="Search spawnable types…" />
          </div>
          <span className="text-xs text-slate-600">{filtered.length} / {allTypes.length}</span>
          <SaveButton isDirty={isDirty} onSave={saveSpawnableTypes} label="Save cfgspawnabletypes.xml" />
        </div>

        <div className="flex items-center gap-4 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50">
          <span className="flex-1">Type Name</span>
          <span className="w-24 text-center">Cargo Groups</span>
          <span className="w-24 text-center">Attachment Groups</span>
          <span className="w-24 text-center">Total Items</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(st => {
            const totalItems =
              st.cargo.reduce((s, c) => s + c.items.length, 0) +
              st.attachments.reduce((s, a) => s + a.items.length, 0);
            return (
              <div
                key={st.name}
                onClick={() => setSelected(selected === st.name ? null : st.name)}
                className={`flex items-center gap-4 px-4 py-2.5 border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/50 transition-colors text-sm ${
                  selected === st.name ? 'bg-indigo-950/40 border-l-2 border-l-indigo-500' : ''
                }`}
              >
                <span className="flex-1 font-mono text-xs text-slate-300 truncate">{st.name}</span>
                <span className="w-24 text-center text-xs text-slate-500">{st.cargo.length}</span>
                <span className="w-24 text-center text-xs text-slate-500">{st.attachments.length}</span>
                <span className="w-24 text-center text-xs text-slate-500">{totalItems}</span>
              </div>
            );
          })}
        </div>
      </div>

      {selectedType && (
        <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="font-mono text-sm text-slate-200 truncate">{selectedType.name}</span>
            <button onClick={() => setSelected(null)} className="text-slate-600 hover:text-slate-400 text-lg">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedType.cargo.map((cargo, i) => (
              <div key={i} className="bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-400">Cargo Group {i + 1}</span>
                  <span className="text-xs text-slate-600">chance: {(cargo.chance * 100).toFixed(0)}%</span>
                </div>
                <ItemList items={cargo.items} label="Items" />
              </div>
            ))}
            {selectedType.attachments.map((att, i) => (
              <div key={i} className="bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-400">Attachments Group {i + 1}</span>
                  <span className="text-xs text-slate-600">chance: {(att.chance * 100).toFixed(0)}%</span>
                </div>
                <ItemList items={att.items} label="Items" />
              </div>
            ))}
            {selectedType.cargo.length === 0 && selectedType.attachments.length === 0 && (
              <p className="text-xs text-slate-600 italic">No cargo or attachments defined.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
