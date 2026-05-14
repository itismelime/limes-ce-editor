import { open } from '@tauri-apps/plugin-dialog';
import { useUiStore } from '../../store/uiStore';
import { useServerStore } from '../../store/serverStore';
import { readFile, writeFile } from '../../lib/fileDiscovery';
import { CATEGORY_OPTIONS } from '../../lib/itemClassifier';

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 py-4 border-b border-slate-800 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}

export function SettingsEditor() {
  const categoryOverrides = useUiStore(s => s.categoryOverrides);
  const importCategoryOverrides = useUiStore(s => s.importCategoryOverrides);
  const clearCategoryOverrides = useUiStore(s => s.clearCategoryOverrides);

  const overrideCount = Object.keys(categoryOverrides).length;

  async function handleImport() {
    const selected = await open({
      multiple: false,
      title: 'Select category override JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!selected || typeof selected !== 'string') return;
    try {
      const raw = await readFile(selected);
      const parsed = JSON.parse(raw) as { overrides?: Record<string, string> } | Record<string, string>;
      const source = 'overrides' in parsed && parsed.overrides ? parsed.overrides : parsed;
      const allowed = new Set(CATEGORY_OPTIONS);
      const normalized: Record<string, string> = {};
      for (const [name, category] of Object.entries(source)) {
        if (typeof category !== 'string') continue;
        if (!allowed.has(category)) continue;
        normalized[name.toLowerCase()] = category;
      }
      importCategoryOverrides(normalized);
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to import category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleExport() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Choose folder for override export',
    });
    if (!folder || typeof folder !== 'string') return;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      overrides: categoryOverrides,
    };
    try {
      await writeFile(`${folder}/looteditor-category-overrides.json`, JSON.stringify(payload, null, 2));
      useServerStore.setState({ saveError: null });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to export category overrides: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function handleClear() {
    if (overrideCount === 0) return;
    if (!window.confirm(`Clear all ${overrideCount} category override${overrideCount !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    clearCategoryOverrides();
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-slate-100 mb-1">Settings</h1>
        <p className="text-xs text-slate-500 mb-8">Editor preferences. These settings are stored locally and do not affect your server files.</p>

        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Category Mappings</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4">
            <SettingRow
              title="Import category map"
              description="Load a previously exported JSON file to restore your custom item-to-category assignments. Useful for applying the same mapping across multiple missions or sharing your setup with others."
            >
              <button
                onClick={handleImport}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors"
              >
                Import…
              </button>
            </SettingRow>

            <SettingRow
              title="Export category map"
              description={`Save your current category assignments to a JSON file${overrideCount > 0 ? ` (${overrideCount} override${overrideCount !== 1 ? 's' : ''} active)` : ''}. You can import this file later to restore them without re-doing the work.`}
            >
              <button
                onClick={handleExport}
                disabled={overrideCount === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Export…
              </button>
            </SettingRow>

            <SettingRow
              title="Clear category map"
              description="Remove all manual category assignments. Items will revert to their automatically detected categories based on name and type. This only affects the editor view — no XML files are changed."
            >
              <button
                onClick={handleClear}
                disabled={overrideCount === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear{overrideCount > 0 ? ` (${overrideCount})` : ''}
              </button>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}
