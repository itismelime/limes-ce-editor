import { useEffect, useMemo, useState } from 'react';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { SearchBar } from '../shared/SearchBar';
import { SaveButton } from '../shared/SaveButton';
import { SELECTED_ROW_CLASS, CloseButton } from '../shared/ui';
import type { FFSpawnPoint } from '../../types/ffSpawnSelector';

const SECTION_LABELS: Record<string, string> = {
  fresh: 'Fresh Spawn',
  respawn: 'Respawn',
};

function label(type: string) {
  return SECTION_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function FFNumberField({ label, value, onChange, step }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={e => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 text-right focus:outline-none focus:border-lime-500"
      />
    </div>
  );
}

function FFCheckboxField({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-lime-500" />
      <span className="text-xs text-slate-300">{label}</span>
    </label>
  );
}

function FFSettingsSection() {
  const ffSettings = useServerStore(s => s.ffSettings);
  const updateFfSettings = useServerStore(s => s.updateFfSettings);
  const saveFfSettings = useServerStore(s => s.saveFfSettings);
  const isDirty = useServerStore(s => s.dirty.ffSettings);
  const [open, setOpen] = useState(false);

  if (!ffSettings) return null;
  const patch = (p: Partial<typeof ffSettings>) => updateFfSettings({ ...ffSettings, ...p });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-800 text-left"
      >
        <h3 className="text-sm font-semibold text-slate-200">FF Spawn Selector Settings</h3>
        <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-4" onClick={e => e.stopPropagation()}>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Spawn Types</p>
            <div className="grid grid-cols-2 gap-2">
              <FFCheckboxField label="Enabled" checked={ffSettings.enabled === 1} onChange={v => patch({ enabled: v ? 1 : 0 })} />
              <FFCheckboxField label="Defer to Expansion" checked={ffSettings.deferToExpansionSpawnSelection === 1} onChange={v => patch({ deferToExpansionSpawnSelection: v ? 1 : 0 })} />
              <FFCheckboxField label="Force Takeover Expansion" checked={ffSettings.forceTakeoverExpansion === 1} onChange={v => patch({ forceTakeoverExpansion: v ? 1 : 0 })} />
              <FFCheckboxField label="Allow Random Spawn" checked={ffSettings.allowRandomSpawn === 1} onChange={v => patch({ allowRandomSpawn: v ? 1 : 0 })} />
              <FFCheckboxField label="Allow Sleeping Bag Spawn" checked={ffSettings.allowSleepingBagSpawn === 1} onChange={v => patch({ allowSleepingBagSpawn: v ? 1 : 0 })} />
              <FFCheckboxField label="Allow Group Base Spawn" checked={ffSettings.allowGroupBaseSpawn === 1} onChange={v => patch({ allowGroupBaseSpawn: v ? 1 : 0 })} />
              <FFCheckboxField label="Require Group Leader" checked={ffSettings.requireGroupLeaderForGroupSpawn === 1} onChange={v => patch({ requireGroupLeaderForGroupSpawn: v ? 1 : 0 })} />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Cooldowns (seconds)</p>
            <div className="grid grid-cols-2 gap-2">
              <FFNumberField label="Random Spawn" value={ffSettings.randomSpawnCooldown} onChange={v => patch({ randomSpawnCooldown: v })} />
              <FFNumberField label="Sleeping Bag" value={ffSettings.sleepingBagCooldown} onChange={v => patch({ sleepingBagCooldown: v })} />
              <FFNumberField label="Group Base" value={ffSettings.groupBaseCooldown} onChange={v => patch({ groupBaseCooldown: v })} />
              <FFNumberField label="Named Point" value={ffSettings.namedPointCooldown} onChange={v => patch({ namedPointCooldown: v })} />
              <FFNumberField label="Max Sleeping Bags / Player" value={ffSettings.maxSleepingBagsPerPlayer} onChange={v => patch({ maxSleepingBagsPerPlayer: v })} />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Spawn Safety</p>
            <div className="grid grid-cols-2 gap-2">
              <FFNumberField label="Min Dist From Players (m)" value={ffSettings.minDistanceFromPlayers} onChange={v => patch({ minDistanceFromPlayers: v })} />
              <FFNumberField label="Min Dist From Zombies (m)" value={ffSettings.minDistanceFromZombies} onChange={v => patch({ minDistanceFromZombies: v })} />
              <FFNumberField label="Max Safety Retries" value={ffSettings.maxSafetyRetries} onChange={v => patch({ maxSafetyRetries: v })} />
              <FFNumberField label="Selection Timeout (s)" value={ffSettings.selectionTimeoutSeconds} onChange={v => patch({ selectionTimeoutSeconds: v })} />
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">Limbo Position</p>
            <div className="grid grid-cols-3 gap-2">
              <FFNumberField label="X" value={ffSettings.limboPosX} onChange={v => patch({ limboPosX: v })} step={0.1} />
              <FFNumberField label="Y" value={ffSettings.limboPosY} onChange={v => patch({ limboPosY: v })} step={0.1} />
              <FFNumberField label="Z" value={ffSettings.limboPosZ} onChange={v => patch({ limboPosZ: v })} step={0.1} />
            </div>
          </div>

          <div className="flex justify-end">
            <SaveButton isDirty={isDirty} onSave={saveFfSettings} label="Save Settings.json" />
          </div>
        </div>
      )}
    </div>
  );
}

