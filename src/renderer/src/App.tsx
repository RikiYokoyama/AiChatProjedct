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
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

type RibbonView = 'notes' | 'graph' | 'settings' | 'local-graph';

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
      className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${active ? 'bg-indigo-500/30 text-indigo-300' : 'text-gray-500 hover:bg-white/10 hover:text-gray-200'
        }`}
    >
      {icon}
    </button>
  );
}

// ドラッグ可能なタブコンポーネント
function SortableTab({
  note,
  isActive,
  onClick,
  onClose,
}: {
  note: Note;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`no-drag group flex h-9 max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-white/10 px-3 text-xs transition-colors ${isActive
        ? 'bg-[#090d19] text-gray-100'
        : 'bg-[#0b1020] text-gray-400 hover:bg-[#0d1525] hover:text-gray-200'
        }`}
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate">{note.name.replace(/\.md$/i, '')}</span>
      <button
        onClick={onClose}
        className="ml-0.5 hidden shrink-0 rounded p-0.5 hover:bg-white/20 group-hover:flex"
        title="閉じる"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  // 開いているタブの順序付きリスト
  const [openTabs, setOpenTabs] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [noteContext, setNoteContext] = useState<string | null>(null);
  const [isAiNoteMode, setIsAiNoteMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameNoteTarget, setRenameNoteTarget] = useState<Note | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview');

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [ribbonView, setRibbonView] = useState<RibbonView>('notes');
  const [localGraphTarget, setLocalGraphTarget] = useState<string | null>(null);
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
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
      // タブ内のノートをリストの最新情報で更新
      setOpenTabs((prev) =>
        prev
          .map((tab) => list.find((n) => n.name === tab.name) ?? tab)
          .filter((tab) => list.some((n) => n.name === tab.name)),
      );
      if (selectedNote) {
        const updated = list.find((n) => n.name === selectedNote.name);
        setSelectedNote(updated ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ノートを開く：タブ追加 + チャット履歴クリア
  async function openNote(note: Note) {
    const noteContent = await window.electronAPI.readNote(note.name);

    // 別ノートへの切り替えならチャット履歴をクリア
    if (selectedNote && selectedNote.name !== note.name) {
      setChatHistory([]);
      setStreamedText('');
    }

    setSelectedNote(note);
    setContent(noteContent);
    setNoteContext(noteContent);
    setEditMode('preview');

    // タブに未登録なら追加
    setOpenTabs((prev) => {
      if (prev.some((t) => t.name === note.name)) return prev;
      return [...prev, note];
    });
  }

  // タブを閉じる
  function closeTab(e: React.MouseEvent, tabName: string) {
    e.stopPropagation();
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.name === tabName);
      const next = prev.filter((t) => t.name !== tabName);

      if (selectedNote?.name === tabName) {
        // 閉じたタブが選択中 → 直前のタブへ移動
        const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
        if (fallback) {
          openNote(fallback);
        } else {
          setSelectedNote(null);
          setContent('');
          setNoteContext(null);
          setChatHistory([]);
          setStreamedText('');
        }
      }
      return next;
    });
  }

  // タブのドラッグ並び替え
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOpenTabs((prev) => {
        const oldIndex = prev.findIndex((t) => t.name === active.id);
        const newIndex = prev.findIndex((t) => t.name === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  async function createNoteFromModal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let name = cleanFilename(newNoteName);
    const baseTitle = name.replace(/\.md$/i, '');
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${baseTitle} (${counter})`);
      counter++;
    }
    const title = name.replace(/\.md$/i, '');
    const now = new Date();
    const formattedDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const initial = `# ${title}\n作成日時: ${formattedDate}\n\n`;
    const result = await window.electronAPI.saveNote({ filename: name, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }
    setShowNewNoteModal(false);
    setNewNoteName('Untitled');
    await loadNotesList();
    const note: Note = { name, path: result.path ?? name, updatedAt: new Date().toISOString(), content: initial };
    await openNote(note);

    if (!isAiNoteMode || !config.geminiApiKey) {
      setEditMode('edit');
      return;
    }

    setIsGenerating(true);
    setEditMode('preview');
    let accumulatedText = `# ${title}\n作成日時: ${formattedDate}\n\n`;
    setContent(accumulatedText);
    setStreamedText('下書き作成中...');

    const client = new GeminiClient(config.geminiApiKey);
    await client.chatStream(
      [{ role: 'user', content: `「${title}」というテーマに関する詳細な解説記事をMarkdown形式で作成してください。見出しや箇条書きを用いて美しく構成し、前置きなどは含めず本文のみを出力してください。` }],
      'long-explain',
      'fast',
      aiModelMode,
      null,
      (chunk) => {
        accumulatedText += chunk;
        setContent(accumulatedText);
        setStreamedText('');
      },
      async (fullText) => {
        setIsGenerating(false);
        setStreamedText('');
        const finalContent = `# ${title}\n作成日時: ${formattedDate}\n\n${fullText}`;
        setContent(finalContent);
        setNoteContext(finalContent);
        await window.electronAPI.saveNote({ filename: name, content: finalContent });
        await loadNotesList();
      },
      (error) => {
        setIsGenerating(false);
        setStreamedText('');
        alert(error instanceof Error ? error.message : String(error));
      }
    );
  }

  function renameNote(note: Note) {
    setRenameNoteTarget(note);
    setRenameNewName(note.name.replace(/\.md$/i, ''));
    setShowRenameModal(true);
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
    // 削除したノートのタブを閉じる処理をシミュレート
    const tabName = selectedNote.name;
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.name === tabName);
      const next = prev.filter((t) => t.name !== tabName);
      const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
      if (fallback) {
        openNote(fallback);
      } else {
        setSelectedNote(null);
        setContent('');
        setNoteContext(null);
        setChatHistory([]);
        setStreamedText('');
      }
      return next;
    });
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
          setOpenTabs((prev) => (prev.some((t) => t.name === filename) ? prev : [...prev, note]));
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
    if (chatInputRef.current) chatInputRef.current.style.height = 'auto';
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
        setChatHistory([...nextHistory, { role: 'model', content: fullText }]);
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

  useEffect(() => {
    if (!selectedNote || editMode !== 'edit') return;
    const timer = setTimeout(async () => {
      await window.electronAPI.saveNote({ filename: selectedNote.name, content });
      setNoteContext(content);
    }, 1500);
    return () => clearTimeout(timer);
  }, [content, selectedNote, editMode]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#070a13] text-gray-100">
      {/* ウィンドウタイトルバー */}
      <div className="drag-area flex h-[35px] shrink-0 items-center justify-between border-b border-white/10 bg-[#070a13] px-4 select-none">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wider text-gray-300">📄 AIチャットノート制作</span>
        </div>
        {/* Windows標準ボタン用のパディング領域 */}
        <div className="w-[120px] shrink-0" />
      </div>

      {/* メインコンテンツ領域 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
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
          <div className="absolute inset-y-0 bottom-0 left-12 right-0 z-40">
            <GraphView
              notes={notes}
              onSelectNote={(note) => { openNote(note); setRibbonView('notes'); }}
              onClose={() => setRibbonView('notes')}
            />
          </div>
        )}

        {/* ローカルグラフビュー（全画面オーバーレイ） */}
        {ribbonView === 'local-graph' && localGraphTarget && (
          <div className="absolute inset-y-0 bottom-0 left-12 right-0 z-40">
            <GraphView
              notes={notes}
              onSelectNote={(note) => { openNote(note); setRibbonView('notes'); }}
              onClose={() => setRibbonView('notes')}
              isLocal={true}
              centerNoteName={localGraphTarget}
            />
          </div>
        )}

        {/* ノートリスト */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b1020]/70">
          <div className="space-y-2 p-3">
            <button
              className="flex w-full items-center justify-center gap-2 rounded bg-indigo-600 px-3 py-2 font-semibold hover:bg-indigo-500 transition-colors text-sm"
              onClick={() => { setIsAiNoteMode(true); setShowNewNoteModal(true); }}
            >
              <Plus className="h-4 w-4" />
              AIノート作成
            </button>
            <button
              className="flex w-full items-center justify-center gap-2 rounded bg-gray-800 border border-white/10 px-3 py-2 font-semibold hover:bg-gray-700 transition-colors text-sm"
              onClick={() => { setIsAiNoteMode(false); setShowNewNoteModal(true); }}
            >
              <Plus className="h-4 w-4" />
              新規ノート作成
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
                  className={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${selectedNote?.name === note.name ? 'bg-indigo-500/20 text-indigo-100' : 'text-gray-300'
                    }`}
                  onClick={() => openNote(note)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      note,
                    });
                  }}
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{note.name.replace(/\.md$/i, '')}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* エディタ領域 */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* タブバー */}
          <div className="drag-area flex h-9 items-stretch overflow-x-auto border-b border-white/10 bg-[#0b1020]" style={{ scrollbarWidth: 'none' }}>
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext items={openTabs.map((t) => t.name)} strategy={horizontalListSortingStrategy}>
                {openTabs.map((tab) => (
                  <SortableTab
                    key={tab.name}
                    note={tab}
                    isActive={selectedNote?.name === tab.name}
                    onClick={() => openNote(tab)}
                    onClose={(e) => closeTab(e, tab.name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {/* タブがない or タブより右の空き領域がドラッグ可能 */}
            <div className="drag-area min-w-[40px] flex-1" />
          </div>

          {/* エディタツールバー */}
          <div className="flex h-10 items-center justify-between border-b border-white/10 bg-[#0b1020]/80 px-4">
            <div className="min-w-0 flex-1">
              {gitError && <p className="truncate text-xs text-red-300">{gitError}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button
                className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-40"
                onClick={() => {
                  if (selectedNote) {
                    setLocalGraphTarget(selectedNote.name);
                    setRibbonView('local-graph');
                  }
                }}
                disabled={!selectedNote}
                title="ローカルグラフを開く"
              >
                <Network className="h-4 w-4" />
              </button>
              <button
                className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-40"
                onClick={() => setEditMode(editMode === 'edit' ? 'preview' : 'edit')}
                disabled={!selectedNote}
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

          {/* エディタ本体 */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedNote ? (
              editMode === 'edit' ? (
                <textarea
                  className="h-full w-full resize-none bg-[#090d19] p-5 font-mono text-sm leading-7 text-gray-100 outline-none cursor-text"
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

          {/* 下部チャットエリア */}
          {selectedNote && (
            <div className="border-t border-white/10 bg-[#0b1020]/90 p-4">
              {/* ストリーミング回答表示 */}
              {streamedText && (
                <div className="mb-3 rounded bg-white/5 p-3 border border-white/10 text-sm max-h-[120px] overflow-y-auto">
                  <div className="text-xs text-indigo-400 font-semibold mb-1">AI回答中...</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamedText}</ReactMarkdown>
                </div>
              )}

              {/* 設定ドロップダウン（入力欄の上） */}
              <div className="mb-3 flex items-center gap-2">
                <select
                  className="rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                  value={chatMode}
                  onChange={(e) => setChatMode(e.target.value as ChatMode)}
                >
                  <option value="deep-think">思考整理</option>
                  <option value="markdown-struct">ノート作成</option>
                  <option value="long-explain">長文詳細説明</option>
                </select>
                <select
                  className="rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                  value={aiSpeedMode}
                  onChange={(e) => setAiSpeedMode(e.target.value as AiSpeedMode)}
                >
                  <option value="fast">高速</option>
                  <option value="thinking">思考</option>
                </select>
                <select
                  className="rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                  value={aiModelMode}
                  onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
                >
                  <option value="flash-lite">Lite</option>
                  <option value="flash">Flash</option>
                  <option value="flash-3-5">3.5</option>
                </select>
                {autoSaveStatus !== 'idle' && (
                  <span className="ml-auto flex items-center text-xs text-gray-500">
                    {autoSaveStatus === 'saving' ? '保存中...' : '✓ 自動保存しました'}
                  </span>
                )}
              </div>

              {/* チャット入力フォーム */}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => { e.preventDefault(); sendChat(); }}
              >
                <textarea
                  ref={chatInputRef}
                  className="min-w-0 flex-1 resize-none rounded bg-black/30 border border-white/10 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500/50 transition-colors"
                  rows={1}
                  style={{ maxHeight: '120px', overflowY: 'auto', lineHeight: '1.5' }}
                  value={chatInput}
                  onChange={(e) => {
                    setChatInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                      e.currentTarget.style.height = 'auto';
                    }
                  }}
                  placeholder="AIに質問（Shift+Enterで改行）"
                />
                <button
                  className="rounded bg-indigo-500 p-2.5 text-white hover:bg-indigo-400 disabled:opacity-40 flex items-center justify-center shrink-0"
                  disabled={isGenerating || !chatInput.trim()}
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>

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
              <h2 className="text-lg font-semibold">{isAiNoteMode ? 'AIノート作成' : '新規ノート作成'}</h2>
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

            {isAiNoteMode && (
              <div className="mb-5 block text-sm">
                <span className="mb-2 block text-gray-300">AI設定</span>
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                    value={chatMode}
                    onChange={(e) => setChatMode(e.target.value as ChatMode)}
                  >
                    <option value="deep-think">思考整理</option>
                    <option value="markdown-struct">ノート作成</option>
                    <option value="long-explain">長文詳細説明</option>
                  </select>
                  <select
                    className="flex-1 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                    value={aiSpeedMode}
                    onChange={(e) => setAiSpeedMode(e.target.value as AiSpeedMode)}
                  >
                    <option value="fast">高速</option>
                    <option value="thinking">思考</option>
                  </select>
                  <select
                    className="flex-1 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                    value={aiModelMode}
                    onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
                  >
                    <option value="flash-lite">Lite</option>
                    <option value="flash">Flash</option>
                    <option value="flash-3-5">3.5</option>
                  </select>
                </div>
              </div>
            )}

            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">作成</button>
          </form>
        </div>
      )}

      {/* 右クリックコンテキストメニュー */}
      {contextMenu && (
        <div
          className="fixed z-[100] w-36 rounded border border-white/10 bg-[#111625] py-1 shadow-2xl editor-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center px-4 py-2 text-left text-xs text-gray-200 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors"
            onClick={() => {
              setContextMenu(null);
              renameNote(contextMenu.note);
            }}
          >
            名前変更
          </button>
          <button
            className="flex w-full items-center px-4 py-2 text-left text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={async () => {
              setContextMenu(null);
              if (!window.confirm(`${contextMenu.note.name} を削除しますか？`)) return;
              const result = await window.electronAPI.deleteNote(contextMenu.note.name);
              if (!result.success) {
                alert(result.error ?? '削除に失敗しました');
                return;
              }
              const tabName = contextMenu.note.name;
              setOpenTabs((prev) => {
                const idx = prev.findIndex((t) => t.name === tabName);
                const next = prev.filter((t) => t.name !== tabName);
                const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
                if (fallback) {
                  openNote(fallback);
                } else {
                  setSelectedNote(null);
                  setContent('');
                  setNoteContext(null);
                  setChatHistory([]);
                  setStreamedText('');
                }
                return next;
              });
              await loadNotesList();
            }}
          >
            削除
          </button>
        </div>
      )}

      {/* 名前変更モーダル */}
      {showRenameModal && renameNoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowRenameModal(false)}>
          <form
            className="w-full max-w-md rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const oldName = renameNoteTarget.name;
              const cleanedTitle = renameNewName.trim();
              if (!cleanedTitle) {
                alert('ノート名を入力してください');
                return;
              }
              const newName = cleanFilename(cleanedTitle);
              if (newName === oldName) {
                setShowRenameModal(false);
                return;
              }

              const result = await window.electronAPI.renameNote({ oldFilename: oldName, newFilename: newName });
              if (!result.success) {
                alert(result.error ?? '名前変更に失敗しました');
                return;
              }

              await loadNotesList();

              setOpenTabs((prev) =>
                prev.map((t) => {
                  if (t.name === oldName) {
                    return { ...t, name: newName, path: result.path ?? t.path };
                  }
                  return t;
                })
              );

              if (selectedNote?.name === oldName) {
                setSelectedNote((prev) => (prev ? { ...prev, name: newName, path: result.path ?? prev.path } : null));
              }

              setShowRenameModal(false);
              setRenameNoteTarget(null);
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">ノート名の変更</h2>
              <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => setShowRenameModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-5 block text-sm">
              <span className="mb-1 block text-gray-300">新しい名前</span>
              <input
                className="w-full rounded bg-black/30 px-3 py-2 outline-none"
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
                autoFocus
              />
            </label>
            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">変更</button>
          </form>
        </div>
      )}
    </div>
  );
}
