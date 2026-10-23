import { useMemo, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import type { EventSpawnDef, EventSpawnPos } from '../../types/dayz';

function PosRow({ pos, onUpdate, onDelete }: {
  pos: EventSpawnPos;
  onUpdate: (pos: EventSpawnPos) => void;
  onDelete: () => void;
}) {
  const [x, setX] = useState(pos.rawX ?? String(pos.x));
  const [z, setZ] = useState(pos.rawZ ?? String(pos.z));
  const [syncedPos, setSyncedPos] = useState(pos);

  if (pos.rawX !== syncedPos.rawX || pos.rawZ !== syncedPos.rawZ || pos.x !== syncedPos.x || pos.z !== syncedPos.z) {
    setSyncedPos(pos);
    setX(pos.rawX ?? String(pos.x));
    setZ(pos.rawZ ?? String(pos.z));
  }

  const commit = () => {
    const nx = parseFloat(x);
    const nz = parseFloat(z);
    if (isNaN(nx) || isNaN(nz)) return;
    if (x.trim() === (pos.rawX ?? String(pos.x)) && z.trim() === (pos.rawZ ?? String(pos.z))) return; // focus/blur only
    // keep y, a and any other attributes of the <pos>
    onUpdate({ ...pos, x: nx, z: nz, rawX: x.trim(), rawZ: z.trim() });
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-slate-500 w-4">X</span>
      <input
        value={x}
        onChange={e => setX(e.target.value)}
        onBlur={commit}
        className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-lime-500"
      />
      <span className="text-xs text-slate-500 w-4">Z</span>
      <input
        value={z}
        onChange={e => setZ(e.target.value)}
        onBlur={commit}
        className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-lime-500"
      />
      <button onClick={onDelete} className="ml-auto flex items-center justify-center w-5 h-5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-700 transition-colors">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function EventSpawnsEditor() {
  const eventSpawns = useServerStore(s => s.mission!.eventSpawns);
  const setEventSpawns = useServerStore(s => s.setEventSpawns);
  const saveEventSpawns = useServerStore(s => s.saveEventSpawns);
  const isDirty = useServerStore(s => s.dirty.eventSpawns);
  const selectedEventName = useUiStore(s => s.selectedEventName);
  const setSelectedEvent = useUiStore(s => s.setSelectedEvent);
  const [filter, setFilter] = useState('');

  // Sync with map selection
  const [prevSelectedEventName, setPrevSelectedEventName] = useState(selectedEventName);
  if (selectedEventName !== prevSelectedEventName) {
    setPrevSelectedEventName(selectedEventName);
    if (selectedEventName) setFilter('');
  }

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return eventSpawns.filter(e =>
      !q || e.eventName.toLowerCase().includes(q)
    );
  }, [eventSpawns, filter]);

  const updatePos = (eventName: string, idx: number, pos: EventSpawnPos) => {
    const next = eventSpawns.map(e => {
      if (e.eventName !== eventName) return e;
      const positions = [...e.positions];
      positions[idx] = pos;
      return { ...e, positions };
    });
    setEventSpawns(next);
  };

  const deletePos = (eventName: string, idx: number) => {
    const next = eventSpawns.map(e => {
      if (e.eventName !== eventName) return e;
      return { ...e, positions: e.positions.filter((_, i) => i !== idx) };
    });
    setEventSpawns(next);
  };

  const addPos = (eventName: string) => {
    const next = eventSpawns.map(e => {
      if (e.eventName !== eventName) return e;
      return { ...e, positions: [...e.positions, { x: 0, z: 0, rawX: '0', rawZ: '0' }] };
    });
    setEventSpawns(next);
  };

  const displayList = selectedEventName
    ? filtered.filter(e => e.eventName === selectedEventName)
    : filtered;

  return (
    <div className="flex h-full">
      {/* Event list */}
      <div className="w-56 border-r border-slate-800 flex flex-col bg-slate-900">
        <div className="p-3 border-b border-slate-800">
          <SearchBar value={filter} onChange={setFilter} placeholder="Filter events…" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map(e => (
            <button
              key={e.eventName}
              onClick={() => setSelectedEvent(selectedEventName === e.eventName ? null : e.eventName)}
              className={`w-full text-left px-3 py-2 text-xs font-mono border-b border-slate-800/50 transition-colors ${
                selectedEventName === e.eventName
                  ? 'bg-lime-950/50 text-lime-300 border-l-2 border-l-lime-500'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="block truncate">{e.eventName}</span>
              <span className="text-slate-500">{e.positions.length} pts</span>
            </button>
          ))}
        </div>
      </div>

      {/* Positions panel */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <span className="text-sm text-slate-300 font-medium">
            {selectedEventName
              ? <>Editing: <span className="text-lime-400 font-mono">{selectedEventName}</span></>
              : 'All Spawn Points'
            }
          </span>
          {selectedEventName && (
            <button onClick={() => setSelectedEvent(null)} className="text-xs text-slate-500 hover:text-slate-300">
              ← Show all
            </button>
          )}
          <div className="ml-auto">
            <SaveButton isDirty={isDirty} onSave={saveEventSpawns} label="Save cfgeventspawns.xml" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {displayList.map((e: EventSpawnDef) => (
            <div key={e.eventName} className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-mono text-slate-300">{e.eventName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{e.positions.length} points</span>
                  <button
                    onClick={() => addPos(e.eventName)}
                    className="h-8 px-3 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                  >
                    + Add
                  </button>
                </div>
              </div>
              <div className="bg-slate-800/50 rounded-lg px-3 py-2 space-y-0.5">
                {e.positions.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-1">No positions defined</p>
                ) : (
                  e.positions.map((pos, idx) => (
                    <PosRow
                      key={idx}
                      pos={pos}
                      onUpdate={p => updatePos(e.eventName, idx, p)}
                      onDelete={() => deletePos(e.eventName, idx)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
