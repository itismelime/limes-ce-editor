import { useMemo } from 'react';
import { TIER_COLORS, TIER_ORDER, getUsageColor } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';

export function TierLegend() {
  const hiddenTiers       = useUiStore(s => s.hiddenTiers);
  const hiddenUsages      = useUiStore(s => s.hiddenUsages);
  const toggleTier        = useUiStore(s => s.toggleTier);
  const toggleUsage       = useUiStore(s => s.toggleUsage);
  const buildingInstances = useServerStore(s => s.buildingInstances);
  const mission           = useServerStore(s => s.mission);

  const activeUsages = useMemo(() => {
    const s = new Set<string>();
    for (const b of buildingInstances) b.usages.forEach(u => s.add(u));
    if (mission) for (const t of mission.types.values()) t.usages.forEach(u => s.add(u));
    return [...s].sort();
  }, [buildingInstances, mission]);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur min-w-[140px] pointer-events-auto">
      <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Tier (ring)</p>
      {[...TIER_ORDER, 'unknown'].map(tier => {
        const hidden = hiddenTiers.includes(tier);
        const color  = TIER_COLORS[tier] ?? '#6b7280';
        return (
          <button
            key={tier}
            onClick={() => toggleTier(tier)}
            className="flex items-center gap-2 mb-1 last:mb-0 w-full text-left"
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0 border-2"
              style={{ borderColor: color, backgroundColor: hidden ? 'transparent' : color, opacity: hidden ? 0.4 : 1 }}
            />
            <span className={`text-xs ${hidden ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{tier}</span>
          </button>
        );
      })}

      {activeUsages.length > 0 && (
        <>
          <div className="border-t border-slate-700 my-2" />
          <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Usage (fill)</p>
          {activeUsages.map(usage => {
            const hidden = hiddenUsages.includes(usage);
            const color  = getUsageColor(usage);
            return (
              <button
                key={usage}
                onClick={() => toggleUsage(usage)}
                className="flex items-center gap-2 mb-1 last:mb-0 w-full text-left"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color, opacity: hidden ? 0.2 : 1 }}
                />
                <span className={`text-xs ${hidden ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{usage}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
