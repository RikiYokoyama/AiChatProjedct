import { useRef, useMemo, useState } from 'react';
import { BookOpen, Brackets, ChevronDown, ChevronRight, Check, Edit3, Eye, FileText, FolderClosed, FolderOpen, List, ListTree, Loader2, Mic, MicOff, Search, Send, Sparkles, Tag, X, Zap } from 'lucide-react';

function buildMobileFileTree(notes: { name: string; remotePath?: string }[]): Record<string, { name: string; remotePath?: string }[]> {
  const tree: Record<string, { name: string; remotePath?: string }[]> = {};
  notes.forEach((note) => {
    const fullPath = note.remotePath || note.name;
    const parts = fullPath.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(note);
  });
  return tree;
}

function parseOutlineMobile(content: string) {
  return content.split('\n').flatMap((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    return m ? [{ level: m[1].length, text: m[2].trim(), line: i }] : [];
  });
}
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
  pendingPrompt,
  onAddPrompt,
  onDismissPrompt,
  chatMode,
  chatModes,
  onChangeChatMode,
  onAiAction,
  onAddTag,
  onRemoveTag,
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
  pendingPrompt: { name: string; instruction: string } | null;
  onAddPrompt: () => void;
  onDismissPrompt: () => void;
  chatMode: string;
  chatModes: { id: string; label: string }[];
  onChangeChatMode: (mode: string) => void;
  onAiAction: (action: 'title' | 'tags' | 'summary') => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}) {
  const existingNames = useMemo(
    () => new Set(notes.map(n => n.name.toLowerCase())),
    [notes],
  );

  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [pickerView, setPickerView] = useState<'list' | 'tree'>('list');
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const keyboardInset = useKeyboardInset();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const editorSpeech = useSpeechInput((text) => {
    insertAtCursor(text);
  });

  const speech = useSpeechInput((text) => {
    setChatInput((prev) => prev + text);
  });

  function insertAtCursor(text: string) {
    const ta = editorRef.current;
    if (!ta) { onChangeContent(content + text); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = content.slice(0, start) + text + content.slice(end);
    onChangeContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function wrapSelectionWithWikiLink() {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const next = content.slice(0, start) + `[[${selected}]]` + content.slice(end);
    onChangeContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + 2, start + 2 + selected.length);
    });
  }

  function generateFromTitle() {
    if (!selectedNote || isGenerating) return;
    onSend(noteTitle(selectedNote.name));
  }

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
          content === '' ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
            </div>
          ) : editMode === 'edit' ? (
            <textarea
              ref={editorRef}
              className="h-full w-full resize-none bg-[#090d19] p-4 font-mono text-sm leading-7 text-white outline-none"
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              spellCheck={false}
              placeholder="ここに直接書き込めます..."
            />
          ) : (
            <div ref={previewRef} className="h-full overflow-y-auto px-4 py-3">
              <MarkdownView text={content} onWikiLinkClick={onWikiLinkClick} existingNames={existingNames} />
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

      {/* ── タグ表示（編集モード時） ── */}
      {selectedNote && editMode === 'edit' && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-white/5 px-4 py-2">
          {selectedNote.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
              #{tag}
              <button onClick={() => onRemoveTag(tag)} aria-label="タグ削除"><X className="h-3 w-3 text-emerald-400/60" /></button>
            </span>
          ))}
          {showTagInput ? (
            <form onSubmit={(e) => { e.preventDefault(); if (newTag.trim()) onAddTag(newTag.trim()); setNewTag(''); setShowTagInput(false); }} className="flex items-center gap-1">
              <input autoFocus value={newTag} onChange={(e) => setNewTag(e.target.value)} onBlur={() => setShowTagInput(false)} placeholder="タグ名" className="h-7 w-28 rounded-full border border-white/10 bg-black/30 px-3 text-xs outline-none" />
            </form>
          ) : (
            <button onClick={() => setShowTagInput(true)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-gray-400 active:bg-white/10" aria-label="タグ追加">
              <Tag className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ── 編集ツールバー ── */}
      {selectedNote && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 bg-[#0b1020] px-2 py-1.5" style={{ scrollbarWidth: 'none' }}>
          {editMode === 'edit' && (
            <>
              <ToolbarButton icon={editorSpeech.isListening ? <MicOff className="h-4 w-4 text-red-400" /> : <Mic className="h-4 w-4" />} label={editorSpeech.isListening ? '停止' : '音声入力'} disabled={!editorSpeech.supported} onClick={() => editorSpeech.isListening ? editorSpeech.stop() : editorSpeech.start()} />
              <div className="h-5 w-px shrink-0 bg-white/10" />
            </>
          )}
          <ToolbarButton icon={<Zap className="h-4 w-4 text-yellow-400" />} label="タイトルから生成" onClick={generateFromTitle} disabled={isGenerating} />
          <div className="h-5 w-px shrink-0 bg-white/10" />
          <ToolbarButton icon={<Tag className="h-4 w-4" />} label="タグ生成" onClick={() => onAiAction('tags')} />
          <ToolbarButton icon={<ListTree className="h-4 w-4" />} label="要約" onClick={() => onAiAction('summary')} />
          {selectedNote && (
            <>
              <div className="h-5 w-px shrink-0 bg-white/10" />
              <ToolbarButton icon={<ListTree className="h-4 w-4 text-indigo-400" />} label="アウトライン" onClick={() => setShowOutline(true)} />
            </>
          )}
          {editMode === 'edit' && (
            <>
              <div className="h-5 w-px shrink-0 bg-white/10" />
              <ToolbarButton icon={<Brackets className="h-4 w-4" />} label="[[リンク]]" onClick={wrapSelectionWithWikiLink} />
            </>
          )}
        </div>
      )}

      {/* ── AIチャット入力欄 ── */}
      <div className="shrink-0 border-t border-white/10 bg-[#0b1020] px-2 pb-2 pt-1.5">
        {/* プロンプト追加確認バナー（PC側と同仕様） */}
        {pendingPrompt && (
          <div className="mb-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5">
            <p className="text-xs font-semibold text-indigo-300">✨ 新しいカスタムプロンプトを追加しますか？</p>
            <p className="mt-0.5 text-[11px] text-gray-400">名前: {pendingPrompt.name}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={onAddPrompt} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-indigo-500">
                はい (追加する)
              </button>
              <button onClick={onDismissPrompt} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 active:bg-white/10">
                いいえ (チャットで調整する)
              </button>
            </div>
          </div>
        )}
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

      {/* ── アウトライン ボトムシート ── */}
      {showOutline && selectedNote && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowOutline(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[60vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1225]">
            <div className="flex shrink-0 flex-col items-center px-4 pb-2 pt-3">
              <div className="mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex w-full items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">アウトライン</h2>
                  <p className="text-[10px] text-indigo-300 truncate max-w-[200px]">{selectedNote.name}</p>
                </div>
                <button onClick={() => setShowOutline(false)} className="rounded-full p-1.5 text-gray-400 active:bg-white/10">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {(() => {
                const headings = parseOutlineMobile(content);
                if (headings.length === 0) return (
                  <p className="py-6 text-center text-sm text-gray-500">見出しがありません</p>
                );
                const minLevel = Math.min(...headings.map(h => h.level));
                return (
                  <div className="space-y-0.5">
                    {headings.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setShowOutline(false);
                          if (editMode === 'preview' && previewRef.current) {
                            const tag = `h${h.level}`;
                            const els = previewRef.current.querySelectorAll(tag);
                            for (const el of els) {
                              if (el.textContent?.trim() === h.text) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                break;
                              }
                            }
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left active:bg-white/5"
                        style={{ paddingLeft: `${(h.level - minLevel) * 14 + 12}px` }}
                      >
                        <span className="shrink-0 text-[9px] font-mono text-gray-600">H{h.level}</span>
                        <span className="text-sm text-gray-200 truncate">{h.text}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* ── ファイルピッカー ボトムシート ── */}
      {showFilePicker && (
        <>
          {/* 背景オーバーレイ */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closePicker}
          />

          {/* シート本体 */}
          <div className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1225]">
            {/* ハンドル */}
            <div className="flex shrink-0 flex-col items-center px-4 pb-2 pt-3">
              <div className="mb-3 h-1 w-10 rounded-full bg-white/20" />
              <div className="flex w-full items-center justify-between">
                <h2 className="text-sm font-bold text-white">ファイルを選択</h2>
                <div className="flex items-center gap-2">
                  {/* リスト/ツリー切り替え */}
                  <div className="flex items-center rounded-lg bg-white/5 p-0.5">
                    <button
                      onClick={() => setPickerView('list')}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${pickerView === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-400 active:bg-white/10'}`}
                    >
                      <List className="h-3 w-3" />
                      リスト
                    </button>
                    <button
                      onClick={() => setPickerView('tree')}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${pickerView === 'tree' ? 'bg-indigo-600 text-white' : 'text-gray-400 active:bg-white/10'}`}
                    >
                      <FolderOpen className="h-3 w-3" />
                      ツリー
                    </button>
                  </div>
                  <button onClick={closePicker} className="rounded-full p-1.5 text-gray-400 active:bg-white/10">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* 検索欄（リストモード時のみ） */}
            {pickerView === 'list' && (
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
            )}

            {/* ファイルリスト / ツリー */}
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {pickerView === 'list' ? (
                filteredNotes.length === 0 ? (
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
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/10 ${isSelected ? 'bg-indigo-500/10' : ''}`}
                      >
                        <FileText className={`h-4 w-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                        <span className={`flex-1 truncate text-sm ${isSelected ? 'font-semibold text-indigo-300' : 'text-gray-200'}`}>
                          {noteTitle(note.name)}
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
                      </button>
                    );
                  })
                )
              ) : (
                /* ツリービュー */
                (() => {
                  const tree = buildMobileFileTree(notes);
                  const dirs = Object.keys(tree).sort();
                  return (
                    <div className="px-2 pt-1">
                      {dirs.map((dir) => {
                        const dirNotes = tree[dir].slice().sort((a, b) => a.name.localeCompare(b.name));
                        const isCollapsed = collapsedDirs.has(dir);
                        if (dir === '') {
                          return dirNotes.map((note) => {
                            const isSelected = selectedNote?.name === note.name;
                            return (
                              <button
                                key={note.name}
                                onClick={() => selectNote(note as any)}
                                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left active:bg-white/10 ${isSelected ? 'bg-indigo-500/10' : ''}`}
                              >
                                <FileText className={`h-4 w-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                                <span className={`flex-1 truncate text-sm ${isSelected ? 'font-semibold text-indigo-300' : 'text-gray-200'}`}>
                                  {note.name.replace(/\.md$/i, '')}
                                </span>
                                {isSelected && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
                              </button>
                            );
                          });
                        }
                        return (
                          <div key={dir} className="mb-1">
                            <button
                              onClick={() => setCollapsedDirs(prev => {
                                const next = new Set(prev);
                                next.has(dir) ? next.delete(dir) : next.add(dir);
                                return next;
                              })}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left active:bg-white/5"
                            >
                              <ChevronRight className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                              {isCollapsed
                                ? <FolderClosed className="h-4 w-4 shrink-0 text-yellow-500/70" />
                                : <FolderOpen className="h-4 w-4 shrink-0 text-yellow-400/80" />
                              }
                              <span className="flex-1 truncate text-sm font-medium text-gray-300">
                                {dir.split('/').pop()}
                              </span>
                              <span className="text-xs text-gray-600">{dirNotes.length}</span>
                            </button>
                            {!isCollapsed && (
                              <div className="ml-6 border-l border-white/5 pl-2">
                                {dirNotes.map((note) => {
                                  const isSelected = selectedNote?.name === note.name;
                                  return (
                                    <button
                                      key={note.name}
                                      onClick={() => selectNote(note as any)}
                                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left active:bg-white/10 ${isSelected ? 'bg-indigo-500/10' : ''}`}
                                    >
                                      <FileText className={`h-4 w-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                                      <span className={`flex-1 truncate text-sm ${isSelected ? 'font-semibold text-indigo-300' : 'text-gray-200'}`}>
                                        {note.name.split('/').pop()?.replace(/\.md$/i, '')}
                                      </span>
                                      {isSelected && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ToolbarButton({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-gray-300 active:bg-white/15 disabled:opacity-40">
      {icon}{label}
    </button>
  );
}
