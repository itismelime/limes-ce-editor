import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';

const SECTION_LABELS: Record<string, string> = {
  fresh: 'Fresh Spawn',
  respawn: 'Respawn',
};

function label(type: string) {
  return SECTION_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function PlayerSpawnsEditor() {
  const playerSpawnData = useServerStore(s => s.playerSpawnData);
  const setActiveTab    = useUiStore(s => s.setActiveTab);

  if (!playerSpawnData || playerSpawnData.sections.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
        <p className="text-slate-400 text-sm">No cfgplayerspawnpoints.xml found in the loaded mission.</p>
      </div>
    );
  }

  const totalPoints = playerSpawnData.sections.reduce((n, s) => n + s.points.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Player Spawn Points</h2>
          <p className="text-xs text-slate-500 mt-0.5">{totalPoints} spawn bubbles across {playerSpawnData.sections.length} section{playerSpawnData.sections.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setActiveTab('map')}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          Show on map →
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {playerSpawnData.sections.map(section => (
          <div key={section.type} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-200">{label(section.type)}</h3>
              <span className="text-xs text-slate-500">{section.points.length} spawn bubbles</span>
            </div>

            <div className="px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
              <div className="col-span-2 text-slate-500 uppercase tracking-wider text-xs font-semibold mb-1">Spawn Parameters</div>
              <Row label="Min dist from infected" value={`${section.minDistInfected} m`} />
              <Row label="Max dist from infected" value={`${section.maxDistInfected} m`} />
              <Row label="Min dist from player"   value={`${section.minDistPlayer} m`} />
              <Row label="Max dist from player"   value={`${section.maxDistPlayer} m`} />

              <div className="col-span-2 text-slate-500 uppercase tracking-wider text-xs font-semibold mt-3 mb-1">Generator Parameters</div>
              <Row label="Grid density" value={String(section.gridDensity)} />
              <Row label="Grid width"   value={`${section.gridWidth} m`} />
              <Row label="Grid height"  value={`${section.gridHeight} m`} />
            </div>

            <div className="px-4 pb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Spawn Bubble Positions</p>
              <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-auto max-h-48">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-3 py-1.5 text-slate-500 font-medium w-8">#</th>
                      <th className="text-left px-3 py-1.5 text-slate-500 font-medium">X</th>
                      <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Z</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.points.map((p, i) => (
                      <tr key={i} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                        <td className="px-3 py-1 text-slate-600">{i + 1}</td>
                        <td className="px-3 py-1 font-mono text-slate-300">{p.x.toFixed(2)}</td>
                        <td className="px-3 py-1 font-mono text-slate-300">{p.z.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-mono">{value}</span>
    </>
  );
}
