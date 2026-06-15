import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BottomNav, { Tab } from './components/BottomNav';
import FilesScreen from './screens/NotesScreen';
import EditorScreen from './screens/EditorScreen';
import NoteScreen from './screens/NoteScreen';
import GraphScreen from './screens/GraphScreen';
import SettingsScreen from './screens/SettingsScreen';
import {
  AppConfig,
  emptyConfig,
  loadConfig,
  saveConfig,
  listNotes,
  writeNote,
  deleteNote as removeNote,
  loadNoteMeta,
  saveNoteMeta,
} from './lib/storage';
import {
  Note,
  applyTagsToContent,
  buildNote,
  cleanFilename,
  initialNoteContent,
  noteTitle,
} from './lib/notes';
import {
  AiModelMode,
  ChatMessage,
  ChatMode,
  GeminiClient,
  SYSTEM_PROMPTS,
  generateNoteTags,
  generateNoteTitle,
} from './lib/gemini';
import { syncNotes } from './lib/githubSync';

const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  'deep-think': '思考整理',
  'markdown-struct': 'ノート作成',
  'long-explain': '長文詳細解説',
  'prompt-gen': 'プロンプト作成',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('files');
  const [notes, setNotes] = useState<Note[]>([]);
  const [config, setConfig] = useState<AppConfig>(emptyConfig);

  // ファイルタブ用
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  // ノートタブ（NoteScreen）用 — 別のファイル選択を持つ
  const [noteTabSelectedName, setNoteTabSelectedName] = useState<string | null>(null);
  const [noteTabContent, setNoteTabContent] = useState('');

  const [recentNames, setRecentNames] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [archived, setArchived] = useState<string[]>([]);
  const [localGraphTarget, setLocalGraphTarget] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState<string>('deep-think');
  const chatModeRef = useRef<string>('deep-think');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ name: string; instruction: string } | null>(null);
  const [promptLogFilename, setPromptLogFilename] = useState<string | null>(null);

  const selectedNote = useMemo(
    () => notes.find((n) => n.name === selectedName) ?? null,
    [notes, selectedName],
  );

  const noteTabSelectedNote = useMemo(
    () => notes.find((n) => n.name === noteTabSelectedName) ?? null,
    [notes, noteTabSelectedName],
  );

  const contentRef = useRef(content);
  contentRef.current = content;

  const noteTabContentRef = useRef(noteTabContent);
  noteTabContentRef.current = noteTabContent;

  // ---------- 初期化 ----------
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setConfig(cfg);
      const meta = await loadNoteMeta();
      setFavorites(meta.favorites);
      setArchived(meta.archived);
      const list = await listNotes();
      setNotes(list);
      if (!cfg.geminiApiKey) setTab('settings');
      if (cfg.autoSync && cfg.githubToken && cfg.githubRepo) {
        runSync(cfg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshNotes = useCallback(async () => {
    setNotes(await listNotes());
  }, []);

  // ---------- ファイルタブのノート操作 ----------
  const openNote = useCallback(
    (note: Note) => {
      if (selectedName && selectedName !== note.name) {
        setChatHistory([]);
        setStreamedText('');
      }
      setSelectedName(note.name);
      setContent(note.content);
      setShowEditor(true);
      setRecentNames((prev) => [note.name, ...prev.filter((n) => n !== note.name)].slice(0, 10));
    },
    [selectedName],
  );

  // ファイルタブ 自動保存（編集後1.2秒）
  useEffect(() => {
    if (!selectedName || !showEditor) return;
    const timer = setTimeout(async () => {
      await writeNote(selectedName, contentRef.current);
      setNotes((prev) =>
        prev.map((n) => (n.name === selectedName ? buildNote(n.name, contentRef.current) : n)),
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [content, selectedName, showEditor]);

  // ノートタブ 自動保存
  useEffect(() => {
    if (!noteTabSelectedName) return;
    const timer = setTimeout(async () => {
      await writeNote(noteTabSelectedName, noteTabContentRef.current);
      setNotes((prev) =>
        prev.map((n) =>
          n.name === noteTabSelectedName ? buildNote(n.name, noteTabContentRef.current) : n,
        ),
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [noteTabContent, noteTabSelectedName]);

  // ノートタブでファイルを選択
  const selectNoteForNoteTab = useCallback((note: Note) => {
    setNoteTabSelectedName(note.name);
    setNoteTabContent(note.content);
    setRecentNames((prev) => [note.name, ...prev.filter((n) => n !== note.name)].slice(0, 10));
  }, []);

  // ---------- ファイル作成 ----------
  async function createNote(title: string, useAi: boolean, aiMode?: string) {
    const firstLine = title.split('\n')[0].trim();
    if (!firstLine) return;

    const modeToUse = (aiMode ?? 'long-explain') as ChatMode;

    // prompt-gen モードはノート作成ではなくチャットとして扱う
    if (useAi && modeToUse === 'prompt-gen' && config.geminiApiKey) {
      setChatMode('prompt-gen');
      chatModeRef.current = 'prompt-gen';
      setPendingPrompt(null);
      const client = new GeminiClient(config.geminiApiKey);
      const userPrompt = `「${firstLine}」というテーマ・用途に合ったカスタムプロンプトを作成してください。`;
      const nextHistory: ChatMessage[] = [{ role: 'user', content: userPrompt }];
      setChatHistory(nextHistory);
      setStreamedText('');
      setIsGenerating(true);
      await client.chatStream(
        nextHistory,
        SYSTEM_PROMPTS['prompt-gen'],
        aiModelMode,
        null,
        (chunk) => setStreamedText((prev) => prev + chunk),
        async (fullText) => {
          const fullHistory: ChatMessage[] = [...nextHistory, { role: 'model', content: fullText }];
          setChatHistory(fullHistory);
          setStreamedText('');
          setIsGenerating(false);
          // 会話をMDファイルとして保存
          const logFile = await savePromptLog(fullHistory, firstLine.slice(0, 20), null);
          setPromptLogFilename(logFile);
          const parsed = parseGeneratedPrompt(fullText);
          setPendingPrompt(parsed ?? {
            name: firstLine.slice(0, 10),
            instruction: fullText.replace(/\[PROMPT\][\s\S]*?\[\/PROMPT\]/gi, '').trim(),
          });
        },
        (err) => {
          setIsGenerating(false);
          alert(err instanceof Error ? err.message : String(err));
        },
      );
      return;
    }

    let name = cleanFilename(firstLine);
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${firstLine} (${counter++})`);
    }
    const initial = initialNoteContent(noteTitle(name));
    await writeNote(name, initial);
    await refreshNotes();
    openNote(buildNote(name, initial));

    if (useAi && config.geminiApiKey) {
      setIsGenerating(true);
      let acc = initial;
      const client = new GeminiClient(config.geminiApiKey);
      const systemPrompt = SYSTEM_PROMPTS[modeToUse] ?? SYSTEM_PROMPTS['long-explain'];
      await client.chatStream(
        [
          {
            role: 'user',
            content: `「${noteTitle(name)}」というテーマに関する詳細な解説記事をMarkdown形式で作成してください。見出しや箇条書きを用いて美しく構成し、前置きなどは含めず本文のみを出力してください。`,
          },
        ],
        systemPrompt,
        aiModelMode,
        null,
        (chunk) => {
          acc += chunk;
          setContent(acc);
        },
        async (fullText) => {
          const finalContent = initial + fullText;
          setContent(finalContent);
          await writeNote(name, finalContent);
          await refreshNotes();
          setIsGenerating(false);
        },
        (err) => {
          setIsGenerating(false);
          alert(err instanceof Error ? err.message : String(err));
        },
      );
    }
  }

  // メモ作成（タイトルだけのシンプルノート）
  async function createMemo(title: string) {
    const clean = title.trim();
    if (!clean) return;
    let name = cleanFilename(clean);
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${clean} (${counter++})`);
    }
    const now = new Date().toLocaleString('ja-JP');
    const initial = `# ${noteTitle(name)}\n\n作成日時: ${now}\n`;
    await writeNote(name, initial);
    await refreshNotes();
    openNote(buildNote(name, initial));
  }

  async function deleteNoteAction(note: Note) {
    if (!window.confirm(`「${noteTitle(note.name)}」を削除しますか？`)) return;
    await removeNote(note.name);
    if (selectedName === note.name) {
      setSelectedName(null);
      setContent('');
      setShowEditor(false);
    }
    if (noteTabSelectedName === note.name) {
      setNoteTabSelectedName(null);
      setNoteTabContent('');
    }
    setRecentNames((prev) => prev.filter((n) => n !== note.name));
    await refreshNotes();
  }

  async function toggleArchive(note: Note) {
    const next = archived.includes(note.name)
      ? archived.filter((n) => n !== note.name)
      : [...archived, note.name];
    setArchived(next);
    await saveNoteMeta({ favorites, archived: next });
  }

  async function toggleFavorite(note: Note) {
    const next = favorites.includes(note.name)
      ? favorites.filter((n) => n !== note.name)
      : [...favorites, note.name];
    setFavorites(next);
    await saveNoteMeta({ favorites: next, archived });
  }

  async function shareNote(note: Note) {
    try {
      if (navigator.share) {
        await navigator.share({ title: noteTitle(note.name), text: note.content });
      } else {
        await navigator.clipboard.writeText(note.content);
        alert('ファイル内容をクリップボードにコピーしました');
      }
    } catch {
      // ユーザーキャンセルは無視
    }
  }

  // ---------- Wikiリンク ----------
  const handleWikiLinkClick = useCallback(
    async (name: string) => {
      const filename = name.endsWith('.md') ? name : `${name}.md`;
      const target = notes.find((n) => n.name.toLowerCase() === filename.toLowerCase());
      if (target) {
        openNote(target);
        setTab('files');
        return;
      }
      if (!window.confirm(`ファイル「${name}」は存在しません。新しく作成しますか？`)) return;
      const clean = cleanFilename(name);
      const initial = initialNoteContent(noteTitle(clean));
      await writeNote(clean, initial);
      await refreshNotes();
      openNote(buildNote(clean, initial));
      setTab('files');
    },
    [notes, openNote, refreshNotes],
  );

  // ---------- タグ ----------
  async function updateTags(name: string, currentContent: string, nextTags: string[]) {
    const nextContent = applyTagsToContent(currentContent, nextTags);
    if (name === selectedName) setContent(nextContent);
    if (name === noteTabSelectedName) setNoteTabContent(nextContent);
    await writeNote(name, nextContent);
    await refreshNotes();
  }

  // ---------- クイックAIアクション (EditorScreen用) ----------
  async function handleAiAction(action: 'title' | 'tags' | 'summary') {
    if (!config.geminiApiKey) {
      alert('設定画面でGemini APIキーを入力してください');
      return;
    }
    if (!selectedName) return;
    const body = contentRef.current;

    if (action === 'tags') {
      setAutoSaveStatus('saving');
      const tags = await generateNoteTags(config.geminiApiKey, body.slice(0, 600), '');
      const current = selectedNote?.tags ?? [];
      await updateTags(selectedName, body, Array.from(new Set([...current, ...tags])));
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 1500);
      return;
    }

    if (action === 'title') {
      const newTitle = await generateNoteTitle(config.geminiApiKey, body.slice(0, 600), '');
      if (!newTitle) return;
      const newName = cleanFilename(newTitle);
      if (notes.some((n) => n.name.toLowerCase() === newName.toLowerCase())) {
        alert(`「${newTitle}」というファイルは既に存在します`);
        return;
      }
      await writeNote(newName, body);
      await removeNote(selectedName);
      setSelectedName(newName);
      setRecentNames((prev) => [newName, ...prev.filter((n) => n !== selectedName)]);
      await refreshNotes();
      return;
    }

    // 要約
    setIsGenerating(true);
    const client = new GeminiClient(config.geminiApiKey);
    let acc = body + '\n\n## 要約\n\n';
    setContent(acc);
    await client.chatStream(
      [
        {
          role: 'user',
          content: `以下のノートを3〜5行で簡潔に要約してください。要約本文のみを出力してください。\n\n${body.slice(0, 8000)}`,
        },
      ],
      SYSTEM_PROMPTS['markdown-struct'],
      aiModelMode,
      null,
      (chunk) => {
        acc += chunk;
        setContent(acc);
      },
      async () => {
        await writeNote(selectedName, acc);
        await refreshNotes();
        setIsGenerating(false);
      },
      (err) => {
        setIsGenerating(false);
        alert(err instanceof Error ? err.message : String(err));
      },
    );
  }

  // ---------- AIチャット (NoteScreen / 共通) ----------
  const chatModes = useMemo(
    () => [
      ...Object.entries(CHAT_MODE_LABELS).map(([id, label]) => ({ id, label })),
      ...(config.customPrompts ?? []).map((p) => ({ id: p.id, label: p.name })),
    ],
    [config.customPrompts],
  );

  // chatMode の最新値を ref に同期（非同期コールバック内の stale closure 対策）
  chatModeRef.current = chatMode;

  function getSystemPrompt(mode: string): string {
    if (mode in SYSTEM_PROMPTS) return SYSTEM_PROMPTS[mode as ChatMode];
    const custom = (config.customPrompts ?? []).find((p) => p.id === mode);
    return custom ? custom.prompt : SYSTEM_PROMPTS['deep-think'];
  }

  async function handleAutoSave(userPrompt: string, aiReply: string, contextName: string | null) {
    const block = `---\n\n## User\n\n${userPrompt.trim()}\n\n## AI\n\n${aiReply.trim()}`;
    setAutoSaveStatus('saving');
    try {
      const extracted = await generateNoteTags(config.geminiApiKey, userPrompt, aiReply);

      // 対象ファイルが開かれている場合はそこに追記
      const targetName = contextName;
      if (targetName) {
        const base = targetName === selectedName ? contentRef.current
                   : targetName === noteTabSelectedName ? noteTabContentRef.current
                   : notes.find((n) => n.name === targetName)?.content ?? '';
        const currentNote = notes.find((n) => n.name === targetName);
        const currentTags = currentNote?.tags ?? [];
        const nextTags = Array.from(new Set([...currentTags, ...extracted]));
        const appended = applyTagsToContent(`${base.trimEnd()}\n\n${block}\n`, nextTags);
        if (targetName === selectedName) setContent(appended);
        if (targetName === noteTabSelectedName) setNoteTabContent(appended);
        await writeNote(targetName, appended);
      } else {
        // ファイルを新規作成
        const title = await generateNoteTitle(config.geminiApiKey, userPrompt, aiReply);
        const filename = cleanFilename(title);
        const full = `# ${title}\n\n作成日時: ${new Date().toLocaleString()}\nタグ: ${extracted.join(', ')}\n\n${block}\n`;
        await writeNote(filename, full);
        setNoteTabSelectedName(filename);
        setNoteTabContent(full);
        setRecentNames((prev) => [filename, ...prev.filter((n) => n !== filename)].slice(0, 10));
      }
      await refreshNotes();
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Auto save error:', err);
      setAutoSaveStatus('idle');
    }
  }

  // prompt-gen 会話をMarkdownファイルとして書き出す
  function buildPromptLogMd(history: ChatMessage[], title: string): string {
    const now = new Date().toLocaleString('ja-JP');
    const lines: string[] = [
      `# プロンプト作成ログ — ${title}`,
      ``,
      `作成日時: ${now}`,
      `モード: プロンプト作成`,
      `tags: [プロンプト作成, AI]`,
      ``,
      `## 会話ログ`,
      ``,
    ];
    for (const msg of history) {
      lines.push(msg.role === 'user' ? `**User:** ${msg.content}` : `**AI:** ${msg.content}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  async function savePromptLog(history: ChatMessage[], title: string, existingFilename?: string | null): Promise<string> {
    const md = buildPromptLogMd(history, title);
    let filename = existingFilename ?? null;
    if (!filename) {
      const safe = cleanFilename(`prompt-log_${title.slice(0, 20)}_${Date.now()}`);
      filename = safe;
    }
    await writeNote(filename, md);
    await refreshNotes();
    return filename;
  }

  // [PROMPT]...[/PROMPT] ブロックをパース（表記ゆれに対応）
  function parseGeneratedPrompt(text: string): { name: string; instruction: string } | null {
    // バッククォートや余分な記号を取り除いてからマッチ
    const cleaned = text.replace(/```/g, '').replace(/\*\*/g, '');
    const match = cleaned.match(/\[PROMPT\]([\s\S]*?)\[\/PROMPT\]/i);
    if (!match) return null;
    const block = match[1];
    const nameMatch = block.match(/名前[:：]\s*(.+)/);
    const instrMatch = block.match(/指示[:：]\s*([\s\S]+)/);
    if (!nameMatch || !instrMatch) return null;
    const name = nameMatch[1].trim().slice(0, 10);
    const instruction = instrMatch[1].replace(/\[\/PROMPT\].*/i, '').trim();
    if (!name || !instruction) return null;
    return { name, instruction };
  }

  // プロンプト作成モードで「はい」を選択したとき
  async function addPendingPrompt() {
    if (!pendingPrompt) return;
    const id = `custom-${Date.now()}`;
    const next = {
      ...config,
      customPrompts: [
        ...(config.customPrompts ?? []),
        { id, name: pendingPrompt.name, prompt: pendingPrompt.instruction },
      ],
    };
    setConfig(next);
    await saveConfig(next);
    // MDファイルに「追加済み」フッターを付けて上書き保存
    if (promptLogFilename) {
      try {
        const firstUserMsg = chatHistory.find((m) => m.role === 'user')?.content ?? 'プロンプト作成';
        const base = buildPromptLogMd(chatHistory, firstUserMsg.slice(0, 20));
        const footer = `\n---\n✅ 追加済み: ${new Date().toLocaleString('ja-JP')}\nプロンプト名: ${pendingPrompt.name}\n`;
        await writeNote(promptLogFilename, base + footer);
        await refreshNotes();
      } catch { /* ログ書き込み失敗は無視 */ }
    }
    setPendingPrompt(null);
    setPromptLogFilename(null);
  }

  // 「いいえ・修正する」専用送信 — handleAutoSave を呼ばず prompt-gen モード固定
  async function rejectChat() {
    if (!config.geminiApiKey) return;
    setPendingPrompt(null);
    const client = new GeminiClient(config.geminiApiKey);
    const rejectMsg = 'いいえ、修正してください。別のパターンで再度作成してください。';
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: rejectMsg }];
    setChatHistory(nextHistory);
    setStreamedText('');
    setIsGenerating(true);
    const currentLogFile = promptLogFilename;

    await client.chatStream(
      nextHistory,
      getSystemPrompt('prompt-gen'),
      aiModelMode,
      null,
      (chunk) => setStreamedText((prev) => prev + chunk),
      async (fullText) => {
        const updatedHistory: ChatMessage[] = [...nextHistory, { role: 'model', content: fullText }];
        setChatHistory(updatedHistory);
        setStreamedText('');
        setIsGenerating(false);
        // 同じMDファイルに会話を追記
        const firstUserMsg = updatedHistory.find((m) => m.role === 'user')?.content ?? 'プロンプト作成';
        const logFile = await savePromptLog(updatedHistory, firstUserMsg.slice(0, 20), currentLogFile);
        if (!currentLogFile) setPromptLogFilename(logFile);
        // [PROMPT] ブロックを再検出（フォールバックあり）
        const parsed = parseGeneratedPrompt(fullText);
        setPendingPrompt(parsed ?? {
          name: 'カスタム',
          instruction: fullText.replace(/\[PROMPT\][\s\S]*?\[\/PROMPT\]/gi, '').trim(),
        });
      },
      (err) => {
        setIsGenerating(false);
        alert(err instanceof Error ? err.message : String(err));
      },
    );
  }

  async function sendChat(prompt: string) {
    if (!config.geminiApiKey) {
      alert('設定画面でGemini APIキーを入力してください');
      setTab('settings');
      return;
    }
    setPendingPrompt(null);
    // 新しい prompt-gen セッション開始時はログファイルをリセット
    if (chatModeRef.current === 'prompt-gen' && chatHistory.length === 0) {
      setPromptLogFilename(null);
    }
    const client = new GeminiClient(config.geminiApiKey);
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }];
    setChatHistory(nextHistory);
    setStreamedText('');
    setIsGenerating(true);

    const contextName = noteTabSelectedName;
    const contextContent = noteTabSelectedName ? noteTabContentRef.current : null;

    await client.chatStream(
      nextHistory,
      getSystemPrompt(chatMode),
      aiModelMode,
      contextContent,
      (chunk) => setStreamedText((prev) => prev + chunk),
      (fullText) => {
        setChatHistory([...nextHistory, { role: 'model', content: fullText }]);
        setStreamedText('');
        setIsGenerating(false);
        const currentMode = chatModeRef.current;
        // prompt-gen 以外のみ自動保存（prompt-gen はノートに追記不要）
        if (currentMode !== 'prompt-gen') {
          handleAutoSave(prompt, fullText, contextName);
        }
        // prompt-gen モードなら会話をMD保存 → [PROMPT] ブロックを検出して確認待ちに
        if (currentMode === 'prompt-gen') {
          const fullHistory: ChatMessage[] = [...nextHistory, { role: 'model', content: fullText }];
          const logTitle = prompt.slice(0, 20);
          savePromptLog(fullHistory, logTitle, promptLogFilename).then((logFile) => {
            setPromptLogFilename(logFile);
          });
          const parsed = parseGeneratedPrompt(fullText);
          setPendingPrompt(parsed ?? {
            name: 'カスタム',
            instruction: fullText.replace(/\[PROMPT\][\s\S]*?\[\/PROMPT\]/gi, '').trim(),
          });
        }
      },
      (err) => {
        setIsGenerating(false);
        alert(err instanceof Error ? err.message : String(err));
      },
    );
  }

  // ---------- GitHub同期 ----------
  async function runSync(cfg?: AppConfig) {
    const c = cfg ?? config;
    setGitStatus('syncing');
    setGitMessage(null);
    try {
      const result = await syncNotes(c.githubToken, c.githubRepo, c.githubBranch);
      setGitStatus('success');
      const parts = [];
      if (result.pushed.length) parts.push(`送信 ${result.pushed.length}件`);
      if (result.pulled.length) parts.push(`受信 ${result.pulled.length}件`);
      if (result.conflicts.length) parts.push(`競合 ${result.conflicts.length}件`);
      setGitMessage(parts.length ? `同期完了: ${parts.join(' / ')}` : '同期完了: 変更なし');
      await refreshNotes();
    } catch (err) {
      setGitStatus('error');
      setGitMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveConfig(next: AppConfig) {
    setConfig(next);
    await saveConfig(next);
    alert('設定を保存しました');
  }

  async function handleDeletePrompt(id: string) {
    const next = { ...config, customPrompts: (config.customPrompts ?? []).filter((p) => p.id !== id) };
    setConfig(next);
    await saveConfig(next);
    if (chatMode === id) setChatMode('deep-think');
  }

  async function handleEditPrompt(updated: { id: string; name: string; prompt: string }) {
    const next = {
      ...config,
      customPrompts: (config.customPrompts ?? []).map((p) => (p.id === updated.id ? updated : p)),
    };
    setConfig(next);
    await saveConfig(next);
  }

  // ---------- 画面レンダリング ----------
  return (
    <div className="safe-top flex h-full flex-col bg-[#070a13] text-gray-100">
      <main className="min-h-0 flex-1 bg-[#070a13]">

        {/* ファイルタブ */}
        {tab === 'files' &&
          (showEditor && selectedNote ? (
            <EditorScreen
              note={selectedNote}
              content={content}
              isGenerating={isGenerating}
              onChangeContent={setContent}
              onBack={() => setShowEditor(false)}
              onWikiLinkClick={handleWikiLinkClick}
              onAddTag={(tag) =>
                updateTags(selectedNote.name, content, Array.from(new Set([...(selectedNote.tags ?? []), tag.replace(/^#/, '')])))
              }
              onRemoveTag={(tag) =>
                updateTags(selectedNote.name, content, (selectedNote.tags ?? []).filter((t) => t !== tag))
              }
              onAiAction={handleAiAction}
              onOpenLocalGraph={() => {
                setLocalGraphTarget(selectedNote.name);
                setTab('graph');
              }}
              onSend={sendChat}
              chatMode={chatMode}
              chatModes={chatModes}
              onChangeChatMode={setChatMode}
            />
          ) : (
            <FilesScreen
              notes={notes}
              recentNames={recentNames}
              favorites={favorites}
              archived={archived}
              selectedName={selectedName}
              chatModes={chatModes}
              onOpen={openNote}
              onCreate={createNote}
              onCreateMemo={createMemo}
              onDelete={deleteNoteAction}
              onArchive={toggleArchive}
              onShare={shareNote}
              onToggleFavorite={toggleFavorite}
            />
          ))}

        {/* グラフタブ */}
        {tab === 'graph' && (
          <GraphScreen
            notes={notes}
            centerNoteName={localGraphTarget}
            onSelectNote={(name) => {
              setLocalGraphTarget(null);
              handleWikiLinkClick(name);
            }}
            onCloseLocal={() => setLocalGraphTarget(null)}
          />
        )}

        {/* ノートタブ（統合エディタ＋AIチャット） */}
        {tab === 'note' && (
          <NoteScreen
            notes={notes}
            selectedNote={noteTabSelectedNote}
            content={noteTabContent}
            autoSaveStatus={autoSaveStatus}
            isGenerating={isGenerating}
            onChangeContent={setNoteTabContent}
            onSelectNote={selectNoteForNoteTab}
            onSend={sendChat}
            onWikiLinkClick={handleWikiLinkClick}
            chatMode={chatMode}
            chatModes={chatModes}
            onChangeChatMode={setChatMode}
          />
        )}

        {/* 設定タブ */}
        {tab === 'settings' && (
          <SettingsScreen
            config={config}
            aiModelMode={aiModelMode}
            gitStatus={gitStatus}
            gitMessage={gitMessage}
            onSave={handleSaveConfig}
            onChangeModelMode={setAiModelMode}
            onSync={() => runSync()}
            onDeletePrompt={handleDeletePrompt}
            onEditPrompt={handleEditPrompt}
          />
        )}
      </main>


      <BottomNav
        active={tab}
        onChange={(t) => {
          if (t === 'files' && tab === 'files') setShowEditor(false);
          if (t !== 'graph') setLocalGraphTarget(null);
          setTab(t);
        }}
      />
    </div>
  );
}
