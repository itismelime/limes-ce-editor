import { useMemo, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import { NumberInput } from '../shared/NumberInput';
import type { DayZEvent } from '../../types/dayz';
import { SELECTED_ROW_CLASS, CloseButton } from '../shared/ui';

function EventRow({
  event,
  isSelected,
  onSelect,
  onUpdate,
}: {
  event: DayZEvent;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<DayZEvent>) => void;
}) {
  return (
    <div
      className={`flex items-center gap-4 px-4 py-2.5 border-b border-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors text-sm ${
        isSelected ? SELECTED_ROW_CLASS : ''
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 w-64">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${event.active ? 'bg-green-500' : 'bg-slate-600'}`}
        />
        <span className="font-mono text-xs text-slate-300 truncate">{event.name}</span>
      </div>

      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <span className="text-xs text-slate-500 w-8">min</span>
        <NumberInput value={event.min} onChange={v => onUpdate({ min: v })} min={0} />
        <span className="text-xs text-slate-500 w-12 ml-1">nominal</span>
        <NumberInput value={event.nominal} onChange={v => onUpdate({ nominal: v })} min={0} />
        <span className="text-xs text-slate-500 w-8 ml-1">max</span>
        <NumberInput value={event.max} onChange={v => onUpdate({ max: v })} min={0} />
      </div>

      <div className="ml-auto flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <span className="text-xs text-slate-500">
          {event.children.length} child{event.children.length !== 1 ? 'ren' : ''}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={event.active === 1}
            onChange={e => onUpdate({ active: e.target.checked ? 1 : 0 })}
            className="accent-green-500"
          />
          Active
        </label>
      </div>
    </div>
  );
}

export function EventsEditor() {
  const events = useServerStore(s => s.mission!.events);
  const updateEvent = useServerStore(s => s.updateEvent);
  const saveEvents = useServerStore(s => s.saveEvents);
  const isDirty = useServerStore(s => s.dirty.events);
  const eventFilter = useUiStore(s => s.eventFilter);
  const setEventFilter = useUiStore(s => s.setEventFilter);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(true);

  const allEvents = useMemo(() => Array.from(events.values()), [events]);

  const filtered = useMemo(() => {
    const q = eventFilter.toLowerCase();
    return allEvents.filter(e => {
      const matchesSearch = !q || e.name.toLowerCase().includes(q);
      const matchesActive = showInactive || e.active === 1;
      return matchesSearch && matchesActive;
    });
  }, [allEvents, eventFilter, showInactive]);

  const selectedEvent = selectedName ? events.get(selectedName) : null;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex-1 max-w-xs">
            <SearchBar value={eventFilter} onChange={setEventFilter} placeholder="Search events…" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-lime-500" />
            Show inactive
          </label>
          <span className="text-xs text-slate-500">{filtered.length} / {allEvents.length}</span>
          <SaveButton isDirty={isDirty} onSave={saveEvents} label="Save events.xml" />
        </div>

        <div className="flex items-center gap-4 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 bg-slate-900/50">
          <span className="w-64">Event Name</span>
          <span>Min / Nominal / Max</span>
          <span className="ml-auto">Status</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(event => (
            <EventRow
              key={event.name}
              event={event}
              isSelected={selectedName === event.name}
              onSelect={() => setSelectedName(selectedName === event.name ? null : event.name)}
              onUpdate={patch => updateEvent(event.name, patch)}
            />
          ))}
        </div>
      </div>

      {selectedEvent && (
        <div className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="font-mono text-sm text-slate-200 truncate">{selectedEvent.name}</span>
            <CloseButton onClick={() => setSelectedName(null)} />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Spawn Counts</p>
              <div className="grid grid-cols-3 gap-2">
                {(['min', 'nominal', 'max'] as const).map(key => (
                  <div key={key}>
                    <label className="text-xs text-slate-500 block mb-1 capitalize">{key}</label>
                    <NumberInput value={selectedEvent[key]} onChange={v => updateEvent(selectedEvent.name, { [key]: v })} min={0} className="w-full" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Timing</p>
              <div className="grid grid-cols-2 gap-2">
                {([['lifetime', 'Lifetime (s)'], ['restock', 'Restock (s)'], ['saferadius', 'Safe Radius'], ['cleanupradius', 'Cleanup Radius']] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="text-xs text-slate-500 block mb-1">{label}</label>
                    <NumberInput value={selectedEvent[key as keyof DayZEvent] as number} onChange={v => updateEvent(selectedEvent.name, { [key]: v })} min={0} className="w-full" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Children ({selectedEvent.children.length})</p>
              <div className="space-y-1">
                {selectedEvent.children.map((child, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-800 rounded px-2 py-1.5">
                    <span className="font-mono text-xs text-slate-300 truncate">{child.type}</span>
                    <span className="text-xs text-slate-500">{child.min}–{child.max}</span>
                  </div>
                ))}
                {selectedEvent.children.length === 0 && (
                  <p className="text-xs text-slate-500 italic">No children defined</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
