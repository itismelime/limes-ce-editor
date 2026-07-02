import { useServerStore } from '../../store/serverStore';
import { useMemo, useState } from 'react';
import { SaveButton } from '../shared/SaveButton';
import { SELECTED_ROW_CLASS } from '../shared/ui';

type GameplaySectionKey = 'shock' | 'staminaCore' | 'staminaModifiers' | 'worldTemps';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function EditableNumberRow({
  label,
  value,
  onChange,
  hint,
  step,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  hint?: string;
  step?: number;
}) {
  return (
    <div className="rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{label}</span>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step ?? 0.01}
          onChange={e => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 text-right focus:outline-none focus:border-lime-500"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function GameplayEditor() {
  const gameplay = useServerStore(s => s.gameplay);
  const updateGameplay = useServerStore(s => s.updateGameplay);
  const saveGameplay = useServerStore(s => s.saveGameplay);
  const isDirty = useServerStore(s => s.dirty.gameplay);
  const [selectedSection, setSelectedSection] = useState<GameplaySectionKey>('staminaCore');

  if (!gameplay) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p>Gameplay data not loaded. Check if cfggameplay.json exists.</p>
      </div>
    );
  }

  const staminaData = gameplay.PlayerData?.StaminaData;
  const shockData = gameplay.PlayerData?.ShockHandlingData;
  const worldsData = gameplay.WorldsData;

  const sectionAvailability = useMemo(() => ({
    shock: !!shockData,
    staminaCore: !!staminaData,
    staminaModifiers: !!staminaData,
    worldTemps: !!(worldsData?.environmentMinTemps?.length || worldsData?.environmentMaxTemps?.length),
  }), [shockData, staminaData, worldsData?.environmentMaxTemps?.length, worldsData?.environmentMinTemps?.length]);

  const sectionMeta: Array<{ key: GameplaySectionKey; label: string; summary: string }> = [
    { key: 'shock', label: 'Shock Handling', summary: shockData ? `${shockData.shockRefillSpeedUnconscious} unconscious refill` : 'Not configured' },
    { key: 'staminaCore', label: 'Stamina Core', summary: staminaData ? `${staminaData.staminaMax} max / ${staminaData.staminaMinCap} min cap` : 'Not configured' },
    { key: 'staminaModifiers', label: 'Stamina Modifiers', summary: staminaData ? `${staminaData.sprintStaminaModifierErc.toFixed(2)} standing sprint` : 'Not configured' },
    { key: 'worldTemps', label: 'World Temperatures', summary: sectionAvailability.worldTemps ? 'Monthly min/max profile' : 'Not configured' },
  ];

  const selectedTitle = sectionMeta.find(section => section.key === selectedSection)?.label ?? 'Gameplay';

  const setShockRefill = (value: number) => {
    if (!gameplay.PlayerData?.ShockHandlingData) return;
    updateGameplay({
      ...gameplay,
      PlayerData: {
        ...gameplay.PlayerData,
        ShockHandlingData: {
          ...gameplay.PlayerData.ShockHandlingData,
          shockRefillSpeedUnconscious: value,
        },
      },
    });
  };

  const setStaminaField = (key: keyof NonNullable<typeof staminaData>, value: number) => {
    if (!gameplay.PlayerData?.StaminaData) return;
    updateGameplay({
      ...gameplay,
      PlayerData: {
        ...gameplay.PlayerData,
        StaminaData: {
          ...gameplay.PlayerData.StaminaData,
          [key]: value,
        },
      },
    });
  };

  const setWorldTemp = (kind: 'min' | 'max', index: number, value: number) => {
    if (!gameplay.WorldsData) return;
    const base = kind === 'min'
      ? [...(gameplay.WorldsData.environmentMinTemps ?? [])]
      : [...(gameplay.WorldsData.environmentMaxTemps ?? [])];
    if (index >= base.length) return;
    base[index] = value;

    updateGameplay({
      ...gameplay,
      WorldsData: {
        ...gameplay.WorldsData,
        ...(kind === 'min' ? { environmentMinTemps: base } : { environmentMaxTemps: base }),
      },
    });
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-200">Gameplay Sections</h2>
          <p className="text-xs text-slate-500 mt-0.5">cfggameplay.json overview</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sectionMeta.map(section => {
            const isSelected = selectedSection === section.key;
            const available = sectionAvailability[section.key];
            return (
              <button
                key={section.key}
                onClick={() => setSelectedSection(section.key)}
                className={`w-full text-left px-4 py-3 border-b border-slate-800/60 transition-colors ${
                  isSelected ? SELECTED_ROW_CLASS : 'hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">{section.label}</span>
                  {!available && <span className="text-[11px] text-amber-400">missing</span>}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">{section.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">{selectedTitle}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Server gameplay tuning reference</p>
            </div>
            <SaveButton isDirty={isDirty} onSave={() => { void saveGameplay(); }} label="Save cfggameplay.json" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {selectedSection === 'shock' && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
              {shockData ? (
                <div className="max-w-md space-y-2">
                  <EditableNumberRow
                    label="Refill Speed (Unconscious)"
                    value={shockData.shockRefillSpeedUnconscious}
                    onChange={setShockRefill}
                    hint="How quickly shock recovers while a player is unconscious."
                  />
                </div>
              ) : (
                <p className="text-sm text-slate-500">ShockHandlingData is not present in this file.</p>
              )}
            </div>
          )}

          {selectedSection === 'staminaCore' && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
              {staminaData ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <EditableNumberRow label="Max Stamina" value={staminaData.staminaMax} onChange={v => setStaminaField('staminaMax', v)} hint="Total stamina pool." />
                  <EditableNumberRow label="Min Cap" value={staminaData.staminaMinCap} onChange={v => setStaminaField('staminaMinCap', v)} hint="Lower reserve floor." />
                  <EditableNumberRow label="Weight Limit Threshold" value={staminaData.staminaWeightLimitThreshold} onChange={v => setStaminaField('staminaWeightLimitThreshold', v)} hint="Weight before penalties begin." />
                  <EditableNumberRow label="Kg to Stamina Penalty" value={staminaData.staminaKgToStaminaPercentPenalty} onChange={v => setStaminaField('staminaKgToStaminaPercentPenalty', v)} hint="Penalty per kg over the threshold." />
                </div>
              ) : (
                <p className="text-sm text-slate-500">StaminaData is not present in this file.</p>
              )}
            </div>
          )}

          {selectedSection === 'staminaModifiers' && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
              {staminaData ? (
                <>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sprint Posture</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <EditableNumberRow label="Standing Sprint" value={staminaData.sprintStaminaModifierErc} onChange={v => setStaminaField('sprintStaminaModifierErc', v)} />
                      <EditableNumberRow label="Crouch Sprint" value={staminaData.sprintStaminaModifierCro} onChange={v => setStaminaField('sprintStaminaModifierCro', v)} />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Activity Costs</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <EditableNumberRow label="Swimming" value={staminaData.sprintSwimmingStaminaModifier} onChange={v => setStaminaField('sprintSwimmingStaminaModifier', v)} />
                      <EditableNumberRow label="Ladder Climb" value={staminaData.sprintLadderStaminaModifier} onChange={v => setStaminaField('sprintLadderStaminaModifier', v)} />
                      <EditableNumberRow label="Melee" value={staminaData.meleeStaminaModifier} onChange={v => setStaminaField('meleeStaminaModifier', v)} />
                      <EditableNumberRow label="Obstacle Traversal" value={staminaData.obstacleTraversalStaminaModifier} onChange={v => setStaminaField('obstacleTraversalStaminaModifier', v)} />
                      <EditableNumberRow label="Hold Breath" value={staminaData.holdBreathStaminaModifier} onChange={v => setStaminaField('holdBreathStaminaModifier', v)} />
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">StaminaData is not present in this file.</p>
              )}
            </div>
          )}

          {selectedSection === 'worldTemps' && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
              {worldsData?.environmentMinTemps && worldsData.environmentMinTemps.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Minimum Temperatures</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                    {worldsData.environmentMinTemps.map((temp, idx) => (
                      <div key={`min-${idx}`} className="rounded-md border border-slate-700/70 bg-slate-800/40 px-2 py-2">
                        <div className="text-[11px] text-slate-500 text-center">{MONTHS[idx] ?? `M${idx + 1}`}</div>
                        <input
                          type="number"
                          value={temp}
                          step={0.1}
                          onChange={e => {
                            const parsed = Number(e.target.value);
                            if (!Number.isNaN(parsed)) setWorldTemp('min', idx, parsed);
                          }}
                          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-sm font-mono text-blue-400 text-center focus:outline-none focus:border-lime-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {worldsData?.environmentMaxTemps && worldsData.environmentMaxTemps.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Maximum Temperatures</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                    {worldsData.environmentMaxTemps.map((temp, idx) => (
                      <div key={`max-${idx}`} className="rounded-md border border-slate-700/70 bg-slate-800/40 px-2 py-2">
                        <div className="text-[11px] text-slate-500 text-center">{MONTHS[idx] ?? `M${idx + 1}`}</div>
                        <input
                          type="number"
                          value={temp}
                          step={0.1}
                          onChange={e => {
                            const parsed = Number(e.target.value);
                            if (!Number.isNaN(parsed)) setWorldTemp('max', idx, parsed);
                          }}
                          className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-sm font-mono text-orange-400 text-center focus:outline-none focus:border-lime-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!worldsData?.environmentMinTemps?.length && !worldsData?.environmentMaxTemps?.length && (
                <p className="text-sm text-slate-500">No monthly environment temperature arrays are present.</p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-xs text-slate-400">
            Edits are staged as pending changes. Save from here or use the global Save review in the top bar.
          </div>
        </div>
      </div>
    </div>
  );
}
