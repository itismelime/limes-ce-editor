import { TIER_COLORS, TIER_ORDER, USAGE_COLORS, USAGE_PRIORITY } from '../../types/map';
import { useUiStore } from '../../store/uiStore';

export function TierLegend() {
  const hiddenTiers  = useUiStore(s => s.hiddenTiers);
  const hiddenUsages = useUiStore(s => s.hiddenUsages);
  const toggleTier   = useUiStore(s => s.toggleTier);
  const toggleUsage  = useUiStore(s => s.toggleUsage);

  return (
    <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur min-w-[140px]">
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

      <div className="border-t border-slate-700 my-2" />

      <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Usage (fill)</p>
      {USAGE_PRIORITY.map(usage => {
        const hidden = hiddenUsages.includes(usage);
        const color  = USAGE_COLORS[usage];
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
    </div>
  );
}
