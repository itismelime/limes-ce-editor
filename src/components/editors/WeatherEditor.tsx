import { useServerStore } from '../../store/serverStore';
import type { WeatherValue } from '../../types/dayz';
import { SELECTED_ROW_CLASS } from '../shared/ui';
import { useMemo, useState } from 'react';

type WeatherSectionKey = 'overcast' | 'fog' | 'rain' | 'windMagnitude' | 'windDirection' | 'snowfall' | 'storm';

const WEATHER_SECTIONS: Array<{ key: Exclude<WeatherSectionKey, 'storm'>; label: string; unit?: string }> = [
  { key: 'overcast', label: 'Overcast' },
  { key: 'fog', label: 'Fog' },
  { key: 'rain', label: 'Rain' },
  { key: 'windMagnitude', label: 'Wind Magnitude' },
  { key: 'windDirection', label: 'Wind Direction', unit: 'rad' },
  { key: 'snowfall', label: 'Snowfall' },
];

function NumRow({ label, value, onChange, unit }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  // Draft holds in-progress text so the field can be cleared mid-edit;
  // blur snaps back to the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <span className="text-xs text-slate-400">{label}{unit ? ` (${unit})` : ''}</span>
      <input
        type="number"
        step="any"
        value={draft ?? String(value)}
        onChange={e => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v);
        }}
        onBlur={() => setDraft(null)}
        className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm font-mono text-slate-200 text-right focus:outline-none focus:border-lime-500"
      />
    </div>
  );
}

function formatValue(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.000';
}

function normalizeWeatherValue(input: unknown): WeatherValue {
  const value = (input ?? {}) as Partial<WeatherValue>;
  return {
    current: {
      actual: Number(value.current?.actual ?? 0),
      time: Number(value.current?.time ?? 0),
      duration: Number(value.current?.duration ?? 0),
      rawActual: value.current?.rawActual,
    },
    limits: {
      min: Number(value.limits?.min ?? 0),
      max: Number(value.limits?.max ?? 0),
      rawMin: value.limits?.rawMin,
      rawMax: value.limits?.rawMax,
    },
    ...(value.timelimits ? {
      timelimits: {
        min: Number(value.timelimits.min ?? 0),
        max: Number(value.timelimits.max ?? 0),
      },
    } : {}),
    ...(value.changelimits ? {
      changelimits: {
        min: Number(value.changelimits.min ?? 0),
        max: Number(value.changelimits.max ?? 0),
        rawMin: value.changelimits.rawMin,
        rawMax: value.changelimits.rawMax,
      },
    } : {}),
    ...(value.thresholds ? {
      thresholds: {
        min: Number(value.thresholds.min ?? 0),
        max: Number(value.thresholds.max ?? 0),
        end: Number(value.thresholds.end ?? 0),
      },
    } : {}),
  };
}

// Every edit clears the matching raw* precision string — the serializer
// prefers raw strings, so a stale raw would silently swallow the edit.
function ValueSection({ value, unit, onPatch }: {
  value: WeatherValue;
  unit?: string;
  onPatch: (next: WeatherValue) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current</h3>
        <NumRow label="Actual" unit={unit} value={value.current.actual}
          onChange={n => onPatch({ ...value, current: { ...value.current, actual: n, rawActual: undefined } })} />
        <NumRow label="Blend Time" unit="s" value={value.current.time}
          onChange={n => onPatch({ ...value, current: { ...value.current, time: n } })} />
        <NumRow label="Duration" unit="s" value={value.current.duration}
          onChange={n => onPatch({ ...value, current: { ...value.current, duration: n } })} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Limits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <NumRow label="Min" unit={unit} value={value.limits.min}
            onChange={n => onPatch({ ...value, limits: { ...value.limits, min: n, rawMin: undefined } })} />
          <NumRow label="Max" unit={unit} value={value.limits.max}
            onChange={n => onPatch({ ...value, limits: { ...value.limits, max: n, rawMax: undefined } })} />
        </div>
      </div>

      {value.timelimits && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <NumRow label="Min" unit="s" value={value.timelimits.min}
              onChange={n => onPatch({ ...value, timelimits: { ...value.timelimits!, min: n } })} />
            <NumRow label="Max" unit="s" value={value.timelimits.max}
              onChange={n => onPatch({ ...value, timelimits: { ...value.timelimits!, max: n } })} />
          </div>
        </div>
      )}

      {value.changelimits && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Change Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <NumRow label="Min" unit={unit} value={value.changelimits.min}
              onChange={n => onPatch({ ...value, changelimits: { ...value.changelimits!, min: n, rawMin: undefined } })} />
            <NumRow label="Max" unit={unit} value={value.changelimits.max}
              onChange={n => onPatch({ ...value, changelimits: { ...value.changelimits!, max: n, rawMax: undefined } })} />
          </div>
        </div>
      )}

      {value.thresholds && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Thresholds</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <NumRow label="Start Min" value={value.thresholds.min}
              onChange={n => onPatch({ ...value, thresholds: { ...value.thresholds!, min: n } })} />
            <NumRow label="Start Max" value={value.thresholds.max}
              onChange={n => onPatch({ ...value, thresholds: { ...value.thresholds!, max: n } })} />
            <NumRow label="End" value={value.thresholds.end}
              onChange={n => onPatch({ ...value, thresholds: { ...value.thresholds!, end: n } })} />
          </div>
        </div>
      )}
    </>
  );
}

