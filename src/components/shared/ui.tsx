import type { ReactNode } from 'react';

// Highlight classes for the selected row in editor lists.
export const SELECTED_ROW_CLASS = 'bg-lime-950/40 border-l-2 border-l-lime-500';

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{children}</h2>;
}

// Detail-panel close button (the X in panel headers).
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
