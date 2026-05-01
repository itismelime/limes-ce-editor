interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function NumberInput({ value, onChange, min, max, className = '' }: Props) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v)) onChange(v);
      }}
      className={`bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 w-16 text-center focus:outline-none focus:border-indigo-500 ${className}`}
    />
  );
}