export function WeatherEditor() {
  const weather = useServerStore(s => s.weather);
  const updateWeather = useServerStore(s => s.updateWeather);
  const [selectedSection, setSelectedSection] = useState<WeatherSectionKey>('overcast');

  const selectedLabel = useMemo(() => {
    if (selectedSection === 'storm') return 'Storm';
    return WEATHER_SECTIONS.find(section => section.key === selectedSection)?.label ?? 'Overcast';
  }, [selectedSection]);

  if (!weather) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p>Weather data not loaded. Check if cfgweather.xml exists.</p>
      </div>
    );
  }

  const selectedWeather = selectedSection === 'storm' ? null : normalizeWeatherValue(weather[selectedSection]);
  const storm = weather.storm;

  const patchSection = (next: WeatherValue) => {
    if (selectedSection === 'storm') return;
    updateWeather({ ...weather, [selectedSection]: next });
  };
  const patchStorm = (patch: Partial<typeof storm>) => {
    updateWeather({ ...weather, storm: { ...storm, ...patch } });
  };

  const weatherSummary = WEATHER_SECTIONS.map(section => {
    const value = normalizeWeatherValue(weather[section.key] ?? {});
    return {
      key: section.key,
      label: section.label,
      current: formatValue(value.current.actual),
      min: formatValue(value.limits.min),
      max: formatValue(value.limits.max),
      unit: section.unit,
    };
  });

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-200">Weather Sections</h2>
          <p className="text-xs text-slate-500 mt-0.5">cfgweather.xml overview</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {weatherSummary.map(section => {
            const isSelected = selectedSection === section.key;
            const unitSuffix = section.unit ? ` ${section.unit}` : '';
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
                  <span className="text-xs font-mono text-slate-400">{section.current}{unitSuffix}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500 font-mono">
                  {section.min} to {section.max}{unitSuffix}
                </div>
              </button>
            );
          })}

          <button
            onClick={() => setSelectedSection('storm')}
            className={`w-full text-left px-4 py-3 border-b border-slate-800/60 transition-colors ${
              selectedSection === 'storm' ? SELECTED_ROW_CLASS : 'hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-200">Storm</span>
              <span className="text-xs font-mono text-slate-400">{formatValue(storm.density)}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 font-mono">
              Threshold {formatValue(storm.threshold)}
            </div>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">{selectedLabel}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedSection === 'storm' ? 'Storm envelope settings' : 'Current values and weather constraints'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
            {selectedWeather ? (
              <ValueSection
                value={selectedWeather}
                unit={WEATHER_SECTIONS.find(s => s.key === selectedSection)?.unit}
                onPatch={patchSection}
              />
            ) : (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Storm Profile</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <NumRow label="Density" value={storm.density}
                    onChange={n => patchStorm({ density: n, rawDensity: undefined })} />
                  <NumRow label="Threshold" value={storm.threshold}
                    onChange={n => patchStorm({ threshold: n, rawThreshold: undefined })} />
                  <NumRow label="Timeout" unit="s" value={storm.timeout}
                    onChange={n => patchStorm({ timeout: n })} />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-xs text-slate-400">
            Edits are staged as pending changes — save or revert them from the Save review in the top bar.
          </div>
        </div>
      </div>
    </div>
  );
}
