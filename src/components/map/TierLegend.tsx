import { useMemo } from 'react';
import { TIER_COLORS, TIER_ORDER, getUsageColor, formatUsageLabel } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';

export function TierLegend() {
  const hiddenTiers       = useUiStore(s => s.hiddenTiers);
  const hiddenUsages      = useUiStore(s => s.hiddenUsages);
  const toggleTier        = useUiStore(s => s.toggleTier);
  const toggleUsage       = useUiStore(s => s.toggleUsage);
  const setHiddenTiers    = useUiStore(s => s.setHiddenTiers);
  const setHiddenUsages   = useUiStore(s => s.setHiddenUsages);
  const buildingInstances = useServerStore(s => s.buildingInstances);
  const mission           = useServerStore(s => s.mission);

  const usageGroups = useMemo(() => {
    const byKey = new Map<string, { label: string; rawUsages: Set<string> }>();
    const register = (rawUsage: string) => {
      const usage = rawUsage ?? '';
      const normalized = usage.trim().toLowerCase();
      const key = normalized === '' || normalized === 'unknown' ? 'unknown' : normalized;
      if (!byKey.has(key)) {
        byKey.set(key, {
          label: formatUsageLabel(key),
          rawUsages: new Set<string>(),
        });
      }
      byKey.get(key)!.rawUsages.add(usage);
    };

    for (const b of buildingInstances) b.usages.forEach(register);
    if (mission) for (const t of mission.types.values()) t.usages.forEach(register);

    return [...byKey.values()]
      .map(group => ({ label: group.label, rawUsages: [...group.rawUsages] }))
      .sort((a, b) => {
        if (a.label === 'Unknown') return 1;
        if (b.label === 'Unknown') return -1;
        return a.label.localeCompare(b.label);
      });
  }, [buildingInstances, mission]);

  const allUsageKeys = useMemo(() => usageGroups.flatMap(g => g.rawUsages), [usageGroups]);
  const hiddenUsageSet = useMemo(
    () => new Set(hiddenUsages.map(u => u.trim().toLowerCase())),
    [hiddenUsages],
  );

  const allTiers = [...TIER_ORDER, 'unknown'];
  const allTiersHidden = allTiers.every(t => hiddenTiers.includes(t));
  const allUsagesHidden = usageGroups.every(g => g.rawUsages.every(u => hiddenUsageSet.has(u.trim().toLowerCase())));

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur min-w-[140px] pointer-events-auto">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tier (ring)</p>
        <button
          onClick={() => setHiddenTiers(allTiersHidden ? [] : allTiers)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >{allTiersHidden ? 'Show all' : 'Hide all'}</button>
      </div>
      {allTiers.map(tier => {
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

      {usageGroups.length > 0 && (
        <>
          <div className="border-t border-slate-700 my-2" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Type (fill)</p>
            <button
              onClick={() => setHiddenUsages(allUsagesHidden ? [] : allUsageKeys)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
            >{allUsagesHidden ? 'Show all' : 'Hide all'}</button>
          </div>
          {usageGroups.map(group => {
            const hidden = group.rawUsages.every(u => hiddenUsageSet.has(u.trim().toLowerCase()));
            const color  = getUsageColor(group.rawUsages[0] ?? group.label);
            return (
              <button
                key={group.label}
                onClick={() => {
                  const shouldHide = !hidden;
                  group.rawUsages.forEach(u => {
                    const isHidden = hiddenUsageSet.has(u.trim().toLowerCase());
                    if (shouldHide && !isHidden) toggleUsage(u);
                    if (!shouldHide && isHidden) toggleUsage(u);
                  });
                }}
                className="flex items-center gap-2 mb-1 last:mb-0 w-full text-left"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color, opacity: hidden ? 0.2 : 1 }}
                />
                <span className={`text-xs ${hidden ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{group.label}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
