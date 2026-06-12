import { useMemo, useState } from 'react';
import { Archive, FileText, Plus, Search, Sparkles, X } from 'lucide-react';
import { Note, noteTitle } from '../lib/notes';
import SwipeableNoteRow from '../components/SwipeableNoteRow';
import Fab from '../components/Fab';

export default function NotesScreen({
  notes,
  recentNames,
  favorites,
  archived,
  selectedName,
  onOpen,
  onCreate,
  onDelete,
  onArchive,
  onShare,
  onToggleFavorite,
}: {
  notes: Note[];
  recentNames: string[];
  favorites: string[];
  archived: string[];
  selectedName: string | null;
  onOpen: (note: Note) => void;
  onCreate: (useAi: boolean) => void;
  onDelete: (note: Note) => void;
  onArchive: (note: Note) => void;
  onShare: (note: Note) => void;
  onToggleFavorite: (note: Note) => void;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes.filter((n) => (showArchived ? archived.includes(n.name) : !archived.includes(n.name)));
    if (q) {
      list = list.filter(
        (n) => n.name.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    // お気に入りを先頭に
    return [...list].sort((a, b) => {
      const fa = favorites.includes(a.name) ? 0 : 1;
      const fb = favorites.includes(b.name) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes, query, archived, favorites, showArchived]);

  const recentNotes = useMemo(
    () =>
      recentNames
        .map((name) => notes.find((n) => n.name === name))
        .filter((n): n is Note => Boolean(n))
        .slice(0, 10),
    [recentNames, notes],
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* 検索バー */}
      <div className="shrink-0 space-y-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-500" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-600"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ノート・タグを検索"
          />
          {query && (
            <button onClick={() => setQuery('')}>
              <X className="h-4 w-4 text-gray-500" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
            showArchived ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/5 text-gray-400'
          }`}
        >
          <Archive className="h-3 w-3" />
          {showArchived ? 'アーカイブ表示中' : 'アーカイブを表示'}
        </button>
      </div>

      {/* 最近開いたノートのカルーセル */}
      {!showArchived && recentNotes.length > 0 && (
        <div className="shrink-0 pb-2">
          <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            最近開いたノート
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
            {recentNotes.map((note) => (
              <button
                key={note.name}
                onClick={() => onOpen(note)}
                className={`flex max-w-[160px] shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  selectedName === note.name
                    ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                    : 'border-white/10 bg-white/5 text-gray-300 active:bg-white/10'
                }`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{noteTitle(note.name)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ノート一覧（スワイプアクション付き） */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-28">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {showArchived ? 'アーカイブされたノートはありません' : 'ノートがありません。右下の＋から作成できます'}
          </div>
        ) : (
          filtered.map((note) => (
            <SwipeableNoteRow
              key={note.name}
              note={note}
              isActive={selectedName === note.name}
              isFavorite={favorites.includes(note.name)}
              onOpen={() => onOpen(note)}
              onDelete={() => onDelete(note)}
              onArchive={() => onArchive(note)}
              onShare={() => onShare(note)}
              onToggleFavorite={() => onToggleFavorite(note)}
            />
          ))
        )}
      </div>

      {/* FAB */}
      <div className="absolute bottom-5 right-4 flex flex-col items-end gap-3">
        {fabOpen && (
          <>
            <button
              onClick={() => { setFabOpen(false); onCreate(true); }}
              className="flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-violet-500"
            >
              <Sparkles className="h-4 w-4" /> AIノート作成
            </button>
            <button
              onClick={() => { setFabOpen(false); onCreate(false); }}
              className="flex items-center gap-2 rounded-full bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-gray-600"
            >
              <FileText className="h-4 w-4" /> 新規ノート
            </button>
          </>
        )}
        <Fab
          onClick={() => setFabOpen((v) => !v)}
          label="新規作成"
          icon={<Plus className={`h-6 w-6 transition-transform ${fabOpen ? 'rotate-45' : ''}`} />}
        />
      </div>
    </div>
  );
}
