interface Props {
  isDirty: boolean;
  onSave: () => void;
  label?: string;
}

export function SaveButton({ isDirty, onSave, label = 'Save' }: Props) {
  return (
    <button
      onClick={onSave}
      disabled={!isDirty}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        isDirty
          ? 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
          : 'bg-slate-800 text-slate-600 cursor-not-allowed'
      }`}
    >
      {isDirty && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
      {label}
    </button>
  );
}
