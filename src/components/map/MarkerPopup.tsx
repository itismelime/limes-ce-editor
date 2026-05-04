import { useMemo } from 'react';
import type { ResolvedMarker } from '../../lib/lootResolver';
import { TIER_COLORS } from '../../types/map';
import { useUiStore } from '../../store/uiStore';

interface Props {
  marker: ResolvedMarker;
}

export function MarkerPopup({ marker }: Props) {
  const setActiveTab = useUiStore(s => s.setActiveTab);
  const setSelectedEvent = useUiStore(s => s.setSelectedEvent);

  const topItems = useMemo(
    () => [...marker.lootItems]
      .sort((a, b) => b.effectiveChance - a.effectiveChance)
      .slice(0, 8),
    [marker.lootItems],
  );

  return (
    <div className="min-w-[220px]">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: TIER_COLORS[marker.dominantTier] ?? TIER_COLORS.unknown }}
        />
        <span className="font-semibold text-sm text-slate-100">{marker.eventName}</span>
        {!marker.active && (
          <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">inactive</span>
        )}
      </div>

      <div className="text-xs text-slate-500 mb-2">
        {marker.positions.length} spawn point{marker.positions.length !== 1 ? 's' : ''}
        {marker.lootItems.length > 0 && ` · ${marker.lootItems.length} item types`}
      </div>

      {topItems.length > 0 ? (
        <div className="space-y-1">
          {topItems.map(item => (
            <div key={item.name} className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-300 truncate">{item.name}</span>
              <span className="text-xs text-slate-500 flex-shrink-0">
                {(item.effectiveChance * 100).toFixed(0)}%
              </span>
            </div>
          ))}
          {marker.lootItems.length > 8 && (
            <p className="text-xs text-slate-600 pt-1">+{marker.lootItems.length - 8} more…</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-600 italic">No loot data linked</p>
      )}

      <button
        onClick={() => {
          setActiveTab('spawns');
          setSelectedEvent(marker.eventName);
        }}
        className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        Edit spawn points →
      </button>
    </div>
  );
}
