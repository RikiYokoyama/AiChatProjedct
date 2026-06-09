import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  GitBranch,
  Loader2,
  Network,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import GraphView from './GraphView';
import { AiModelMode, AiSpeedMode, ChatMessage, ChatMode, GeminiClient, generateNoteTitle } from './lib/gemini';

interface Note {
  name: string;
  path: string;
  updatedAt: string;
  content: string;
  tags?: string[];
  wikiLinks?: string[];
}

interface AppConfig {
  geminiApiKey: string;
  notesPath: string;
  gitRemoteUrl: string;
  autoSync: boolean;
}

const emptyConfig: AppConfig = {
  geminiApiKey: '',
  notesPath: '',
  gitRemoteUrl: '',
  autoSync: false,
};

type RibbonView = 'notes' | 'graph' | 'settings';

function cleanFilename(value: string) {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, '-');
  return name.endsWith('.md') ? name : `${name || 'Untitled'}.md`;
}

function RibbonButton({
  icon,
  active,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  active: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${
        active ? 'bg-indigo-500/30 text-indigo-300' : 'text-gray-500 hover:bg-white/10 hover:text-gray-200'
      }`}
    >
      {icon}
    </button>
  );
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [noteContext, setNoteContext] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview');
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [ribbonView, setRibbonView] = useState<RibbonView>('notes');
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteName, setNewNoteName] = useState('Untitled');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitError, setGitError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('deep-think');
  const [aiSpeedMode, setAiSpeedMode] = useState<AiSpeedMode>('fast');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash-lite');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) => note.name.toLowerCase().includes(query));
  }, [notes, searchQuery]);

  async function loadNotesList() {
    setIsLoading(true);
    try {
      const list = await window.electronAPI.listNotes();
      setNotes(list);
      if (selectedNote) {
        const updated = list.find((note) => note.name === selectedNote.name);
        setSelectedNote(updated ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function openNote(note: Note) {
    const noteContent = await window.electronAPI.readNote(note.name);
    setSelectedNote(note);
    setContent(noteContent);
    setNoteContext(noteContent);
    setEditMode('preview');
  }

  async function createNoteFromModal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = cleanFilename(newNoteName);
    const initial = `# ${name.replace(/\.md$/i, '')}\n\n`;
    const result = await window.electronAPI.saveNote({ filename: name, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }
    setShowNewNoteModal(false);
    setNewNoteName('Untitled');
    await loadNotesList();
    const note = { name, path: result.path ?? name, updatedAt: new Date().toISOString(), content: initial };
    await openNote(note);
    setEditMode('edit');
  }

  async function saveCurrentNote() {
    if (!selectedNote) return;
    setIsSaving(true);
    setSaveOk(false);
    const result = await window.electronAPI.saveNote({ filename: selectedNote.name, content });
    setIsSaving(false);
    if (!result.success) {
      alert(result.error ?? '保存に失敗しました');
      return;
    }
    setSaveOk(true);
    setNoteContext(content);
    setTimeout(() => setSaveOk(false), 1200);
    await loadNotesList();
  }

  async function deleteCurrentNote() {
    if (!selectedNote) return;
    if (!window.confirm(`${selectedNote.name} を削除しますか？`)) return;
    const result = await window.electronAPI.deleteNote(selectedNote.name);
    if (!result.success) {
      alert(result.error ?? '削除に失敗しました');
      return;
    }
    setSelectedNote(null);
    setContent('');
    setNoteContext(null);
    await loadNotesList();
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await window.electronAPI.saveConfig(config);
    if (!result.success) {
      alert(result.error ?? '設定の保存に失敗しました');
      return;
    }
    setRibbonView('notes');
    await loadNotesList();
  }

  async function chooseNotesFolder() {
    const folder = await window.electronAPI.openDirectoryDialog();
    if (folder) setConfig((prev) => ({ ...prev, notesPath: folder }));
  }

  async function syncGit() {
    setGitStatus('syncing');
    const result = await window.electronAPI.syncGit();
    setGitStatus(result.success ? 'success' : 'error');
    setGitError(result.error ?? null);
    await loadNotesList();
  }

  async function handleAutoSave(userPrompt: string, aiReply: string) {
    const block = `---\n\n## User\n\n${userPrompt.trim()}\n\n## AI\n\n${aiReply.trim()}`;
    setAutoSaveStatus('saving');
    try {
      if (selectedNote) {
        await window.electronAPI.appendToNote({ filename: selectedNote.name, appendContent: block });
        const noteContent = await window.electronAPI.readNote(selectedNote.name);
        setContent(noteContent);
        setNoteContext(noteContent);
      } else {
        const title = await generateNoteTitle(config.geminiApiKey, userPrompt, aiReply);
        const filename = cleanFilename(title);
        const fullContent = `# ${title}\n\n作成日時: ${new Date().toLocaleString()}\n\n${block}\n`;
        const result = await window.electronAPI.saveNote({ filename, content: fullContent });
        if (result.success) {
          const note: Note = { name: filename, path: result.path ?? filename, updatedAt: new Date().toISOString(), content: fullContent };
          setSelectedNote(note);
          setContent(fullContent);
          setNoteContext(fullContent);
        }
      }
      await loadNotesList();
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch {
      setAutoSaveStatus('idle');
    }
  }

  async function sendChat() {
    const prompt = chatInput.trim();
    if (!prompt || isGenerating) return;
    const client = new GeminiClient(config.geminiApiKey);
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }];
    setChatHistory(nextHistory);
    setChatInput('');
    setStreamedText('');
    setIsGenerating(true);

    await client.chatStream(
      nextHistory,
      chatMode,
      aiSpeedMode,
      aiModelMode,
      noteContext,
      (chunk) => setStreamedText((prev) => prev + chunk),
      (fullText) => {
        const finalHistory: ChatMessage[] = [...nextHistory, { role: 'model', content: fullText }];
        setChatHistory(finalHistory);
        setStreamedText('');
        setIsGenerating(false);
        handleAutoSave(prompt, fullText);
      },
      (error) => {
        setIsGenerating(false);
        alert(error instanceof Error ? error.message : String(error));
      },
    );
  }

  useEffect(() => {
    window.electronAPI.loadConfig().then((loaded) => {
      setConfig(loaded);
      if (!loaded.geminiApiKey) setRibbonView('settings');
    });
    loadNotesList();
    const unsubscribe = window.electronAPI.onGitStatusChanged((status, error) => {
      setGitStatus(status);
      setGitError(error ?? null);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, streamedText]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#070a13] text-gray-100">
      {/* リボンバー */}
      <nav className="flex w-12 flex-col items-center gap-1 border-r border-white/10 bg-[#060910] py-3">
        <div className="mb-auto flex flex-col items-center gap-1">
          <RibbonButton icon={<FileText className="h-4 w-4" />} active={ribbonView === 'notes'} title="ノート" onClick={() => setRibbonView('notes')} />
          <RibbonButton icon={<Network className="h-4 w-4" />} active={ribbonView === 'graph'} title="グラフ" onClick={() => setRibbonView('graph')} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            title="Git同期"
            onClick={syncGit}
            className="flex h-10 w-10 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-200"
          >
            {gitStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          </button>
          <RibbonButton icon={<Settings className="h-4 w-4" />} active={ribbonView === 'settings'} title="設定" onClick={() => setRibbonView('settings')} />
        </div>
      </nav>

      {/* グラフビュー（全画面オーバーレイ） */}
      {ribbonView === 'graph' && (
        <div className="absolute inset-0 left-12 z-40">
          <GraphView
            notes={notes}
            onSelectNote={(note) => { openNote(note); setRibbonView('notes'); }}
            onClose={() => setRibbonView('notes')}
          />
        </div>
      )}

      {/* ノートリスト */}
      <aside className="flex w-64 flex-col border-r border-white/10 bg-[#0b1020]/70">
        <div className="space-y-2 p-3">
          <button
            className="flex w-full items-center justify-center gap-2 rounded bg-indigo-500 px-3 py-2 font-semibold hover:bg-indigo-400"
            onClick={() => setShowNewNoteModal(true)}
          >
            <Plus className="h-4 w-4" />
            新規ノート
          </button>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2">
            <Search className="h-4 w-4 text-gray-500" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="検索"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {isLoading ? (
            <div className="p-4 text-sm text-gray-400">読み込み中...</div>
          ) : (
            filteredNotes.map((note) => (
              <button
                key={note.name}
                className={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${
                  selectedNote?.name === note.name ? 'bg-indigo-500/20 text-indigo-100' : 'text-gray-300'
                }`}
                onClick={() => openNote(note)}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{note.name}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* エディタ */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center justify-between border-b border-white/10 bg-[#0b1020] px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{selectedNote?.name ?? 'ノートを選択してください'}</h1>
            {gitError && <p className="truncate text-xs text-red-300">{gitError}</p>}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-100"
              onClick={() => setEditMode(editMode === 'edit' ? 'preview' : 'edit')}
              title="編集/プレビュー"
            >
              {editMode === 'edit' ? <Eye className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
            </button>
            <button
              className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-40"
              onClick={saveCurrentNote}
              disabled={!selectedNote || isSaving}
              title="保存"
            >
              {saveOk ? <Check className="h-4 w-4 text-emerald-300" /> : <Save className="h-4 w-4" />}
            </button>
            <button
              className="rounded p-2 text-gray-400 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40"
              onClick={deleteCurrentNote}
              disabled={!selectedNote}
              title="削除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedNote ? (
            editMode === 'edit' ? (
              <textarea
                className="h-full w-full resize-none bg-[#090d19] p-5 font-mono text-sm leading-7 text-gray-100 outline-none"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <div className="markdown-preview h-full overflow-y-auto p-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              左の一覧からノートを選択してください
            </div>
          )}
        </div>
      </section>

      {/* チャットパネル */}
      <aside className="flex w-80 flex-col border-l border-white/10 bg-[#0b1020]/70">
        <div className="border-b border-white/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-200">AIチャット</span>
            <span className="text-xs text-gray-500">
              {noteContext ? '📄 ノート参照中' : '参照なし'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <select
              className="rounded bg-black/30 px-2 py-1.5 text-xs text-gray-300"
              value={chatMode}
              onChange={(e) => setChatMode(e.target.value as ChatMode)}
            >
              <option value="deep-think">深く考える</option>
              <option value="markdown-struct">MD整理</option>
              <option value="long-explain">詳しく説明</option>
            </select>
            <select
              className="rounded bg-black/30 px-2 py-1.5 text-xs text-gray-300"
              value={aiSpeedMode}
              onChange={(e) => setAiSpeedMode(e.target.value as AiSpeedMode)}
            >
              <option value="fast">高速</option>
              <option value="thinking">思考</option>
            </select>
            <select
              className="rounded bg-black/30 px-2 py-1.5 text-xs text-gray-300"
              value={aiModelMode}
              onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
            >
              <option value="flash-lite">Lite</option>
              <option value="flash">Flash</option>
              <option value="flash-3-5">3.5</option>
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          {chatHistory.length === 0 && !streamedText && (
            <p className="text-center text-xs text-gray-600 pt-4">
              {noteContext ? '開いているノートの内容を前提に回答します' : 'ノートを開くと内容を前提に回答します'}
            </p>
          )}
          {chatHistory.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded p-3 ${message.role === 'user' ? 'bg-indigo-500/15' : 'bg-white/5'}`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ))}
          {streamedText && (
            <div className="rounded bg-white/5 p-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamedText}</ReactMarkdown>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {autoSaveStatus !== 'idle' && (
          <div className="border-t border-white/5 px-3 py-1.5 text-xs text-gray-500">
            {autoSaveStatus === 'saving' ? '保存中...' : '✓ 自動保存しました'}
          </div>
        )}

        <form
          className="flex gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => { e.preventDefault(); sendChat(); }}
        >
          <input
            className="min-w-0 flex-1 rounded bg-black/30 px-3 py-2 text-sm outline-none"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="AIに質問"
          />
          <button
            className="rounded bg-indigo-500 p-2 hover:bg-indigo-400 disabled:opacity-40"
            disabled={isGenerating || !chatInput.trim()}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </aside>

      {/* 設定パネル（オーバーレイ） */}
      {ribbonView === 'settings' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form className="w-full max-w-xl rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl" onSubmit={saveSettings}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">設定</h2>
              <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => setRibbonView('notes')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">Gemini APIキー</span>
              <input
                className="w-full rounded bg-black/30 px-3 py-2 outline-none"
                type="password"
                value={config.geminiApiKey}
                onChange={(e) => setConfig((prev) => ({ ...prev, geminiApiKey: e.target.value }))}
              />
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">ノート保存先</span>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded bg-black/30 px-3 py-2 outline-none"
                  value={config.notesPath}
                  onChange={(e) => setConfig((prev) => ({ ...prev, notesPath: e.target.value }))}
                />
                <button type="button" className="rounded bg-white/10 px-3 hover:bg-white/15" onClick={chooseNotesFolder}>
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-gray-300">GitリモートURL</span>
              <input
                className="w-full rounded bg-black/30 px-3 py-2 outline-none"
                value={config.gitRemoteUrl}
                onChange={(e) => setConfig((prev) => ({ ...prev, gitRemoteUrl: e.target.value }))}
              />
            </label>
            <label className="mb-5 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.autoSync}
                onChange={(e) => setConfig((prev) => ({ ...prev, autoSync: e.target.checked }))}
              />
              自動同期を有効にする
            </label>
            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">保存</button>
          </form>
        </div>
      )}

      {/* 新規ノートモーダル */}
      {showNewNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form className="w-full max-w-md rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl" onSubmit={createNoteFromModal}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">新規ノート</h2>
              <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => setShowNewNoteModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-5 block text-sm">
              <span className="mb-1 block text-gray-300">ノート名</span>
              <input
                className="w-full rounded bg-black/30 px-3 py-2 outline-none"
                value={newNoteName}
                onChange={(e) => setNewNoteName(e.target.value)}
                autoFocus
              />
            </label>
            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">作成</button>
          </form>
        </div>
      )}
    </div>
  );
}
