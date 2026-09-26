import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Send } from 'lucide-react';
import MarkdownView from '../components/MarkdownView';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { AiModelMode, ChatMessage, GeminiClient } from '../lib/gemini';
import { QUICK_SYSTEM_PROMPT, QuickSession, newQuickSession, saveQuickTurn } from '../lib/quickChat';

const STREAM_FLUSH_MS = 80;

interface Props {
  geminiApiKey: string;
  gitRemoteUrl: string;
  aiModelMode: AiModelMode;
  masterTags: string[];
  onMasterTagsAdded: (tags: string[]) => void;
  onNoteCreated: () => void;
  onOpenSettings: () => void;
}

// 過去の発言はストリーミングの更新で再レンダリングされないようmemo化する
const MessageView = memo(function MessageView({ role, content }: ChatMessage) {
  if (role === 'user') {
    return (
      <div className="max-w-[88%] self-end whitespace-pre-wrap break-words rounded-2xl border border-indigo-500/30 bg-indigo-500/15 px-3.5 py-2 text-sm">
        {content}
      </div>
    );
  }
  return (
    <div className="self-stretch px-1 text-sm">
      <MarkdownView text={content} />
    </div>
  );
});

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function streamReply(
  client: GeminiClient,
  history: ChatMessage[],
  mode: AiModelMode,
  onChunk: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    void client.chatStream(history, QUICK_SYSTEM_PROMPT, mode, null, onChunk, resolve, reject);
  });
}

export default function QuickChatScreen(props: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamed, setStreamed] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [savedName, setSavedName] = useState<string | null>(null);

  const keyboardInset = useKeyboardInset();

  // 設定・マスタータグは非同期に読み込まれるため、送信・保存の時点の最新値をrefで参照する
  const propsRef = useRef(props);
  propsRef.current = props;

  const sessionRef = useRef<QuickSession>(newQuickSession());
  // 直前の保存で追加したタグ。連続保存でpropsの再描画が間に合わなくても、次の保存が既存扱いで再利用できるようにする
  const addedTagsRef = useRef<string[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const bufferRef = useRef('');
  const flushTimerRef = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamed]);

  // 保存待ちのままページを閉じて会話が失われるのを防ぐ（Web/PWAのみ有効）
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (pendingSavesRef.current > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  function cancelFlush() {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }

  function scheduleFlush() {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      setStreamed(bufferRef.current);
    }, STREAM_FLUSH_MS);
  }

  // 1往復ごとに保存キューへ積む。タイトル・タグ生成を待つ間も次の質問を入力できるよう直列化する
  function enqueueSave(user: string, ai: string) {
    const session = sessionRef.current;
    pendingSavesRef.current += 1;
    setSaveStatus('saving');

    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        const { geminiApiKey, gitRemoteUrl } = propsRef.current;
        const known = new Set(propsRef.current.masterTags.map((t) => t.toLowerCase()));
        const masterTags = [
          ...propsRef.current.masterTags,
          ...addedTagsRef.current.filter((t) => !known.has(t.toLowerCase())),
        ];
        const result = await saveQuickTurn({ session, gitRemoteUrl, geminiApiKey, masterTags, user, ai });
        if (result.addedMasterTags.length > 0) {
          addedTagsRef.current.push(...result.addedMasterTags);
          propsRef.current.onMasterTagsAdded(result.addedMasterTags);
        }
        if (result.created) propsRef.current.onNoteCreated();
        if (session === sessionRef.current) {
          setSavedName(result.path.split('/').pop() ?? result.path);
          setSaveStatus('saved');
        }
      } catch (err) {
        if (session === sessionRef.current) {
          setSaveStatus('error');
          setError(`会話の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        pendingSavesRef.current -= 1;
      }
    });
  }

  async function send() {
    const prompt = input.trim();
    const { geminiApiKey, aiModelMode } = propsRef.current;
    if (!prompt || generating || !geminiApiKey) return;

    const history = messages;
    const next: ChatMessage[] = [...history, { role: 'user', content: prompt }];
    setMessages(next);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setStreamed('');
    bufferRef.current = '';
    stickToBottomRef.current = true;
    setError(null);
    setGenerating(true);

    try {
      const full = await streamReply(new GeminiClient(geminiApiKey), next, aiModelMode, (chunk) => {
        bufferRef.current += chunk;
        scheduleFlush();
      });
      cancelFlush();
      setMessages([...next, { role: 'model', content: full }]);
      setStreamed('');
      enqueueSave(prompt, full);
    } catch (err) {
      cancelFlush();
      // 失敗した質問は履歴から外し、入力欄へ戻して再送できるようにする
      setMessages(history);
      setStreamed('');
      setInput(prompt);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function newChat() {
    if (generating) return;
    sessionRef.current = newQuickSession();
    setMessages([]);
    setStreamed('');
    setInput('');
    setError(null);
    setSaveStatus('idle');
    setSavedName(null);
    stickToBottomRef.current = true;
    inputRef.current?.focus();
  }

  const noKey = !props.geminiApiKey;
  const saveLabel =
    saveStatus === 'saving'
      ? '保存中…'
      : saveStatus === 'saved' && savedName
        ? `保存済み: ${savedName}`
        : saveStatus === 'error'
          ? '保存に失敗'
          : '';

  return (
    <div className="flex h-full flex-col bg-[#070a13]" style={{ paddingBottom: keyboardInset }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="text-sm font-semibold">クイックチャット</span>
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${
            saveStatus === 'saved' ? 'text-emerald-400' : saveStatus === 'error' ? 'text-red-400' : 'text-gray-500'
          }`}
        >
          {saveLabel}
        </span>
        <button
          type="button"
          onClick={newChat}
          disabled={generating}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/5 px-3 text-xs font-semibold text-gray-300 active:bg-white/10 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          新規
        </button>
      </header>

      <div ref={scrollerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {noKey ? (
          <div className="mx-auto mt-[18vh] max-w-xs text-center text-sm text-gray-400">
            <p>Gemini APIキーが設定されていません。</p>
            <button
              type="button"
              onClick={props.onOpenSettings}
              className="mt-3 rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white active:bg-indigo-500"
            >
              設定を開く
            </button>
          </div>
        ) : messages.length === 0 && !generating ? (
          <p className="mx-auto mt-[18vh] max-w-xs text-center text-sm text-gray-500">
            調べたいことを入力してください。
            <br />
            会話は自動でMarkdownノートに保存されます。
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <MessageView key={i} role={m.role} content={m.content} />
            ))}
            {generating && (
              <div className="self-stretch px-1 text-sm">
                {streamed ? <MarkdownView text={streamed} /> : <span className="text-gray-500">考え中…</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2 border-t border-white/10 bg-[#0a0e1a] px-3 py-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = 'auto';
            ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
          }}
          rows={1}
          disabled={noKey}
          placeholder="質問を入力"
          className="max-h-[120px] min-h-[36px] flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-indigo-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!input.trim() || generating || noKey}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white active:bg-indigo-500 disabled:opacity-40"
          aria-label="送信"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
