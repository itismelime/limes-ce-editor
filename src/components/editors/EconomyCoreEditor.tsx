import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile, backupIfNeeded } from '../../lib/fileDiscovery';
import { useServerStore, toMessage } from '../../store/serverStore';
import { SaveButton } from '../shared/SaveButton';

interface EditingFile {
  path: string;
  name: string;
  type: string;
  content: string;
  dirty: boolean;
}

export function EconomyCoreEditor() {
  const economyCore            = useServerStore(s => s.economyCore);
  const paths                  = useServerStore(s => s.paths);
  const addCustomTypePack      = useServerStore(s => s.addCustomTypePack);
  const removeEconomyCoreEntry = useServerStore(s => s.removeEconomyCoreEntry);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [editingFile, setEditingFile]       = useState<EditingFile | null>(null);
  const [name, setName]         = useState('');
  const [xml, setXml]           = useState('');
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const reloadTypesSource = useServerStore(s => s.reloadTypesSource);
  const dirtyTypesSources = useServerStore(s => s.dirty.typesSources);

  // An open file / selection belongs to the mission it was opened from.
  const [openedFor, setOpenedFor] = useState(paths.missionPath);
  if (openedFor !== paths.missionPath) {
    setOpenedFor(paths.missionPath);
    setEditingFile(null);
    setSelectedFolder(null);
  }

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && xml.trim().length > 0 && !!paths.economyCorePath;
  const selectedEntry = economyCore.find(e => e.folder === selectedFolder) ?? null;

  async function handleSelectFile(folder: string, fileName: string, type: string) {
    if (!paths.missionPath) return;
    const filePath = `${paths.missionPath}/${folder}/${fileName}`;
    try {
      const content = await readFile(filePath);
      setEditingFile({ path: filePath, name: fileName, type, content, dirty: false });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to read ${fileName}: ${toMessage(err)}` });
    }
  }

  async function handleSaveFile() {
    if (!editingFile) return;
    if (dirtyTypesSources.includes(editingFile.path)) {
      useServerStore.setState({ saveError: `${editingFile.name} has unsaved edits from the Loot Types tab. Save or revert those first.` });
      return;
    }
    setSaving(true);
    try {
      await backupIfNeeded(editingFile.path);
      await writeFile(editingFile.path, editingFile.content);
      setEditingFile({ ...editingFile, dirty: false });
      // keep the Loot Types tab and map popups in step with the file
      if (editingFile.type === 'types') reloadTypesSource(editingFile.path, editingFile.content);
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to save ${editingFile.name}: ${toMessage(err)}` });
    }
    setSaving(false);
  }

  async function handleFileUpload() {
    const selected = await open({
      multiple: false,
      title: 'Select types.xml',
      filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    if (selected && typeof selected === 'string') {
      try {
        const content = await readFile(selected);
        setXml(content);
      } catch (err) {
        useServerStore.setState({ saveError: `Failed to read file: ${toMessage(err)}` });
      }
    }
  }

  async function handleAddSave() {
    if (!canSave) return;
    setSaving(true);
    setSuccess(false);
    await addCustomTypePack(trimmedName, xml);
    setSaving(false);
    if (!useServerStore.getState().saveError) {
      setSuccess(true);
      setName('');
      setXml('');
    }
  }

  async function handleRemove(folder: string) {
    setRemoving(folder);
    await removeEconomyCoreEntry(folder);
    setRemoving(null);
    if (selectedFolder === folder) {
      setSelectedFolder(null);
      setEditingFile(null);
    }
  }

  function handleSelectEntry(folder: string) {
    setSelectedFolder(folder);
    setEditingFile(null);
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: entry list */}
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col bg-slate-950">
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">cfgeconomycore.xml</h2>
            <p className="text-xs text-slate-500 mt-0.5">Registered type packs</p>
          </div>
          <button
            onClick={() => { setSelectedFolder(null); setEditingFile(null); }}
            className="h-7 px-3 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            + Add pack
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {economyCore.length === 0 ? (
            <p className="text-slate-500 text-xs px-4 py-3">No entries loaded.</p>
          ) : (
            economyCore.map((entry, i) => {
              const isSelected = selectedFolder === entry.folder;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60 cursor-pointer transition-colors ${
                    isSelected ? 'bg-slate-800' : 'hover:bg-slate-800'
                  }`}
                  onClick={() => handleSelectEntry(entry.folder)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-300 truncate">{entry.folder}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {entry.files.map(f => f.name).join(', ')}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleRemove(entry.folder); }}
                    disabled={removing === entry.folder}
                    className="flex-shrink-0 h-7 px-2 rounded-lg text-xs font-medium border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:bg-rose-900/70 transition-colors disabled:opacity-40"
                  >
                    {removing === entry.folder ? '…' : 'Remove'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {editingFile ? (
          /* File editor */
          <>
            <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-800">
              <button
                onClick={() => setEditingFile(null)}
                className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
              >
                ← Back
              </button>
              <h2 className="text-sm font-semibold text-slate-200 flex-1">{editingFile.name}</h2>
              <SaveButton isDirty={editingFile.dirty && !saving} onSave={handleSaveFile} label={saving ? 'Saving…' : 'Save'} />
            </div>
            <div className="flex-1 overflow-hidden px-6 py-4">
              <textarea
                value={editingFile.content}
                onChange={e => setEditingFile({ ...editingFile, content: e.target.value, dirty: true })}
                className="w-full h-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-lime-500 resize-none"
              />
            </div>
          </>
        ) : selectedEntry ? (
          /* Entry detail view */
          <>
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-200">{selectedEntry.folder}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Registered in cfgeconomycore.xml</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2 uppercase tracking-wider">Folder</p>
                <p className="text-sm text-slate-200 font-mono bg-slate-800 rounded px-3 py-2">
                  {selectedEntry.folder}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2 uppercase tracking-wider">Registered files</p>
                <div className="space-y-1">
                  {selectedEntry.files.map((f, j) => (
                    <button
                      key={j}
                      onClick={() => handleSelectFile(selectedEntry.folder, f.name, f.type)}
                      className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 rounded px-3 py-2 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-slate-200 font-mono flex-1">{f.name}</span>
                      <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded">{f.type}</span>
                      <span className="text-xs text-lime-400">Edit →</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => handleRemove(selectedEntry.folder)}
                  disabled={removing === selectedEntry.folder}
                  className="h-8 px-4 rounded-lg text-xs font-medium border border-rose-700/70 bg-rose-900/40 text-rose-300 hover:bg-rose-900/70 transition-colors disabled:opacity-40"
                >
                  {removing === selectedEntry.folder ? 'Removing…' : 'Remove from cfgeconomycore.xml'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Add new pack form */
          <>
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-200">Add Custom Types Pack</h2>
              <p className="text-xs text-slate-500 mt-0.5">Registers a new types file in cfgeconomycore.xml</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950">

              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pack name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => { setName(e.target.value); setSuccess(false); }}
                    placeholder="e.g. ParagonGear"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-lime-500"
                  />
                  {trimmedName && (
                    <p className="text-xs text-slate-500 font-mono">
                      CustomTypes/{trimmedName}_ce/{trimmedName}_types.xml
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">types.xml content</label>
                  <button
                    onClick={handleFileUpload}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-xs font-medium transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Browse for file…
                  </button>
                  <textarea
                    value={xml}
                    onChange={e => { setXml(e.target.value); setSuccess(false); }}
                    placeholder="…or paste types.xml content here"
                    rows={14}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-lime-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleAddSave}
                  disabled={!canSave || saving}
                  className={`h-8 px-4 rounded-lg text-xs font-medium transition-colors ${
                    canSave && !saving
                      ? 'bg-lime-500 hover:bg-lime-600 text-white'
                      : 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {saving ? 'Saving…' : 'Save & Register'}
                </button>
                {!paths.economyCorePath && (
                  <p className="text-xs text-amber-400">cfgeconomycore.xml not found — cannot save.</p>
                )}
                {success && <p className="text-xs text-emerald-400">Saved successfully.</p>}
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
