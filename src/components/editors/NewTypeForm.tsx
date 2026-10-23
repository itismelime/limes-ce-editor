import { useMemo, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { basename } from '../../lib/fileDiscovery';

/** "New item" control for the Loot Types header: adds a type to db/types.xml or a <ce> types file. */
export function NewTypeForm({ onCreated }: { onCreated: (name: string) => void }) {
  const typesPath = useServerStore(s => s.paths.typesPath);
  const types = useServerStore(s => s.mission?.types);
  const addType = useServerStore(s => s.addType);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');

  const sources = useMemo(() => {
    const set = new Set<string>(typesPath ? [typesPath] : []);
    for (const t of types?.values() ?? []) if (t.source) set.add(t.source);
    return [...set];
  }, [typesPath, types]);

  if (sources.length === 0) return null;

  const trimmed = name.trim();
  // Class names are identifiers; reject anything that would break the XML or the game.
  const invalid = trimmed !== '' && !/^[A-Za-z0-9_]+$/.test(trimmed);
  const exists = !!trimmed && !!types?.has(trimmed);

  const submit = () => {
    if (!trimmed || invalid || exists) return;
    if (addType(trimmed, source || sources[0])) {
      onCreated(trimmed);
      setName('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2 py-1 rounded text-xs bg-slate-800 text-slate-300 border border-slate-700 hover:border-lime-500 hover:text-lime-300 whitespace-nowrap"
        title="Add a new item (class name) to a types file"
      >
        + New item
      </button>
    );
  }

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="Class name, e.g. AKM"
        aria-label="New item class name"
        className={`w-40 bg-slate-800 border rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none ${invalid || exists ? 'border-rose-500' : 'border-slate-700 focus:border-lime-500'}`}
        title={invalid ? 'Letters, digits and _ only' : exists ? 'An item with this name already exists' : ''}
      />
      {sources.length > 1 && (
        <select
          value={source || sources[0]}
          onChange={e => setSource(e.target.value)}
          aria-label="Types file"
          className="bg-slate-800 border border-slate-700 rounded px-1 py-1 text-xs text-slate-300 max-w-40"
        >
          {sources.map(s => <option key={s} value={s}>{basename(s)}</option>)}
        </select>
      )}
      <button type="submit" disabled={!trimmed || invalid || exists} className="px-2 py-1 rounded text-xs bg-lime-600 text-white disabled:opacity-40">Add</button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 py-1 text-xs text-slate-500 hover:text-slate-300">Cancel</button>
    </form>
  );
}
