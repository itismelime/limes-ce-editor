import { useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '../../lib/fileDiscovery';
import { useServerStore } from '../../store/serverStore';

interface EditingFile {
  path: string;
  name: string;
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
  const fileInputRef            = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && xml.trim().length > 0 && !!paths.economyCorePath;
  const selectedEntry = economyCore.find(e => e.folder === selectedFolder) ?? null;

  async function handleSelectFile(folder: string, fileName: string) {
    if (!paths.missionPath) return;
    const filePath = `${paths.missionPath}/${folder}/${fileName}`;
    try {
      const content = await readFile(filePath);
      setEditingFile({ path: filePath, name: fileName, content, dirty: false });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to read ${fileName}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleSaveFile() {
    if (!editingFile) return;
    setSaving(true);
    try {
      await writeFile(editingFile.path, editingFile.content);
      setEditingFile({ ...editingFile, dirty: false });
    } catch (err) {
      useServerStore.setState({ saveError: `Failed to save ${editingFile.name}: ${err instanceof Error ? err.message : String(err)}` });
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
        useServerStore.setState({ saveError: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` });
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
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">cfgeconomycore.xml</h2>
          <button
            onClick={() => { setSelectedFolder(null); setEditingFile(null); }}
            className="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            + Add pack
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {economyCore.length === 0 ? (
            <p className="text-slate-600 text-xs px-4 py-3">No entries loaded.</p>
          ) : (
            economyCore.map((entry, i) => {
              const isSelected = selectedFolder === entry.folder;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60 cursor-pointer transition-colors ${
                    isSelected ? 'bg-slate-800' : 'hover:bg-slate-800/50'
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
                    className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium bg-red-900/60 hover:bg-red-700 text-red-300 hover:text-white transition-colors disabled:opacity-40"
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
              {editingFile.dirty && (
                <span className="flex items-center gap-1.5 text-amber-400 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Unsaved
                </span>
              )}
              <button
                onClick={handleSaveFile}
                disabled={!editingFile.dirty || saving}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  editingFile.dirty && !saving
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="flex-1 overflow-hidden px-6 py-4">
              <textarea
                value={editingFile.content}
                onChange={e => setEditingFile({ ...editingFile, content: e.target.value, dirty: true })}
                className="w-full h-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </>
        ) : selectedEntry ? (
          /* Entry detail view */
          <>
            <div className="px-6 py-4 border-b border-slate-800">
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
                      onClick={() => handleSelectFile(selectedEntry.folder, f.name)}
                      className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-700 rounded px-3 py-2 transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-slate-200 font-mono flex-1">{f.name}</span>
                      <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded">{f.type}</span>
                      <span className="text-xs text-indigo-400">Edit →</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => handleRemove(selectedEntry.folder)}
                  disabled={removing === selectedEntry.folder}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-900/60 hover:bg-red-700 text-red-300 hover:text-white transition-colors disabled:opacity-40"
                >
                  {removing === selectedEntry.folder ? 'Removing…' : 'Remove from cfgeconomycore.xml'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Add new pack form */
          <>
            <div className="px-6 py-4 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-200">Add Custom Types Pack</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Creates <span className="text-slate-400">CustomTypes/&#123;Name&#125;_ce/&#123;Name&#125;_types.xml</span> and registers it in cfgeconomycore.xml.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Pack name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setSuccess(false); }}
                  placeholder="e.g. ParagonGear"
                  className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
                {trimmedName && (
                  <p className="text-xs text-slate-600 mt-1">
                    → CustomTypes/{trimmedName}_ce/{trimmedName}_types.xml
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">types.xml content</label>
                  <button onClick={handleFileUpload} className="text-xs text-indigo-400 hover:text-indigo-300">
                    Upload file…
                  </button>
                </div>
                <textarea
                  value={xml}
                  onChange={e => { setXml(e.target.value); setSuccess(false); }}
                  placeholder="Paste types.xml content here, or upload a file above…"
                  rows={16}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAddSave}
                  disabled={!canSave || saving}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    canSave && !saving
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                  }`}
                >
                  {saving ? 'Saving…' : 'Save & Register'}
                </button>
                {!paths.economyCorePath && (
                  <p className="text-xs text-amber-400">cfgeconomycore.xml not found — cannot save.</p>
                )}
                {success && <p className="text-xs text-green-400">Saved successfully.</p>}
              </div>
            </div>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".xml" className="hidden" />
      </div>
    </div>
  );
}
