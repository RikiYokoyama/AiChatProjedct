import { useRef, useState } from 'react';
import { ArrowLeft, Brackets, ChevronDown, Edit3, Eye, ListTree, Loader2, Mic, MicOff, Network, Plus, Send, Sparkles, Tag, X } from 'lucide-react';
import { Note, noteTitle } from '../lib/notes';
import MarkdownView from '../components/MarkdownView';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useSpeechInput } from '../hooks/useSpeechInput';

export default function EditorScreen({
  note,
  content,
  isGenerating,
  onChangeContent,
  onBack,
  onWikiLinkClick,
  onAddTag,
  onRemoveTag,
  onAiAction,
  onOpenLocalGraph,
  onSend,
  chatMode,
  chatModes,
  onChangeChatMode,
}: {
  note: Note;
  content: string;
  isGenerating: boolean;
  onChangeContent: (text: string) => void;
  onBack: () => void;
  onWikiLinkClick: (name: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onAiAction: (action: 'title' | 'tags' | 'summary') => void;
  onOpenLocalGraph: () => void;
  onSend: (text: string) => void;
  chatMode: string;
  chatModes: { id: string; label: string }[];
  onChangeChatMode: (mode: string) => void;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [newTag, setNewTag] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const keyboardInset = useKeyboardInset();
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // エディタ用音声入力
  const speech = useSpeechInput((text) => {
    insertAtCursor(text);
  });

  // チャット用音声入力
  const chatSpeech = useSpeechInput((text) => {
    setChatInput((prev) => prev + text);
  });

  function insertAtCursor(text: string) {
    const ta = editorRef.current;
    if (!ta) {
      onChangeContent(content + text);
      return;
    }
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

  function sendChat() {
    const text = chatInput.trim();
    if (!text || isGenerating) return;
    setChatInput('');
    onSend(text);
  }

  // プレビュー画面での左右スワイプによるモード切替
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
      setMode((m) => (m === 'preview' ? 'edit' : 'preview'));
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ paddingBottom: keyboardInset }}>
      {/* ヘッダー */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-2">
        <button onClick={onBack} className="rounded-full p-2 text-gray-400 active:bg-white/10">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{noteTitle(note.name)}</h1>
        <button
          onClick={onOpenLocalGraph}
          className="rounded-full p-2 text-gray-400 active:bg-white/10"
          aria-label="ローカルグラフ"
        >
          <Network className="h-5 w-5" />
        </button>
        <button
          onClick={() => setMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
            mode === 'edit' ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/5 text-gray-300'
          }`}
        >
          {mode === 'edit' ? <Eye className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
          {mode === 'edit' ? 'プレビュー' : '編集'}
        </button>
      </div>

      {/* タグ */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/5 px-4 py-2">
        {note.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300"
          >
            #{tag}
            <button onClick={() => onRemoveTag(tag)} aria-label="タグ削除">
              <X className="h-3 w-3 text-emerald-400/60" />
            </button>
          </span>
        ))}
        {showTagInput ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newTag.trim()) onAddTag(newTag.trim());
              setNewTag('');
              setShowTagInput(false);
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onBlur={() => setShowTagInput(false)}
              placeholder="タグ名"
              className="h-7 w-28 rounded-full border border-white/10 bg-black/30 px-3 text-xs outline-none"
            />
          </form>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-gray-400 active:bg-white/10"
            aria-label="タグ追加"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 本文（スワイプで編集/プレビュー切替） */}
      <div className="min-h-0 flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {mode === 'edit' ? (
          <textarea
            ref={editorRef}
            className="h-full w-full resize-none bg-[#090d19] p-4 font-mono text-sm leading-7 text-gray-100 outline-none"
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 pb-8 pt-2">
            <MarkdownView text={content} onWikiLinkClick={onWikiLinkClick} />
            {isGenerating && (
              <div className="mt-3 flex items-center gap-2 text-xs text-indigo-400">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" /> AIが本文を生成中...
              </div>
            )}
          </div>
        )}
      </div>

      {/* クイックAIアクションツールバー（編集時のみ） */}
      {mode === 'edit' && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-white/10 bg-[#0b1020] px-2 py-1.5" style={{ scrollbarWidth: 'none' }}>
          <ToolbarButton
            icon={speech.isListening ? <MicOff className="h-4 w-4 text-red-400" /> : <Mic className="h-4 w-4" />}
            label={speech.isListening ? '停止' : '音声入力'}
            disabled={!speech.supported}
            onClick={() => (speech.isListening ? speech.stop() : speech.start())}
          />
          <div className="h-5 w-px shrink-0 bg-white/10" />
          <ToolbarButton icon={<Sparkles className="h-4 w-4" />} label="タイトル生成" onClick={() => onAiAction('title')} />
          <ToolbarButton icon={<Tag className="h-4 w-4" />} label="タグ生成" onClick={() => onAiAction('tags')} />
          <ToolbarButton icon={<ListTree className="h-4 w-4" />} label="要約" onClick={() => onAiAction('summary')} />
          <div className="h-5 w-px shrink-0 bg-white/10" />
          <ToolbarButton icon={<Brackets className="h-4 w-4" />} label="[[リンク]]" onClick={wrapSelectionWithWikiLink} />
        </div>
      )}

      {/* AIチャット入力欄 */}
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

        {/* 入力行 */}
        <div className="flex items-end gap-2">
          {/* モード選択ボタン */}
          <button
            onClick={() => setShowModePicker((v) => !v)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 text-xs font-semibold text-indigo-300 active:bg-indigo-500/30"
          >
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

          {/* 音声入力 */}
          <button
            onClick={() => (chatSpeech.isListening ? chatSpeech.stop() : chatSpeech.start())}
            disabled={!chatSpeech.supported}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              chatSpeech.isListening ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'
            } disabled:opacity-30`}
            aria-label="音声入力"
          >
            {chatSpeech.isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          {/* 送信 */}
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
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-gray-300 active:bg-white/15 disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}
