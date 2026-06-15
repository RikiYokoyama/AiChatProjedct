import { useRef, useState } from 'react';
import { BookOpen, ChevronDown, Check, Edit3, Eye, FileText, Loader2, Mic, MicOff, Search, Send, Sparkles, X } from 'lucide-react';
import { Note, noteTitle } from '../lib/notes';
import MarkdownView from '../components/MarkdownView';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useSpeechInput } from '../hooks/useSpeechInput';

export default function NoteScreen({
  notes,
  selectedNote,
  content,
  autoSaveStatus,
  isGenerating,
  onChangeContent,
  onSelectNote,
  onSend,
  onWikiLinkClick,
  chatMode,
  chatModes,
  onChangeChatMode,
}: {
  notes: Note[];
  selectedNote: Note | null;
  content: string;
  autoSaveStatus: 'idle' | 'saving' | 'saved';
  isGenerating: boolean;
  onChangeContent: (text: string) => void;
  onSelectNote: (note: Note) => void;
  onSend: (text: string) => void;
  onWikiLinkClick: (name: string) => void;
  chatMode: string;
  chatModes: { id: string; label: string }[];
  onChangeChatMode: (mode: string) => void;
}) {
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const keyboardInset = useKeyboardInset();

  const speech = useSpeechInput((text) => {
    setChatInput((prev) => prev + text);
  });

  // スワイプで編集/プレビュー切替
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
      setEditMode((m) => (m === 'preview' ? 'edit' : 'preview'));
    }
  };

  function openPicker() {
    setSearchQuery('');
    setShowFilePicker(true);
  }

  function closePicker() {
    setShowFilePicker(false);
    setSearchQuery('');
  }

  function selectNote(note: Note) {
    onSelectNote(note);
    closePicker();
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text || isGenerating) return;
    setChatInput('');
    onSend(text);
  }

  const filteredNotes = searchQuery.trim()
    ? notes.filter((n) =>
        noteTitle(n.name).toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : notes;

  return (
    <div className="flex h-full flex-col bg-[#070a13]" style={{ paddingBottom: keyboardInset }}>

      {/* ── トップバー ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          onClick={openPicker}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-left active:bg-white/10"
        >
          <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
          <span className="min-w-0 flex-1 truncate text-sm text-white">
            {selectedNote ? noteTitle(selectedNote.name) : 'ファイルを選択...'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        </button>

        {selectedNote && (
          <button
            onClick={() => setEditMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
            className="flex items-center gap-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-gray-300 active:bg-white/10"
          >
            {editMode === 'edit' ? <Eye className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
            {editMode === 'edit' ? 'プレビュー' : '編集'}
          </button>
        )}

        <span className="shrink-0 text-[10px] text-gray-500">
          {autoSaveStatus === 'saving' ? '保存中...' : autoSaveStatus === 'saved' ? '✓ 保存済み' : ''}
        </span>
      </div>

      {/* ── ノート本文エリア ── */}
      <div
        className="min-h-0 flex-1"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {selectedNote ? (
          editMode === 'edit' ? (
            <textarea
              className="h-full w-full resize-none bg-[#090d19] p-4 font-mono text-sm leading-7 text-white outline-none"
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              spellCheck={false}
              placeholder="ここに直接書き込めます..."
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-3">
              <MarkdownView text={content} onWikiLinkClick={onWikiLinkClick} />
            </div>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
            <BookOpen className="h-10 w-10 opacity-30" />
            <p className="text-sm">上のバーからファイルを選択してください</p>
            <button
              onClick={openPicker}
              className="mt-1 rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white active:bg-indigo-500"
            >
              ファイルを選ぶ
            </button>
          </div>
        )}
      </div>

      {/* ── AIチャット入力欄 ── */}
      <div className="shrink-0 border-t border-white/10 bg-[#0b1020] px-2 pb-2 pt-1.5">
        {/* モードピッカー（展開時） */}
        {showModePicker && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chatModes.map((m) => (
              <button
                key={m.id}
                onClick={() => { onChangeChatMode(m.id); setShowModePicker(false); }}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  chatMode === m.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-300 active:bg-white/10'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* モード選択ボタン */}
          <button
            onClick={() => setShowModePicker((v) => !v)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 text-xs font-semibold text-indigo-300 active:bg-indigo-500/30"
          >
            <Sparkles className="h-3 w-3" />
            {chatModes.find((m) => m.id === chatMode)?.label ?? chatMode}
            <ChevronDown className={`h-3 w-3 transition-transform ${showModePicker ? 'rotate-180' : ''}`} />
          </button>

          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            rows={1}
            placeholder="AIに質問 or 指示..."
            className="max-h-24 min-h-[36px] flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-indigo-500/50"
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendChat();
            }}
          />

          <button
            onClick={() => (speech.isListening ? speech.stop() : speech.start())}
            disabled={!speech.supported}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              speech.isListening ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'
            } disabled:opacity-30`}
            aria-label="音声入力"
          >
            {speech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            onClick={sendChat}
            disabled={!chatInput.trim() || isGenerating}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white active:bg-indigo-500 disabled:opacity-40"
            aria-label="送信"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── ファイルピッカー ボトムシート ── */}
      {showFilePicker && (
        <>
          {/* 背景オーバーレイ */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closePicker}
          />

          {/* シート本体 */}
          <div className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[65vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1225]">
            {/* ハンドル */}
            <div className="flex shrink-0 flex-col items-center px-4 pb-2 pt-3">
              <div className="mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex w-full items-center justify-between">
                <h2 className="text-sm font-bold text-white">ファイルを選択</h2>
                <button onClick={closePicker} className="rounded-full p-1.5 text-gray-400 active:bg-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* 検索欄 */}
            <div className="shrink-0 px-4 pb-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-gray-500" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ファイルを検索..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')}>
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                )}
              </div>
            </div>

            {/* ファイルリスト */}
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {filteredNotes.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  {searchQuery ? '該当するファイルがありません' : 'ファイルがありません'}
                </p>
              ) : (
                filteredNotes.map((note) => {
                  const isSelected = selectedNote?.name === note.name;
                  return (
                    <button
                      key={note.name}
                      onClick={() => selectNote(note)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/10 ${
                        isSelected ? 'bg-indigo-500/10' : ''
                      }`}
                    >
                      <FileText className={`h-4 w-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                      <span className={`flex-1 truncate text-sm ${isSelected ? 'font-semibold text-indigo-300' : 'text-gray-200'}`}>
                        {noteTitle(note.name)}
                      </span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
