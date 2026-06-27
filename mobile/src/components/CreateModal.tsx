import { useEffect, useRef } from 'react';
import { Heading2, List, ListOrdered, X } from 'lucide-react';

export default function CreateModal({
  title,
  placeholder,
  submitLabel,
  value,
  onChange,
  onSubmit,
  onClose,
  showFormatButtons = false,
  children,
}: {
  title: string;
  placeholder: string;
  submitLabel: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  showFormatButtons?: boolean;
  children?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onSubmit();
  };

  function insertLinePrefix(prefix: string) {
    const ta = inputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', start);
    const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    let next: string;
    let newCursor: number;
    if (line.startsWith(prefix)) {
      next = value.slice(0, lineStart) + line.slice(prefix.length) + value.slice(lineEnd === -1 ? value.length : lineEnd);
      newCursor = Math.max(lineStart, start - prefix.length);
    } else {
      next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      newCursor = start + prefix.length;
    }
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(newCursor, newCursor); });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-t-2xl border-t border-white/10 bg-[#0d1225] px-4 pb-8 pt-4">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-gray-400 active:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {children}

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={4}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-indigo-500/50"
        />

        {showFormatButtons && (
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insertLinePrefix('## ')}
              className="flex items-center justify-center rounded-lg bg-white/5 p-2 text-gray-300 active:bg-white/15"
            >
              <Heading2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insertLinePrefix('- ')}
              className="flex items-center justify-center rounded-lg bg-white/5 p-2 text-gray-300 active:bg-white/15"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => insertLinePrefix('1. ')}
              className="flex items-center justify-center rounded-lg bg-white/5 p-2 text-gray-300 active:bg-white/15"
            >
              <ListOrdered className="h-4 w-4" />
            </button>
          </div>
        )}

        <p className="mt-1 text-right text-[10px] text-gray-500">Ctrl+Enter で確定</p>

        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          className="mt-3 w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white active:bg-indigo-500 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
