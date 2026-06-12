import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BottomNav, { Tab } from './components/BottomNav';
import NotesScreen from './screens/NotesScreen';
import EditorScreen from './screens/EditorScreen';
import ChatScreen from './screens/ChatScreen';
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
  'deep-think': '深掘り',
  'markdown-struct': '構造化',
  'long-explain': '詳細解説',
  'prompt-gen': 'プロンプト作成',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<Note[]>([]);
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [recentNames, setRecentNames] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [archived, setArchived] = useState<string[]>([]);
  const [localGraphTarget, setLocalGraphTarget] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState<string>('deep-think');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash-lite');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitMessage, setGitMessage] = useState<string | null>(null);

  const selectedNote = useMemo(
    () => notes.find((n) => n.name === selectedName) ?? null,
    [notes, selectedName],
  );

  const contentRef = useRef(content);
  contentRef.current = content;

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

  // ---------- ノート操作 ----------
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

  // 自動保存（編集後1.2秒）
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

  async function createNote(useAi: boolean) {
    const title = useAi
      ? window.prompt('AIに書かせるテーマを入力してください')
      : window.prompt('ノート名を入力してください', 'Untitled');
    if (!title) return;
    let name = cleanFilename(title);
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${title} (${counter++})`);
    }
    const initial = initialNoteContent(noteTitle(name));
    await writeNote(name, initial);
    await refreshNotes();
    openNote(buildNote(name, initial));

    if (useAi && config.geminiApiKey) {
      setIsGenerating(true);
      let acc = initial;
      const client = new GeminiClient(config.geminiApiKey);
      await client.chatStream(
        [{ role: 'user', content: `「${noteTitle(name)}」というテーマに関する詳細な解説記事をMarkdown形式で作成してください。見出しや箇条書きを用いて美しく構成し、前置きなどは含めず本文のみを出力してください。` }],
        SYSTEM_PROMPTS['long-explain'],
        'fast',
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

  async function deleteNoteAction(note: Note) {
    if (!window.confirm(`「${noteTitle(note.name)}」を削除しますか？`)) return;
    await removeNote(note.name);
    if (selectedName === note.name) {
      setSelectedName(null);
      setContent('');
      setShowEditor(false);
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
        alert('ノート内容をクリップボードにコピーしました');
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
        setTab('notes');
        return;
      }
      if (!window.confirm(`ノート「${name}」は存在しません。新しく作成しますか？`)) return;
      const clean = cleanFilename(name);
      const initial = initialNoteContent(noteTitle(clean));
      await writeNote(clean, initial);
      await refreshNotes();
      openNote(buildNote(clean, initial));
      setTab('notes');
    },
    [notes, openNote, refreshNotes],
  );

  // ---------- タグ ----------
  async function updateTags(nextTags: string[]) {
    if (!selectedName) return;
    const nextContent = applyTagsToContent(contentRef.current, nextTags);
    setContent(nextContent);
    await writeNote(selectedName, nextContent);
    await refreshNotes();
  }

  // ---------- クイックAIアクション ----------
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
      await updateTags(Array.from(new Set([...current, ...tags])));
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 1500);
      return;
    }

    if (action === 'title') {
      const title = await generateNoteTitle(config.geminiApiKey, body.slice(0, 600), '');
      if (!title) return;
      const newName = cleanFilename(title);
      if (notes.some((n) => n.name.toLowerCase() === newName.toLowerCase())) {
        alert(`「${title}」というノートは既に存在します`);
        return;
      }
      await writeNote(newName, body);
      await removeNote(selectedName);
      setSelectedName(newName);
      setRecentNames((prev) => [newName, ...prev.filter((n) => n !== selectedName)]);
      await refreshNotes();
      return;
    }

    // 要約: 本文末尾に要約セクションを追記
    setIsGenerating(true);
    const client = new GeminiClient(config.geminiApiKey);
    let acc = body + '\n\n## 要約\n\n';
    setContent(acc);
    await client.chatStream(
      [{ role: 'user', content: `以下のノートを3〜5行で簡潔に要約してください。要約本文のみを出力してください。\n\n${body.slice(0, 8000)}` }],
      SYSTEM_PROMPTS['markdown-struct'],
      'fast',
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

  // ---------- AIチャット ----------
  const chatModes = useMemo(
    () => [
      ...Object.entries(CHAT_MODE_LABELS).map(([id, label]) => ({ id, label })),
      ...(config.customPrompts ?? []).map((p) => ({ id: p.id, label: p.name })),
    ],
    [config.customPrompts],
  );

  function getSystemPrompt(mode: string): string {
    if (mode in SYSTEM_PROMPTS) return SYSTEM_PROMPTS[mode as ChatMode];
    const custom = (config.customPrompts ?? []).find((p) => p.id === mode);
    return custom ? custom.prompt : SYSTEM_PROMPTS['deep-think'];
  }

  async function handleAutoSave(userPrompt: string, aiReply: string) {
    const block = `---\n\n## User\n\n${userPrompt.trim()}\n\n## AI\n\n${aiReply.trim()}`;
    setAutoSaveStatus('saving');
    try {
      const extracted = await generateNoteTags(config.geminiApiKey, userPrompt, aiReply);
      if (selectedName) {
        const current = notes.find((n) => n.name === selectedName);
        const base = contentRef.current || current?.content || '';
        const currentTags = current?.tags ?? [];
        const nextTags = Array.from(new Set([...currentTags, ...extracted]));
        const appended = applyTagsToContent(`${base.trimEnd()}\n\n${block}\n`, nextTags);
        setContent(appended);
        await writeNote(selectedName, appended);
      } else {
        const title = await generateNoteTitle(config.geminiApiKey, userPrompt, aiReply);
        const filename = cleanFilename(title);
        const full = `# ${title}\n\n作成日時: ${new Date().toLocaleString()}\nタグ: ${extracted.join(', ')}\n\n${block}\n`;
        await writeNote(filename, full);
        setSelectedName(filename);
        setContent(full);
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

  async function sendChat(prompt: string) {
    if (!config.geminiApiKey) {
      alert('設定画面でGemini APIキーを入力してください');
      setTab('settings');
      return;
    }
    const client = new GeminiClient(config.geminiApiKey);
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }];
    setChatHistory(nextHistory);
    setStreamedText('');
    setIsGenerating(true);
    await client.chatStream(
      nextHistory,
      getSystemPrompt(chatMode),
      'fast',
      aiModelMode,
      selectedNote ? contentRef.current || selectedNote.content : null,
      (chunk) => setStreamedText((prev) => prev + chunk),
      (fullText) => {
        setChatHistory([...nextHistory, { role: 'model', content: fullText }]);
        setStreamedText('');
        setIsGenerating(false);
        handleAutoSave(prompt, fullText);
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
      if (result.conflicts.length) parts.push(`競合 ${result.conflicts.length}件（conflictノートとして保存）`);
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

  // ---------- 画面 ----------
  return (
    <div className="safe-top flex h-full flex-col bg-[#070a13] text-gray-100">
      <main className="min-h-0 flex-1">
        {tab === 'notes' &&
          (showEditor && selectedNote ? (
            <EditorScreen
              note={selectedNote}
              content={content}
              isGenerating={isGenerating}
              onChangeContent={setContent}
              onBack={() => setShowEditor(false)}
              onWikiLinkClick={handleWikiLinkClick}
              onAddTag={(tag) => updateTags(Array.from(new Set([...(selectedNote.tags ?? []), tag.replace(/^#/, '')])))}
              onRemoveTag={(tag) => updateTags((selectedNote.tags ?? []).filter((t) => t !== tag))}
              onAiAction={handleAiAction}
              onOpenLocalGraph={() => {
                setLocalGraphTarget(selectedNote.name);
                setTab('graph');
              }}
            />
          ) : (
            <NotesScreen
              notes={notes}
              recentNames={recentNames}
              favorites={favorites}
              archived={archived}
              selectedName={selectedName}
              onOpen={openNote}
              onCreate={createNote}
              onDelete={deleteNoteAction}
              onArchive={toggleArchive}
              onShare={shareNote}
              onToggleFavorite={toggleFavorite}
            />
          ))}
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
        {tab === 'chat' && (
          <ChatScreen
            history={chatHistory}
            streamedText={streamedText}
            isGenerating={isGenerating}
            contextNote={selectedNote}
            chatMode={chatMode}
            chatModes={chatModes}
            autoSaveStatus={autoSaveStatus}
            onSend={sendChat}
            onChangeChatMode={setChatMode}
            onClearContext={() => {
              setSelectedName(null);
              setContent('');
              setShowEditor(false);
              setChatHistory([]);
            }}
            onWikiLinkClick={handleWikiLinkClick}
          />
        )}
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
          />
        )}
      </main>
      <BottomNav
        active={tab}
        onChange={(t) => {
          if (t === 'notes' && tab === 'notes') setShowEditor(false);
          if (t !== 'graph') setLocalGraphTarget(null);
          setTab(t);
        }}
      />
    </div>
  );
}