function FFSpawnPointDetail({ point, onUpdate, onDelete, onClose }: {
  point: FFSpawnPoint;
  onUpdate: (patch: Partial<FFSpawnPoint>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(point.name);
  const [x, setX] = useState(String(point.x));
  const [y, setY] = useState(String(point.y));
  const [z, setZ] = useState(String(point.z));

  useEffect(() => {
    setName(point.name);
    setX(String(point.x));
    setY(String(point.y));
    setZ(String(point.z));
  }, [point.name, point.x, point.y, point.z]);

  const commitName = () => { if (name.trim()) onUpdate({ name: name.trim() }); else setName(point.name); };
  const commitCoord = (field: 'x' | 'y' | 'z', raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isNaN(v)) onUpdate({ [field]: v });
  };

  return (
    <div className="w-72 border-l border-slate-800 bg-slate-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-slate-200">Spawn Point</span>
        <CloseButton onClick={onClose} />
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitName}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-lime-500"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-slate-500 block mb-1">X</label>
            <input value={x} onChange={e => setX(e.target.value)} onBlur={() => commitCoord('x', x)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-lime-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Y</label>
            <input value={y} onChange={e => setY(e.target.value)} onBlur={() => commitCoord('y', y)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-lime-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Z</label>
            <input value={z} onChange={e => setZ(e.target.value)} onBlur={() => commitCoord('z', z)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-lime-500" />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={point.enabled === 1} onChange={e => onUpdate({ enabled: e.target.checked ? 1 : 0 })} className="accent-lime-500" />
          <span className="text-sm text-slate-300">Enabled</span>
        </label>
        <button
          onClick={onDelete}
          className="w-full h-9 rounded-lg text-xs font-medium border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:bg-rose-900/70 transition-colors"
        >
          Delete Spawn Point
        </button>
      </div>
    </div>
  );
}

function FFSpawnPointsSection() {
  const ffSpawnPoints = useServerStore(s => s.ffSpawnPoints);
  const updateFfSpawnPoints = useServerStore(s => s.updateFfSpawnPoints);
  const saveFfSpawnPoints = useServerStore(s => s.saveFfSpawnPoints);
  const isDirty = useServerStore(s => s.dirty.ffSpawnPoints);
  const selected = useUiStore(s => s.selectedFFSpawnPointName);
  const setSelected = useUiStore(s => s.setSelectedFFSpawnPoint);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!ffSpawnPoints) return [];
    const q = filter.toLowerCase();
    return ffSpawnPoints.spawnPoints.filter(p => !q || p.name.toLowerCase().includes(q));
  }, [ffSpawnPoints, filter]);

  if (!ffSpawnPoints) return null;
  const selectedPoint = selected ? ffSpawnPoints.spawnPoints.find(p => p.name === selected) ?? null : null;

  const updatePoint = (name: string, patch: Partial<FFSpawnPoint>) => {
    updateFfSpawnPoints({
      ...ffSpawnPoints,
      spawnPoints: ffSpawnPoints.spawnPoints.map(p => p.name === name ? { ...p, ...patch } : p),
    });
    if (patch.name && selected === name) setSelected(patch.name);
  };

  const deletePoint = (name: string) => {
    updateFfSpawnPoints({ ...ffSpawnPoints, spawnPoints: ffSpawnPoints.spawnPoints.filter(p => p.name !== name) });
    if (selected === name) setSelected(null);
  };

  const addPoint = () => {
    const existingNames = new Set(ffSpawnPoints.spawnPoints.map(p => p.name));
    let n = ffSpawnPoints.spawnPoints.length + 1;
    let name = `New Point ${n}`;
    while (existingNames.has(name)) { n += 1; name = `New Point ${n}`; }
    updateFfSpawnPoints({ ...ffSpawnPoints, spawnPoints: [...ffSpawnPoints.spawnPoints, { version: 0, name, x: 0, y: 0, z: 0, enabled: 1 }] });
    setSelected(name);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">FF Spawn Points</h3>
          <p className="text-xs text-slate-500 mt-0.5">{ffSpawnPoints.spawnPoints.length} point{ffSpawnPoints.spawnPoints.length !== 1 ? 's' : ''} — overrides vanilla spawn behavior</p>
        </div>
        <SaveButton isDirty={isDirty} onSave={saveFfSpawnPoints} label="Save SpawnPoints.json" />
      </div>

      <div className="flex" style={{ height: 320 }}>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchBar value={filter} onChange={setFilter} placeholder="Search spawn points…" />
              </div>
              <button
                onClick={addPoint}
                className="h-8 px-3 rounded-lg text-xs bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors whitespace-nowrap"
              >
                + Add Point
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-500 italic px-4 py-3">No spawn points</p>
            ) : (
              filtered.map(p => (
                <div
                  key={p.name}
                  onClick={() => setSelected(selected === p.name ? null : p.name)}
                  className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-slate-800 transition-colors border-b border-slate-800/50 ${selected === p.name ? SELECTED_ROW_CLASS : ''} ${p.enabled === 0 ? 'opacity-50' : ''}`}
                >
                  <span className="flex-1 truncate text-slate-200">{p.name}</span>
                  <span className="text-xs font-mono text-slate-500">{p.x.toFixed(0)}, {p.z.toFixed(0)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        {selectedPoint && (
          <FFSpawnPointDetail
            point={selectedPoint}
            onUpdate={patch => updatePoint(selectedPoint.name, patch)}
            onDelete={() => deletePoint(selectedPoint.name)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

export function PlayerSpawnsEditor() {
  const playerSpawnData = useServerStore(s => s.playerSpawnData);
  const ffSpawnPoints = useServerStore(s => s.ffSpawnPoints);
  const setActiveTab    = useUiStore(s => s.setActiveTab);

  const hasFF = ffSpawnPoints !== null;

  if (!playerSpawnData || playerSpawnData.sections.length === 0) {
    if (!hasFF) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <p className="text-slate-400 text-sm">No cfgplayerspawnpoints.xml found in the loaded mission.</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">Player Spawn Points</h2>
          <p className="text-xs text-slate-500 mt-0.5">No cfgplayerspawnpoints.xml found — showing FF Spawn Selector only</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <FFSettingsSection />
          <FFSpawnPointsSection />
        </div>
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
          className="text-xs px-3 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-600 text-white transition-colors"
        >
          Show on map →
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {hasFF && (
          <>
            <FFSettingsSection />
            <FFSpawnPointsSection />
            <div className="border-t border-slate-800 pt-1" />
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Vanilla Spawn Points (read only, overridden by FF Spawn Selector)</p>
          </>
        )}
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
                        <td className="px-3 py-1 text-slate-500">{i + 1}</td>
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
