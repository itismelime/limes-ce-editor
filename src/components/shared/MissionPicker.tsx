import type { MissionFiles } from '../../lib/fileDiscovery';

interface Props {
  missions: MissionFiles[];
  onSelect: (mission: MissionFiles) => void;
  onCancel: () => void;
}

const TERRAIN_DISPLAY: Record<string, string> = {
  chernarusplus: 'Chernarus+',
  chernarus:     'Chernarus+',
  enoch:         'Livonia',
  livonia:       'Livonia',
  sakhal:        'Sakhal',
  nasdara:       'Nasdara',
  namalsk:       'Namalsk',
  deerisle:      'Deer Isle',
  alteria:       'Alteria',
  banov:         'Banov',
  esseker:       'Esseker',
  rostow:        'Rostow',
  takistanplus:  'Takistan+',
  takistan:      'Takistan',
};

function parseMissionName(name: string): string {
  const dot = name.indexOf('.');
  if (dot === -1) return name;
  const rawTerrain = name.slice(dot + 1).toLowerCase();
  return TERRAIN_DISPLAY[rawTerrain] ?? name.slice(dot + 1);
}

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

        <div className="p-3 max-h-96 overflow-y-auto space-y-1">
          {missions.map(m => {
            const terrain = parseMissionName(m.missionName);
            return (
              <button
                key={m.missionPath}
                onClick={() => onSelect(m)}
                className="w-full text-left rounded-lg px-3 py-2.5 border border-slate-700 hover:border-lime-500/50 hover:bg-lime-500/10 transition-colors group"
              >
                <span className="text-sm font-medium text-slate-200 group-hover:text-lime-400 transition-colors">
                  {terrain}
                </span>
                <p className="text-xs text-slate-600 group-hover:text-slate-400 font-mono mt-0.5 truncate transition-colors">
                  {m.missionName}
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
