import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import type { ActiveTab } from '../../store/uiStore';
import type { MapId } from '../../types/map';

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'map',           label: '🗺 Map' },
  { id: 'types',         label: '🎒 Loot Types' },
  { id: 'events',        label: '⚡ Events' },
  { id: 'spawns',        label: '📍 Event Spawn Points' },
  { id: 'playerSpawns', label: '🧍 Player Spawn Points' },
  { id: 'spawnableTypes', label: '📦 Spawnable Types' },
  { id: 'economy',       label: '⚙ Economy Core' },
];

const MAPS: { id: MapId; label: string }[] = [
  { id: 'namalsk',   label: 'Namalsk' },
  { id: 'chernarus', label: 'Chernarus+' },
  { id: 'livonia',   label: 'Livonia' },
  { id: 'sakhal',    label: 'Sakhal' },
  { id: 'custom',    label: 'Custom' },
];

export function TopBar({ onOpenFolder }: { onOpenFolder: () => void }) {
  const mission = useServerStore(s => s.mission);
  const dirty = useServerStore(s => s.dirty);
  const saveError = useServerStore(s => s.saveError);
  const saveStatus = useServerStore(s => s.saveStatus);
  const clearSaveError = useServerStore(s => s.clearSaveError);
  const { activeTab, setActiveTab, activeMap, setActiveMap, isLoading } = useUiStore();

  const hasDirty = dirty.typesSources.length > 0 || dirty.eventSpawns || dirty.events || dirty.spawnableTypes;

  return (
    <div className="flex flex-col bg-slate-900 border-b border-slate-800">
      {saveError && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-xs">
          <span className="flex-1">{saveError}</span>
          <button onClick={clearSaveError} className="text-red-400 hover:text-red-200 font-medium">Dismiss</button>
        </div>
      )}
      {/* Top row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center text-xs font-bold">DZ</div>
          <span className="font-semibold text-slate-200 text-sm">DayZ Loot Editor</span>
        </div>

        <button
          onClick={onOpenFolder}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {isLoading ? 'Loading…' : 'Open Server Folder'}
        </button>

        {mission && (
          <span className="text-slate-400 text-sm">
            <span className="text-slate-600 mr-1">Mission:</span>
            {mission.missionName}
            <span className="ml-2 text-slate-600">
              · {mission.types.size} items
              · {mission.eventSpawns.length} events
            </span>
          </span>
        )}

        {saveStatus === 'saving' && (
          <span className="ml-auto flex items-center gap-1.5 text-slate-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
            Saving…
          </span>
        )}
        {saveStatus === 'success' && (
          <span className="ml-auto flex items-center gap-1.5 text-green-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            Saved successfully
          </span>
        )}
        {saveStatus === 'idle' && hasDirty && (
          <span className="ml-auto flex items-center gap-1.5 text-amber-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Unsaved changes
          </span>
        )}

        {activeTab === 'map' && (
          <div className="ml-auto flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            {MAPS.map(m => (
              <button
                key={m.id}
                onClick={() => setActiveMap(m.id)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  activeMap === m.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab row */}
      <div className="flex gap-1 px-4 pb-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-indigo-400 border-indigo-500 bg-slate-800/50'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
