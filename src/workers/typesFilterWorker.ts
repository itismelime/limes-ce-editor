type SortColumn = 'name' | 'category' | 'tiers' | 'usages' | 'min' | 'nominal';

type SortDirection = 'asc' | 'desc';

type Row = {
  name: string;
  category: string;
  source: string;
  tiers: string[];
  usages: string[];
  nominal: number;
  min: number;
  resolvedCategory: string;
};

type ComputeQuery = {
  typeFilter: string;
  tierFilter: string;
  usageFilter: string;
  sourceFilter: string;
  categoryFilter: string;
  showInactive: boolean;
  sortCol: SortColumn;
  sortDir: SortDirection;
};

type WorkerInMessage =
  | { type: 'setData'; rows: Row[] }
  | { type: 'compute'; requestId: number; query: ComputeQuery };

type WorkerOutMessage = { type: 'result'; requestId: number; names: string[]; durationMs: number };

let rows: Row[] = [];

function tierRank(tiers: string[]): number {
  if (tiers.length === 0) return 99;
  let best = 99;
  for (const t of tiers) {
    const n = Number.parseInt(t.replace('Tier', ''), 10);
    if (Number.isFinite(n) && n < best) best = n;
  }
  return best;
}

function firstUsage(usages: string[]): string {
  if (usages.length === 0) return '';
  const sorted = [...usages].sort();
  return sorted[0] ?? '';
}

function computeNames(query: ComputeQuery): string[] {
  const q = query.typeFilter.toLowerCase();
  const filtered = rows.filter(r => {
    const categoryLower = r.category.toLowerCase();
    const matchesSearch = !q || r.name.toLowerCase().includes(q) || categoryLower.includes(q);
    const matchesTier = !query.tierFilter || r.tiers.includes(query.tierFilter);
    const matchesUsage = !query.usageFilter || r.usages.includes(query.usageFilter);
    const matchesSource = !query.sourceFilter || r.source === query.sourceFilter;
    const matchesCategory = !query.categoryFilter || r.resolvedCategory === query.categoryFilter;
    const matchesActive = query.showInactive || r.nominal > 0;
    return matchesSearch && matchesTier && matchesUsage && matchesSource && matchesCategory && matchesActive;
  });

  const dir = query.sortDir === 'asc' ? 1 : -1;

  filtered.sort((a, b) => {
    switch (query.sortCol) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'category':
        return dir * a.resolvedCategory.localeCompare(b.resolvedCategory);
      case 'tiers':
        return dir * (tierRank(a.tiers) - tierRank(b.tiers));
      case 'usages': {
        const ua = firstUsage(a.usages);
        const ub = firstUsage(b.usages);
        if (!ua && !ub) return 0;
        if (!ua) return 1;
        if (!ub) return -1;
        return dir * ua.localeCompare(ub);
      }
      case 'min':
        return dir * (a.min - b.min);
      case 'nominal':
        return dir * (a.nominal - b.nominal);
      default:
        return 0;
    }
  });

  return filtered.map(r => r.name);
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === 'setData') {
    rows = msg.rows;
    return;
  }

  if (msg.type === 'compute') {
    const startedAt = performance.now();
    const names = computeNames(msg.query);
    const response: WorkerOutMessage = {
      type: 'result',
      requestId: msg.requestId,
      names,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    };
    self.postMessage(response);
  }
};
