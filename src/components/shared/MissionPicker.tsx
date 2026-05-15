import type { MissionFiles } from '../../lib/fileDiscovery';

interface Props {
  missions: MissionFiles[];
  onSelect: (mission: MissionFiles) => void;
  onCancel: () => void;
}

const FILE_ICONS: Record<string, string> = {
  typesPath:          '🎒',
  eventSpawnsPath:    '📍',
  eventsPath:         '⚡',
  spawnableTypesPath: '📦',
};

const FILE_LABELS: Record<string, string> = {
  typesPath:          'types.xml',
  eventSpawnsPath:    'cfgeventspawns.xml',
  eventsPath:         'events.xml',
  spawnableTypesPath: 'cfgspawnabletypes.xml',
};

export function MissionPicker({ missions, onSelect, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="px-6 py-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-slate-100">Select a Mission</h2>
          <p className="text-sm text-slate-500 mt-1">
            Multiple mission folders were found. Choose which one to load.
          </p>
        </div>

        <div className="p-3 max-h-96 overflow-y-auto space-y-2">
          {missions.map(m => {
            const fileKeys = ['typesPath', 'eventSpawnsPath', 'eventsPath', 'spawnableTypesPath'] as const;
            const foundCount = fileKeys.filter(k => m[k] !== null).length;

            return (
              <button
                key={m.missionPath}
                onClick={() => onSelect(m)}
                className="w-full text-left bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 hover:border-lime-500 rounded-xl p-4 transition-all group"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="font-mono text-sm text-slate-200 group-hover:text-lime-300 transition-colors">
                    {m.missionName}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    foundCount === 4
                      ? 'bg-green-900/40 text-green-400'
                      : foundCount > 0
                      ? 'bg-amber-900/40 text-amber-400'
                      : 'bg-slate-700 text-slate-500'
                  }`}>
                    {foundCount}/4 files
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {fileKeys.map(key => (
                    <span
                      key={key}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                        m[key]
                          ? 'bg-slate-700 text-slate-300'
                          : 'bg-slate-800/40 text-slate-600 line-through'
                      }`}
                    >
                      <span>{FILE_ICONS[key]}</span>
                      {FILE_LABELS[key]}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-slate-500 mt-2 truncate" title={m.missionPath}>
                  {m.missionPath}
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
