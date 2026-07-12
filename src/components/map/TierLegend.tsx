import { useMemo } from 'react';
import { TIER_COLORS, TIER_ORDER, getUsageColor, formatUsageLabel } from '../../types/map';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { sampleUsageAtPos, getUsageMasks, getLoadedTierNames } from '../../lib/tierZoneResolver';

const SURFACE_KEYS = new Set(['floor', 'shelves', 'ground']);

export function TierLegend() {
  const hiddenTiers       = useUiStore(s => s.hiddenTiers);
  const hiddenUsages      = useUiStore(s => s.hiddenUsages);
  const toggleTier        = useUiStore(s => s.toggleTier);
  const toggleUsage       = useUiStore(s => s.toggleUsage);
  const setHiddenTiers    = useUiStore(s => s.setHiddenTiers);
  const setHiddenUsages   = useUiStore(s => s.setHiddenUsages);
  const tierZonesLoaded   = useUiStore(s => s.tierZonesLoaded);
  const buildingInstances = useServerStore(s => s.buildingInstances);
  const mission           = useServerStore(s => s.mission);
  const ceToolLayers      = useServerStore(s => s.ceToolLayers);

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

    if (tierZonesLoaded && getUsageMasks() !== null) {
      for (const b of buildingInstances) {
        const ceUsage = sampleUsageAtPos(b.x, b.z);
        if (ceUsage !== null) register(ceUsage); else register('unknown');
        b.usages.forEach(register);
      }
    } else {
      for (const b of buildingInstances) {
        // Untagged buildings fall under 'unknown' so "Hide all" covers them too.
        if (b.usages.length === 0) register('unknown');
        b.usages.forEach(register);
      }
      if (mission) for (const t of mission.types.values()) t.usages.forEach(register);
    }

    // Always register paintable usage layers from CE Tool so "Hide all" covers them
    // even when no buildings carry that usage.
    for (const layer of ceToolLayers) {
      if (!layer.isPaintable) continue;
      const isValueLayer = layer.name.startsWith('valueFlg_') || layer.valueFlags !== 0;
      if (isValueLayer) {
        // Non-numeric value layers (Unique, Contamination) go in Type (fill); numeric tiers are in Tier section
        if (layer.usageName && !/^Tier\d+$/i.test(layer.usageName)) register(layer.usageName);
        continue;
      }
      const name = layer.usageName ?? layer.name.replace(/^usgFlg_Paint-/i, '');
      if (name) register(name);
    }

    return [...byKey.values()]
      .map(group => ({ label: group.label, rawUsages: [...group.rawUsages] }))
      .sort((a, b) => {
        if (a.label === 'Unknown') return 1;
        if (b.label === 'Unknown') return -1;
        return a.label.localeCompare(b.label);
      });
  }, [buildingInstances, mission, tierZonesLoaded, ceToolLayers]);

  const zoneGroups    = useMemo(() => usageGroups.filter(g => !SURFACE_KEYS.has(g.label.toLowerCase())), [usageGroups]);
  const surfaceGroups = useMemo(() => usageGroups.filter(g =>  SURFACE_KEYS.has(g.label.toLowerCase())), [usageGroups]);

  const allZoneKeys    = useMemo(() => zoneGroups.flatMap(g => g.rawUsages),    [zoneGroups]);
  const allSurfaceKeys = useMemo(() => surfaceGroups.flatMap(g => g.rawUsages), [surfaceGroups]);
  const hiddenUsageSet = useMemo(
    () => new Set(hiddenUsages.map(u => u.trim().toLowerCase())),
    [hiddenUsages],
  );

  // Build the set of tiers that actually exist: TGA zone layers + building proto tiers + item tiers.
  const activeTierSet = useMemo(() => {
    const found = new Set<string>(getLoadedTierNames());
    for (const b of buildingInstances) b.tiers.forEach(t => found.add(t));
    if (mission) for (const type of mission.types.values()) type.tiers.forEach(t => found.add(t));
    for (const layer of ceToolLayers) {
      const isValueLayer = layer.name.startsWith('valueFlg_') || layer.valueFlags !== 0;
      if (layer.isPaintable && isValueLayer && layer.usageName && /^Tier\d+$/i.test(layer.usageName)) {
        found.add(layer.usageName);
      }
    }
    return found;
  }, [buildingInstances, mission, ceToolLayers]);

  const extraTiers = [...activeTierSet].filter(t => t !== 'unknown' && !TIER_ORDER.includes(t)).sort();
  const allTiers = [...TIER_ORDER.filter(t => activeTierSet.has(t)), ...extraTiers, 'unknown'];
  const allTiersHidden   = allTiers.every(t => hiddenTiers.includes(t));
  const allZonesHidden   = zoneGroups.every(g => g.rawUsages.every(u => hiddenUsageSet.has(u.trim().toLowerCase())));
  const allSurfaceHidden = surfaceGroups.every(g => g.rawUsages.every(u => hiddenUsageSet.has(u.trim().toLowerCase())));

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 min-w-[140px] pointer-events-auto">
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

      {zoneGroups.length > 0 && (
        <>
          <div className="border-t border-slate-700 my-2" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Type (fill)</p>
            <button
              onClick={() => {
                const zoneKeySet = new Set(allZoneKeys.map(k => k.trim().toLowerCase()));
                if (allZonesHidden) {
                  setHiddenUsages(hiddenUsages.filter(u => !zoneKeySet.has(u.trim().toLowerCase())));
                } else {
                  setHiddenUsages([...hiddenUsages.filter(u => !zoneKeySet.has(u.trim().toLowerCase())), ...allZoneKeys]);
                }
              }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
            >{allZonesHidden ? 'Show all' : 'Hide all'}</button>
          </div>
          {zoneGroups.map(group => {
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

      {surfaceGroups.length > 0 && (
        <>
          <div className="border-t border-slate-700 my-2" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Surface (spawn)</p>
            <button
              onClick={() => {
                const surfaceKeySet = new Set(allSurfaceKeys.map(k => k.trim().toLowerCase()));
                if (allSurfaceHidden) {
                  setHiddenUsages(hiddenUsages.filter(u => !surfaceKeySet.has(u.trim().toLowerCase())));
                } else {
                  setHiddenUsages([...hiddenUsages.filter(u => !surfaceKeySet.has(u.trim().toLowerCase())), ...allSurfaceKeys]);
                }
              }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors whitespace-nowrap"
            >{allSurfaceHidden ? 'Show all' : 'Hide all'}</button>
          </div>
          {surfaceGroups.map(group => {
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
