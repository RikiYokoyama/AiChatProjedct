import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, FileText, Plus, Search, Sparkles, StickyNote, X } from 'lucide-react';
import { Note, isEmptyNote, noteTitle } from '../lib/notes';
import SwipeableNoteRow from '../components/SwipeableNoteRow';
import Fab from '../components/Fab';
import CreateModal from '../components/CreateModal';

type ModalType = 'file' | 'ai' | 'memo' | 'moc' | null;

export default function FilesScreen({
  notes,
  recentNames,
  favorites,
  archived,
  selectedName,
  chatModes,
  onOpen,
  onCreate,
  onCreateMemo,
  onCreateMoc,
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
  chatModes: { id: string; label: string }[];
  onOpen: (note: Note) => void;
  onCreate: (title: string, useAi: boolean, aiMode?: string) => void;
  onCreateMemo: (title: string) => void;
  onDelete: (note: Note) => void;
  onArchive: (note: Note) => void;
  onShare: (note: Note) => void;
  onToggleFavorite: (note: Note) => void;
  onCreateMoc: (title: string, useAi?: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<'all' | 'moc'>('all');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc');
  const [fabOpen, setFabOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedAiMode, setSelectedAiMode] = useState('long-explain');
  const [mocUseAi, setMocUseAi] = useState(false);

  const openModal = (type: ModalType) => {
    setModal(type);
    setInputValue('');
    setFabOpen(false);
  };

  const closeModal = () => {
    setModal(null);
    setInputValue('');
  };

  const handleSubmit = () => {
    if (!inputValue.trim()) return;
    if (modal === 'file') onCreate(inputValue.trim(), false);
    else if (modal === 'ai') onCreate(inputValue.trim(), true, selectedAiMode);
    else if (modal === 'memo') onCreateMemo(inputValue.trim());
    else if (modal === 'moc' as ModalType) onCreateMoc(inputValue.trim(), mocUseAi);
    closeModal();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes.filter((n) => {
      const isMoc = (n.remotePath ?? n.name).startsWith('moc/');
      if (view === 'moc') return isMoc;
      if (showArchived) return archived.includes(n.name);
      return !archived.includes(n.name) && !isMoc;
    });
    if (q) {
      list = list.filter(
        (n) => n.name.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      const fa = favorites.includes(a.name) ? 0 : 1;
      const fb = favorites.includes(b.name) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name, 'ja');
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name, 'ja');
      if (sortBy === 'date-asc') return a.updatedAt.localeCompare(b.updatedAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes, query, archived, favorites, showArchived, view, sortBy]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const recentNotes = useMemo(
    () =>
      recentNames
        .map((name) => notes.find((n) => n.name === name))
        .filter((n): n is Note => Boolean(n))
        .slice(0, 10),
    [recentNames, notes],
  );

  return (
    <div className="relative flex h-full flex-col bg-[#070a13]">
      {/* 検索バー */}
      <div className="shrink-0 space-y-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-500" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-600"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ファイル・タグを検索"
          />
          {query && (
            <button onClick={() => setQuery('')}>
              <X className="h-4 w-4 text-gray-500" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setView('all'); setShowArchived(false); }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
              view === 'all' && !showArchived ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/5 text-gray-400'
            }`}
          >
            <FileText className="h-3 w-3" /> ノート
          </button>
          <button
            onClick={() => { setView('moc'); setShowArchived(false); }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
              view === 'moc' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/5 text-gray-400'
            }`}
          >
            🗺 MOC
          </button>
          <button
            onClick={() => { setView('all'); setShowArchived((v) => !v); }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
              showArchived ? 'bg-amber-500/30 text-amber-300' : 'bg-white/5 text-gray-400'
            }`}
          >
            <Archive className="h-3 w-3" />
            {showArchived ? 'アーカイブ中' : 'アーカイブ'}
          </button>
        </div>
        {/* 並べ替え + ファイル数 */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{filtered.length}<span className="text-gray-600">/{notes.filter(n => !(n.remotePath ?? n.name).startsWith('moc/')).length}件</span></span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-300 outline-none"
          >
            <option value="date-desc">新しい順</option>
            <option value="date-asc">古い順</option>
            <option value="name-asc">名前 A-Z</option>
            <option value="name-desc">名前 Z-A</option>
          </select>
        </div>
      </div>

      {/* 最近開いたファイルのカルーセル */}
      {!showArchived && recentNotes.length > 0 && (
        <div className="shrink-0 pb-2">
          <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            最近開いたファイル
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

      {/* ファイル一覧（仮想スクロール） */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {showArchived ? 'アーカイブされたファイルはありません' : 'ファイルがありません。右下の＋から作成できます'}
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const note = filtered[virtualRow.index];
              return (
                <div
                  key={note.name}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="mb-1.5">
                    <SwipeableNoteRow
                      note={note}
                      isActive={selectedName === note.name}
                      isFavorite={favorites.includes(note.name)}
                      isEmpty={note.content !== '' && isEmptyNote(note.content)}
                      onOpen={() => onOpen(note)}
                      onDelete={() => onDelete(note)}
                      onArchive={() => onArchive(note)}
                      onShare={() => onShare(note)}
                      onToggleFavorite={() => onToggleFavorite(note)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <div className="absolute bottom-5 right-4 flex flex-col items-end gap-3">
        {fabOpen && (
          <>
            {view === 'moc' ? (
              <button
                onClick={() => openModal('moc')}
                className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-emerald-500"
              >
                🗺 MOC作成
              </button>
            ) : (
              <>
            <button
              onClick={() => openModal('ai')}
              className="flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-violet-500"
            >
              <Sparkles className="h-4 w-4" /> AIファイル作成
            </button>
            <button
              onClick={() => openModal('file')}
              className="flex items-center gap-2 rounded-full bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-gray-600"
            >
              <FileText className="h-4 w-4" /> 新規ファイル
            </button>
            <button
              onClick={() => openModal('memo')}
              className="flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg active:bg-amber-400"
            >
              <StickyNote className="h-4 w-4" /> メモ作成
            </button>
              </>
            )}
          </>
        )}
        <Fab
          onClick={() => setFabOpen((v) => !v)}
          label="新規作成"
          icon={<Plus className={`h-6 w-6 transition-transform ${fabOpen ? 'rotate-45' : ''}`} />}
        />
      </div>

      {/* モーダル */}
      {modal === 'file' && (
        <CreateModal
          title="新規ファイル作成"
          placeholder={`ファイル名を入力...\n（複数行書いても最初の行がタイトルになります）`}
          submitLabel="ファイルを作成"
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
      {modal === 'ai' && (
        <CreateModal
          title="AIファイル作成"
          placeholder={`AIに書かせるテーマを入力...\n（詳しく書くほど精度が上がります）`}
          submitLabel="AIで生成する"
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onClose={closeModal}
        >
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-gray-500">プロンプト</p>
            <div className="flex flex-wrap gap-1.5">
              {chatModes.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedAiMode(m.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selectedAiMode === m.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-white/5 text-gray-300 active:bg-white/10'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </CreateModal>
      )}
      {modal === 'memo' && (
        <CreateModal
          title="メモ作成"
          placeholder={`メモのタイトルを入力...\n（最初の行がタイトルになります）`}
          submitLabel="メモを保存"
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
      {modal === 'moc' && (
        <CreateModal
          title="MOC作成"
          placeholder={`MOCのタイトルを入力...\n（Map of Content: ノートを繋ぐ目次ページ）`}
          submitLabel={mocUseAi ? 'AIで生成する' : 'MOCを作成'}
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          onClose={() => { closeModal(); setMocUseAi(false); }}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={mocUseAi}
              onChange={(e) => setMocUseAi(e.target.checked)}
              className="rounded"
            />
            <span>AIで自動生成する（既存ノートを分析）</span>
          </label>
          {mocUseAi && (
            <p className="mt-1 rounded bg-emerald-900/30 px-2 py-1.5 text-xs text-emerald-400">
              Geminiが全ノートを分析し、テーマ別にリンクを自動生成します
            </p>
          )}
        </CreateModal>
      )}
    </div>
  );
}
