import { useEffect } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { useServerFolder } from '../../hooks/useServerFolder';
import { TopBar } from './TopBar';
import { MissionPicker } from '../shared/MissionPicker';
import { MapView } from '../map/MapView';
import { TypesEditor } from '../editors/TypesEditor';
import { EventsEditor } from '../editors/EventsEditor';
import { EventSpawnsEditor } from '../editors/EventSpawnsEditor';
import { SpawnableTypesEditor } from '../editors/SpawnableTypesEditor';

const FILE_DESCRIPTIONS: Record<string, string> = {
  'types.xml': 'Item spawn quantities, lifetime, flags and tiers',
  'cfgeventspawns.xml': 'Map coordinates for each spawn event',
  'events.xml': 'Event definitions and child loot groups',
  'cfgspawnabletypes.xml': 'Items that spawn inside containers',
};

function EmptyState() {
  const { loadError, loadWarnings } = useUiStore();
  const setLoadError = useUiStore(s => s.setLoadError);

  if (loadError === 'no_files_found') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">⚠️</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">No DayZ files found</h2>
          <p className="text-slate-500 text-sm max-w-md mb-4">
            The selected folder doesn't contain any recognizable DayZ loot files.
            Make sure you're opening the right directory.
          </p>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-left max-w-md mx-auto">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">What to look for</p>
            <div className="space-y-2">
              {Object.entries(FILE_DESCRIPTIONS).map(([file, desc]) => (
                <div key={file} className="flex gap-3">
                  <span className="font-mono text-xs text-indigo-400 w-44 flex-shrink-0">{file}</span>
                  <span className="text-xs text-slate-500">{desc}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-700">
              <p className="text-xs text-slate-500">
                These files are typically found in:<br />
                <span className="font-mono text-slate-400">mpmissions\&lt;mission_name&gt;\db\</span>
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setLoadError(null)}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          ← Try a different folder
        </button>
      </div>
    );
  }

  if (loadError === 'permission_denied') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">🔒</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">Permission denied</h2>
          <p className="text-slate-500 text-sm max-w-sm mb-4">
            The app doesn't have permission to read that folder.
          </p>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2 text-xs text-slate-400">
            <p>• Try running the app as Administrator</p>
            <p>• Or copy the server files to a folder in your Documents</p>
          </div>
        </div>
        <button onClick={() => setLoadError(null)} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Try again</button>
      </div>
    );
  }

  if (loadError?.startsWith('error:')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
        <div className="w-20 h-20 bg-red-900/30 rounded-2xl flex items-center justify-center text-4xl">💥</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">Failed to load</h2>
          <p className="text-slate-500 text-sm max-w-sm mb-3">An unexpected error occurred while reading the server folder.</p>
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 font-mono text-xs text-red-400 max-w-md text-left">
            {loadError.replace('error:', '')}
          </div>
        </div>
        <button onClick={() => setLoadError(null)} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Try again</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
      <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center text-4xl">🗺</div>
      <div>
        <h2 className="text-xl font-semibold text-slate-200 mb-2">No server loaded</h2>
        <p className="text-slate-500 text-sm max-w-sm">
          Click <span className="text-slate-300 font-medium">Open Server Folder</span> and select your DayZ server or mission directory.
          The app will automatically find your loot files.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-xs text-slate-600 max-w-md">
        {Object.keys(FILE_DESCRIPTIONS).map(f => (
          <span key={f} className="bg-slate-800 px-3 py-1 rounded-full">{f}</span>
        ))}
      </div>

      {loadWarnings.length > 0 && (
        <MissingFilesWarning warnings={loadWarnings} />
      )}
    </div>
  );
}

function MissingFilesWarning({ warnings }: { warnings: string[] }) {
  return (
    <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 max-w-md w-full text-left">
      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
        ⚠ Some files could not be loaded
      </p>
      <div className="space-y-2">
        {warnings.map(w => {
          const isParse = w.includes('parse error');
          const filename = w.replace(' (parse error)', '');
          const desc = FILE_DESCRIPTIONS[filename];
          return (
            <div key={w} className="flex gap-2">
              <span className="text-amber-600 flex-shrink-0">{isParse ? '💥' : '✗'}</span>
              <div>
                <span className="font-mono text-xs text-amber-300">{filename}</span>
                {isParse
                  ? <p className="text-xs text-slate-500">XML is malformed — check the file for syntax errors</p>
                  : <p className="text-xs text-slate-500">{desc ? `Not found — ${desc.toLowerCase()}` : 'Not found in the selected folder'}</p>
                }
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-600 mt-3 pt-2 border-t border-amber-900/30">
        The editor will still work with whatever files were found.
      </p>
    </div>
  );
}

export function AppShell() {
  const mission = useServerStore(s => s.mission);
  const dirty = useServerStore(s => s.dirty);
  const { activeTab, loadError, loadWarnings } = useUiStore();
  const { openFolder, pendingMissions, selectMission, cancelPicker } = useServerFolder();

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.values(dirty).some(Boolean)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const showNoFilesError = loadError === 'no_files_found' || loadError === 'permission_denied' || loadError?.startsWith('error:');

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      <TopBar onOpenFolder={openFolder} />
      {pendingMissions && (
        <MissionPicker
          missions={pendingMissions}
          onSelect={selectMission}
          onCancel={cancelPicker}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        {!mission || showNoFilesError ? (
          <EmptyState />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {loadWarnings.length > 0 && (
              <div className="bg-amber-900/20 border-b border-amber-800/40 px-4 py-2 flex items-center gap-3">
                <span className="text-amber-400 text-xs">⚠</span>
                <span className="text-amber-400 text-xs">
                  Missing files: <span className="font-mono">{loadWarnings.join(', ')}</span>
                  <span className="text-amber-600 ml-1">— those features will be empty</span>
                </span>
                <button
                  onClick={() => useUiStore.getState().setLoadWarnings([])}
                  className="ml-auto text-amber-800 hover:text-amber-600 text-sm"
                >
                  ×
                </button>
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'map'            && <MapView />}
              {activeTab === 'types'          && <TypesEditor />}
              {activeTab === 'events'         && <EventsEditor />}
              {activeTab === 'spawns'         && <EventSpawnsEditor />}
              {activeTab === 'spawnableTypes' && <SpawnableTypesEditor />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
