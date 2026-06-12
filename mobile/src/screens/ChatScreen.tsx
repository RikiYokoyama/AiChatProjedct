import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Loader2, Mic, MicOff, Send, X } from 'lucide-react';
import { ChatMessage } from '../lib/gemini';
import { Note, noteTitle } from '../lib/notes';
import MarkdownView from '../components/MarkdownView';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useSpeechInput } from '../hooks/useSpeechInput';

export default function ChatScreen({
  history,
  streamedText,
  isGenerating,
  contextNote,
  chatMode,
  chatModes,
  autoSaveStatus,
  onSend,
  onChangeChatMode,
  onClearContext,
  onWikiLinkClick,
}: {
  history: ChatMessage[];
  streamedText: string;
  isGenerating: boolean;
  contextNote: Note | null;
  chatMode: string;
  chatModes: { id: string; label: string }[];
  autoSaveStatus: 'idle' | 'saving' | 'saved';
  onSend: (text: string) => void;
  onChangeChatMode: (mode: string) => void;
  onClearContext: () => void;
  onWikiLinkClick: (name: string) => void;
}) {
  const [input, setInput] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useKeyboardInset();

  const speech = useSpeechInput((text) => setInput((prev) => prev + text));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamedText]);

  function send() {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');
    onSend(text);
  }

  const currentModeLabel = chatModes.find((m) => m.id === chatMode)?.label ?? chatMode;

  return (
    <div className="flex h-full flex-col" style={{ paddingBottom: keyboardInset }}>
      {/* コンテキストノート表示 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2">
        <button
          onClick={() => setShowModePicker((v) => !v)}
          className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-300"
        >
          {currentModeLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {contextNote && (
          <span className="flex min-w-0 items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-400">
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{noteTitle(contextNote.name)}</span>
            <button onClick={onClearContext} aria-label="コンテキスト解除">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-500">
          {autoSaveStatus === 'saving' ? '保存中...' : autoSaveStatus === 'saved' ? '✓ 保存済み' : ''}
        </span>
      </div>

      {showModePicker && (
        <div className="shrink-0 border-b border-white/10 bg-[#0b1020] px-4 py-2">
          <div className="flex flex-wrap gap-1.5">
            {chatModes.map((m) => (
              <button
                key={m.id}
                onClick={() => { onChangeChatMode(m.id); setShowModePicker(false); }}
                className={`rounded-full px-3 py-1.5 text-xs ${
                  chatMode === m.id ? 'bg-indigo-600 text-white' : 'bg-white/5 text-gray-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* メッセージ一覧 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {history.length === 0 && !streamedText && (
          <div className="py-12 text-center text-sm text-gray-500">
            AIに質問してみましょう。
            {contextNote ? ` 現在「${noteTitle(contextNote.name)}」を文脈として参照中です。` : ' ノートを開いてから質問すると、その内容を踏まえて回答します。'}
            <br />
            会話は自動でノートに保存されます。
          </div>
        )}
        {history.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user' ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5'
              }`}
            >
              {msg.role === 'user' ? (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              ) : (
                <MarkdownView text={msg.content} onWikiLinkClick={onWikiLinkClick} />
              )}
            </div>
          </div>
        ))}
        {streamedText && (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-2xl border border-indigo-500/30 bg-white/5 px-4 py-2.5 text-sm">
              <MarkdownView text={streamedText} />
            </div>
          </div>
        )}
        {isGenerating && !streamedText && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 考え中...
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 入力欄 */}
      <div className="shrink-0 border-t border-white/10 bg-[#0b1020] p-3">
        <div className="flex items-end gap-2">
          <button
            onClick={() => (speech.isListening ? speech.stop() : speech.start())}
            disabled={!speech.supported}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              speech.isListening ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'
            } disabled:opacity-30`}
            aria-label="音声入力"
          >
            {speech.isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={1}
            placeholder="AIに質問..."
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500/50"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || isGenerating}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white active:bg-indigo-500 disabled:opacity-40"
            aria-label="送信"
          >
            {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
