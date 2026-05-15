import { useServerStore } from '../../store/serverStore';
import type { WeatherValue } from '../../types/dayz';
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="font-mono text-sm text-slate-200">{value}</span>
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

function renderValueSection(value: WeatherValue, unit?: string) {
  const suffix = unit ? ` ${unit}` : '';
  return (
    <>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current</h3>
        <StatRow label="Actual" value={`${formatValue(value.current.actual)}${suffix}`} />
        <StatRow label="Blend Time" value={`${formatValue(value.current.time)} s`} />
        <StatRow label="Duration" value={`${formatValue(value.current.duration)} s`} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Limits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <StatRow label="Min" value={`${formatValue(value.limits.min)}${suffix}`} />
          <StatRow label="Max" value={`${formatValue(value.limits.max)}${suffix}`} />
        </div>
      </div>

      {value.timelimits && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Time Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <StatRow label="Min" value={`${formatValue(value.timelimits.min)} s`} />
            <StatRow label="Max" value={`${formatValue(value.timelimits.max)} s`} />
          </div>
        </div>
      )}

      {value.changelimits && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Change Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <StatRow label="Min" value={`${formatValue(value.changelimits.min)}${suffix}`} />
            <StatRow label="Max" value={`${formatValue(value.changelimits.max)}${suffix}`} />
          </div>
        </div>
      )}

      {value.thresholds && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Thresholds</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <StatRow label="Start Min" value={formatValue(value.thresholds.min)} />
            <StatRow label="Start Max" value={formatValue(value.thresholds.max)} />
            <StatRow label="End" value={formatValue(value.thresholds.end)} />
          </div>
        </div>
      )}
    </>
  );
}

export function WeatherEditor() {
  const weather = useServerStore(s => s.weather);
  const [selectedSection, setSelectedSection] = useState<WeatherSectionKey>('overcast');

  if (!weather) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p>Weather data not loaded. Check if cfgweather.xml exists.</p>
      </div>
    );
  }

  const selectedLabel = useMemo(() => {
    if (selectedSection === 'storm') return 'Storm';
    return WEATHER_SECTIONS.find(section => section.key === selectedSection)?.label ?? 'Overcast';
  }, [selectedSection]);

  const selectedWeather = selectedSection === 'storm' ? null : normalizeWeatherValue(weather[selectedSection]);
  const storm = {
    density: Number((weather as { storm?: { density?: number } }).storm?.density ?? 0),
    threshold: Number((weather as { storm?: { threshold?: number } }).storm?.threshold ?? 0),
    timeout: Number((weather as { storm?: { timeout?: number } }).storm?.timeout ?? 0),
  };

  const weatherSummary = WEATHER_SECTIONS.map(section => {
    const value = normalizeWeatherValue(weather[section.key]);
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
                  isSelected ? 'bg-lime-950/40 border-l-2 border-l-lime-500' : 'hover:bg-slate-800'
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
              selectedSection === 'storm' ? 'bg-lime-950/40 border-l-2 border-l-lime-500' : 'hover:bg-slate-800'
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
            <span className="text-xs text-slate-500">Read only</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
            {selectedWeather ? renderValueSection(selectedWeather) : (
              <>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Storm Profile</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <StatRow label="Density" value={formatValue(storm.density)} />
                    <StatRow label="Threshold" value={formatValue(storm.threshold)} />
                    <StatRow label="Timeout" value={`${storm.timeout}s`} />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-xs text-slate-400">
            Read-only view with parser precision preservation. Editing controls can be added without changing this layout.
          </div>
        </div>
      </div>
    </div>
  );
}
