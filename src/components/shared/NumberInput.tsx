import { useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function NumberInput({ value, onChange, min, max, className = '' }: Props) {
  // Draft holds in-progress text ('' or '-') so the field can be cleared and
  // negative values typed; blur snaps back to the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      value={draft ?? value}
      min={min}
      max={max}
      onChange={e => {
        setDraft(e.target.value);
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v)) onChange(v);
      }}
      onBlur={() => setDraft(null)}
      className={`bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 w-16 text-center focus:outline-none focus:border-lime-500 ${className}`}
    />
  );
}
