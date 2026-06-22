import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  FolderClosed,
  GitBranch,
  KeyRound,
  Loader2,
  Lock,
  Network,
  Plus,
  Save,
  Search,
  ListTree,
  Send,
  Settings,
  Tag,
  Trash2,
  X,
  Zap,
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
import { AiModelMode, ChatMessage, ChatMode, GeminiClient, generateNoteTitle, generateNoteTags, generateTagsFromContent, generateMocContent, NoteInfo, SYSTEM_PROMPTS } from './lib/gemini';

interface CustomPrompt {
  id: string;
  name: string;
  prompt: string;
}

interface Note {
  name: string;
  path: string;
  updatedAt: string;
  content: string;
  tags?: string[];
  wikiLinks?: string[];
  isEmpty?: boolean;
}

interface AppConfig {
  geminiApiKey: string;
  notesPath: string;
  gitRemoteUrl: string;
  autoSync: boolean;
  vaultAutoLockMinutes?: number;
  customPrompts?: CustomPrompt[];
}

const emptyConfig: AppConfig = {
  geminiApiKey: '',
  notesPath: '',
  gitRemoteUrl: '',
  autoSync: false,
  vaultAutoLockMinutes: 15,
  customPrompts: [],
};

type RibbonView = 'notes' | 'graph' | 'settings' | 'local-graph' | 'search' | 'outline' | 'filetree';

type OutlineItem =
  | { kind: 'heading'; level: number; text: string; line: number }
  | { kind: 'user' | 'ai'; text: string; line: number };

// User/AIラベル判定（## User / **User** 両対応）
function isUserLabel(t: string) {
  return /^#{1,6}\s+(User|ユーザー)$/i.test(t) ||
         /^\*\*(User|ユーザー)\*\*$/i.test(t) ||
         /^(User|ユーザー)[:：]?\s*$/i.test(t);
}
function isAiLabel(t: string) {
  return /^#{1,6}\s+(AI|Claude|Assistant)$/i.test(t) ||
         /^\*\*(AI|Claude|Assistant)\*\*$/i.test(t) ||
         /^(AI|Claude|Assistant)[:：]?\s*$/i.test(t);
}

// 見出し + User/AI ラベルパース
function parseOutline(content: string): OutlineItem[] {
  const lines = content.split('\n');
  const items: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isUserLabel(t) || isAiLabel(t)) {
      let contentLine = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') { contentLine = j; break; }
      }
      if (contentLine >= 0) {
        const text = lines[contentLine].trim().slice(0, 80);
        items.push({ kind: isUserLabel(t) ? 'user' : 'ai', text, line: contentLine });
      }
      continue;
    }
    const hm = t.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      items.push({ kind: 'heading', level: hm[1].length, text: hm[2].trim(), line: i });
    }
  }
  return items;
}

// ファイルツリー構築
function buildFileTree(notes: Note[]): Record<string, Note[]> {
  const tree: Record<string, Note[]> = {};
  notes.forEach((note) => {
    const parts = note.name.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(note);
  });
  return tree;
}

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
      <span className="truncate">{note.name.replace(/^.*\//, '').replace(/\.md$/i, '')}</span>
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
  const [previewContextMenu, setPreviewContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameNoteTarget, setRenameNoteTarget] = useState<Note | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview');

  // 新機能: ソート・サジェスト・Wikiリンクコンテキストメニュー状態
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc');
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const [wikiLinkContextMenu, setWikiLinkContextMenu] = useState<{
    x: number;
    y: number;
    noteName: string;
    displayText: string;
  } | null>(null);

  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu(null);
      setPreviewContextMenu(null);
      setWikiLinkContextMenu(null);
      setShowSuggest(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseMenu();
        setShowNewNoteModal(false);
        setShowMocModal(false);
        setShowRenameModal(false);
        // フォーカスをエディタに戻す
        setTimeout(() => editorRef.current?.focus(), 0);
      }
    };
    window.addEventListener('click', handleCloseMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleCloseMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [masterTags, setMasterTags] = useState<string[]>([]);
  const [startupPulling, setStartupPulling] = useState(true);
  const [startupPullError, setStartupPullError] = useState<string | null>(null);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [migrationLog, setMigrationLog] = useState<string>('');
  const [ribbonView, setRibbonView] = useState<RibbonView>('notes');
  const [localGraphTarget, setLocalGraphTarget] = useState<string | null>(null);
  const [showNewNoteModal, setShowNewNoteModal] = useState(false);
  const [newNoteName, setNewNoteName] = useState('Untitled');
  // 暗号化保管庫
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const [vaultPwInput, setVaultPwInput] = useState('');
  const [vaultPwInput2, setVaultPwInput2] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [pendingPrivateNote, setPendingPrivateNote] = useState<Note | null>(null);
  const [privateMode, setPrivateMode] = useState(false); // true=プライベート専用一覧を表示
  const [showMocModal, setShowMocModal] = useState(false);
  const [mocTitle, setMocTitle] = useState('');
  const [mocAiMode, setMocAiMode] = useState(false);
  const [isMocGenerating, setIsMocGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitError, setGitError] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState<string>('deep-think');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash-lite');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [pendingPrompt, setPendingPrompt] = useState<{ name: string; prompt: string } | null>(null);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [expandedTags, setExpandedTags] = useState<string[]>([]);
  const [expandedLinks, setExpandedLinks] = useState<string[]>([]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewDivRef = useRef<HTMLDivElement>(null);

  const wrapSelectionWithWikiLink = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const selectedText = text.substring(start, end);
    const beforeText = text.substring(0, start);
    const afterText = text.substring(end);

    const newSelectedText = `[[${selectedText}]]`;
    const newContent = beforeText + newSelectedText + afterText;

    setContent(newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 2, start + 2 + selectedText.length);
    }, 0);
  }, [content]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl + L (または Cmd + L / Meta + L)
    const isCtrlL = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l';
    // [ キー単体（テキストが選択されている時のみ動作）
    const textarea = e.currentTarget;
    const isBracket = e.key === '[';
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;

    if (isCtrlL || (isBracket && hasSelection)) {
      e.preventDefault();
      wrapSelectionWithWikiLink();
    }
  };

  const handlePreviewContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection) return;
    const selectedText = selection.toString().trim();
    if (selectedText) {
      e.preventDefault();
      setPreviewContextMenu({
        x: e.clientX,
        y: e.clientY,
        selectedText,
      });
    } else {
      setPreviewContextMenu(null);
    }
  };

  const handleWrapPreviewSelection = () => {
    if (!previewContextMenu) return;
    const { selectedText } = previewContextMenu;
    const index = content.indexOf(selectedText);
    if (index !== -1) {
      const newContent = content.substring(0, index) + `[[${selectedText}]]` + content.substring(index + selectedText.length);
      setContent(newContent);
    }
    setPreviewContextMenu(null);
  };

  const preprocessWikiLinks = (text: string) => {
    if (!text) return '';
    // [[実際のノート名|表示名]] のパターン
    let processed = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2](#wiki-$1)');
    // [[キーワード]] のパターン
    processed = processed.replace(/\[\[([^\]]+)\]\]/g, '[$1](#wiki-$1)');
    return processed;
  };

  const USER_HR_CODE = '__HR_USER__';
  const AI_HR_CODE   = '__HR_AI__';

  // プレビュー時に ## User / ## AI / **User** 等のラベル行をインラインコードマーカーに置換
  const replaceUserAiWithHr = (text: string) => {
    if (!text) return '';
    return text
      .split('\n')
      .map(line => {
        const t = line.trim();
        if (isUserLabel(t)) return `\`${USER_HR_CODE}\``;
        if (isAiLabel(t))   return `\`${AI_HR_CODE}\``;
        return line;
      })
      .join('\n');
  };

  const preprocessContent = (text: string) => replaceUserAiWithHr(preprocessWikiLinks(text));

  const createNewWikiNote = async (noteName: string) => {
    let filename = noteName;
    if (!filename.endsWith('.md')) {
      filename += '.md';
    }
    filename = cleanFilename(filename);

    if (notes.some((n) => n.name.toLowerCase() === filename.toLowerCase())) {
      alert(`ノート "${noteName}" は既に存在します。`);
      return;
    }

    const title = filename.replace(/\.md$/i, '');
    const now = new Date();
    const formattedDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const initial = `# ${title}\n作成日時: ${formattedDate}\n\n`;

    const result = await window.electronAPI.saveNote({ filename, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }

    await loadNotesList();
    const savedName = result.name ?? filename;
    const note: Note = { name: savedName, path: result.path ?? savedName, updatedAt: new Date().toISOString(), content: initial };
    await openNote(note);
    setEditMode('edit');
  };

  const handleWikiLinkClick = async (noteName: string) => {
    let targetFilename = noteName;
    if (!targetFilename.endsWith('.md')) {
      targetFilename += '.md';
    }

    const targetNote = notes.find((n) => n.name.toLowerCase() === targetFilename.toLowerCase());
    if (targetNote) {
      openNote(targetNote);
    } else {
      const confirmCreate = window.confirm(`ノート "${noteName}" は存在しません。新しく作成しますか？`);
      if (confirmCreate) {
        await createNewWikiNote(noteName);
      }
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const getCreatedDate = (note: Note): Date => {
    const match = note.content.match(/作成日時\s*[:：]\s*([^\n\r]+)/);
    if (match) {
      const d = new Date(match[1].trim());
      if (!isNaN(d.getTime())) return d;
    }
    return new Date(note.updatedAt);
  };

  // 全タグ一覧用データの抽出
  const allTagsMap = useMemo(() => {
    const map: Record<string, Note[]> = {};
    for (const note of notes) {
      const tags = note.tags || [];
      for (const tag of tags) {
        if (!map[tag]) {
          map[tag] = [];
        }
        map[tag].push(note);
      }
    }
    return map;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    // privateMode=true ならprivate専用一覧、それ以外は通常（private除外）
    let result = notes.filter((n) =>
      privateMode ? n.name.startsWith('private/') : !n.name.startsWith('private/')
    );
    const query = searchQuery.trim();
    if (query) {
      const queryLower = query.toLowerCase();
      if (queryLower.startsWith('tag:')) {
        const tagName = query.substring(4).trim().toLowerCase();
        result = result.filter((note) =>
          (note.tags || []).some((t) => t.toLowerCase().includes(tagName))
        );
      } else if (queryLower.startsWith('#')) {
        const tagName = query.substring(1).trim().toLowerCase();
        result = result.filter((note) =>
          (note.tags || []).some((t) => t.toLowerCase().includes(tagName))
        );
      } else if (queryLower.startsWith('link:')) {
        const linkName = query.substring(5).trim().toLowerCase();
        result = result.filter((note) =>
          (note.wikiLinks || []).some((l) => l.toLowerCase().includes(linkName))
        );
      } else {
        result = result.filter((note) => note.name.toLowerCase().includes(queryLower));
      }
    }

    return result.sort((a, b) => {
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name, 'ja');
      } else if (sortBy === 'name-desc') {
        return b.name.localeCompare(a.name, 'ja');
      } else if (sortBy === 'date-asc') {
        const da = getCreatedDate(a);
        const db = getCreatedDate(b);
        return da.getTime() - db.getTime();
      } else {
        const da = getCreatedDate(a);
        const db = getCreatedDate(b);
        return db.getTime() - da.getTime();
      }
    });
  }, [notes, searchQuery, sortBy, privateMode]);

  // 検索サジェスト候補の抽出
  const suggestions = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return [];
    const queryLower = query.toLowerCase();

    if (queryLower.startsWith('tag:')) {
      const val = query.substring(4).trim().toLowerCase();
      const allTags = Object.keys(allTagsMap);
      return allTags
        .filter((t) => t.toLowerCase().includes(val))
        .map((t) => ({ type: 'tag', value: t, label: `#${t}` }));
    } else if (queryLower.startsWith('#')) {
      const val = query.substring(1).trim().toLowerCase();
      const allTags = Object.keys(allTagsMap);
      return allTags
        .filter((t) => t.toLowerCase().includes(val))
        .map((t) => ({ type: 'tag', value: t, label: `#${t}` }));
    } else if (queryLower.startsWith('link:')) {
      const val = query.substring(5).trim().toLowerCase();
      return notes
        .filter((n) => (privateMode ? n.name.startsWith('private/') : !n.name.startsWith('private/')) && n.name.toLowerCase().includes(val))
        .map((n) => ({ type: 'link', value: n.name, label: `📄 ${n.name.replace(/^.*\//, '').replace(/\.md$/i, '')}` }));
    } else {
      return notes
        .filter((n) => (privateMode ? n.name.startsWith('private/') : !n.name.startsWith('private/')) && n.name.toLowerCase().includes(queryLower))
        .map((n) => ({ type: 'note', value: n.name, label: `📄 ${n.name.replace(/^.*\//, '').replace(/\.md$/i, '')}` }));
    }
  }, [notes, searchQuery, allTagsMap, privateMode]);

  const selectSuggestion = (s: { type: string; value: string }) => {
    if (s.type === 'tag') {
      if (searchQuery.toLowerCase().startsWith('tag:')) {
        setSearchQuery(`tag:${s.value}`);
      } else {
        setSearchQuery(`#${s.value}`);
      }
    } else if (s.type === 'link') {
      setSearchQuery(`link:${s.value}`);
    } else {
      setSearchQuery(s.value);
    }
    setShowSuggest(false);
    setSuggestIndex(-1);
  };

  // Wikiリンク解除処理
  const handleRemoveWikiLink = async () => {
    if (!wikiLinkContextMenu || !selectedNote) return;
    const { noteName, displayText } = wikiLinkContextMenu;

    let nextContent = content;
    const escapedNoteName = noteName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const escapedDisplayText = displayText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    // パターン1: [[noteName|displayText]]
    const pattern1 = new RegExp(`\\[\\[${escapedNoteName}\\|${escapedDisplayText}\\]\\]`, 'g');
    // パターン2: [[noteName]]
    const pattern2 = new RegExp(`\\[\\[${escapedNoteName}\\]\\]`, 'g');

    nextContent = nextContent.replace(pattern1, displayText);
    if (displayText === noteName) {
      nextContent = nextContent.replace(pattern2, noteName);
    } else {
      nextContent = nextContent.replace(pattern2, noteName);
    }

    setContent(nextContent);
    setNoteContext(nextContent);

    const result = await window.electronAPI.saveNote({ filename: selectedNote.name, content: nextContent });
    if (result.success) {
      setSelectedNote((prev) => (prev ? { ...prev, content: nextContent } : null));
      await loadNotesList();
    }
    setWikiLinkContextMenu(null);
  };


  // 全ノートのリンク関係（発リンク・被リンク）データの解決
  const globalLinksMap = useMemo(() => {
    const map: Record<string, { outgoing: string[]; incoming: string[] }> = {};
    
    for (const note of notes) {
      const cleanName = note.name.replace(/^.*\//, '').replace(/\.md$/i, '');
      map[cleanName] = { outgoing: [], incoming: [] };
    }

    for (const note of notes) {
      const sourceName = note.name.replace(/^.*\//, '').replace(/\.md$/i, '');
      const outgoing = note.wikiLinks || [];
      
      if (map[sourceName]) {
        map[sourceName].outgoing = outgoing;
      }

      for (const dest of outgoing) {
        if (map[dest]) {
          if (!map[dest].incoming.includes(sourceName)) {
            map[dest].incoming.push(sourceName);
          }
        }
      }
    }
    return map;
  }, [notes]);

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
    let noteContent: string;
    try {
      noteContent = await window.electronAPI.readNote(note.name);
    } catch (e) {
      if (String(e).includes('VAULT_LOCKED')) {
        // 保管庫がロック中 → 解除ダイアログを表示し、解除後に開く
        setPendingPrivateNote(note);
        setVaultPwInput('');
        setVaultError('');
        setShowVaultUnlock(true);
        return;
      }
      throw e;
    }

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

  // リボンの鍵アイコン: 未作成→作成 / ロック中→解除 / 解除中→ロックして通常一覧へ戻る
  function handleVaultKeyClick() {
    if (!vaultExists) {
      setVaultPwInput(''); setVaultPwInput2(''); setVaultError(''); setShowVaultSetup(true);
    } else if (!vaultUnlocked) {
      setVaultPwInput(''); setVaultError(''); setPendingPrivateNote(null); setShowVaultUnlock(true);
    } else {
      handleVaultLock();
    }
  }

  // 保管庫: ロック解除
  async function handleVaultUnlock() {
    setVaultError('');
    const res = await window.electronAPI.vaultUnlock(vaultPwInput);
    if (!res.success) {
      setVaultError(res.error ?? 'ロック解除に失敗しました');
      return;
    }
    setVaultUnlocked(true);
    setPrivateMode(true); // プライベート専用一覧に切り替え
    setRibbonView('notes');
    setShowVaultUnlock(false);
    setVaultPwInput('');
    const pending = pendingPrivateNote;
    setPendingPrivateNote(null);
    if (pending) await openNote(pending);
  }

  // 保管庫: 新規作成（パスワード設定）
  async function handleVaultSetup() {
    setVaultError('');
    if (vaultPwInput.length < 4) {
      setVaultError('パスワードは4文字以上にしてください');
      return;
    }
    if (vaultPwInput !== vaultPwInput2) {
      setVaultError('パスワードが一致しません');
      return;
    }
    const res = await window.electronAPI.vaultSetup(vaultPwInput);
    if (!res.success) {
      setVaultError(res.error ?? '作成に失敗しました');
      return;
    }
    setVaultExists(true);
    setVaultUnlocked(true);
    setPrivateMode(true);
    setShowVaultSetup(false);
    setVaultPwInput('');
    setVaultPwInput2('');
  }

  // 保管庫: 手動ロック（通常一覧へ戻す）
  async function handleVaultLock() {
    await window.electronAPI.vaultLock();
    setVaultUnlocked(false);
    setPrivateMode(false);
    // private ノートを開いていたら閉じてプレビューをクリア
    if (selectedNote && selectedNote.name.startsWith('private/')) {
      setContent('');
      setSelectedNote(null);
    }
  }

  async function createNoteByName(rawName: string) {
    let name = cleanFilename(rawName);
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
    const filename = privateMode ? `private/${name}` : name;
    const result = await window.electronAPI.saveNote({ filename, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }
    await loadNotesList();
    const savedName = result.name ?? name;
    const note: Note = { name: savedName, path: result.path ?? savedName, updatedAt: new Date().toISOString(), content: initial };
    await openNote(note);
    setRibbonView('notes');
    setEditMode('edit');
  }

  // グラフビュー用メモ化コールバック（毎レンダリングで新参照を作らない）
  const handleGraphSelectNote = useCallback((note: Note) => {
    openNote(note);
    setRibbonView('notes');
  }, []);

  const handleGraphClose = useCallback(() => {
    setRibbonView('notes');
    setTimeout(() => editorRef.current?.focus(), 0);
  }, []);

  const handleGraphCreateNote = useCallback((name: string) => {
    createNoteByName(name);
  }, []);

  function scrollToHeading(text: string, level: number, line: number) {
    if (editMode === 'edit') {
      const ta = editorRef.current;
      if (!ta) return;
      const lineHeight = 28;
      ta.scrollTop = line * lineHeight - ta.clientHeight / 3;
      ta.focus();
    } else {
      const div = previewDivRef.current;
      if (!div) return;
      if (level > 0) {
        // Markdown見出し: h1〜h6 要素を探す
        const headings = div.querySelectorAll(`h${level}`);
        for (const h of headings) {
          if (h.textContent?.trim() === text) {
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      } else {
        // User/AI コンテンツ: テキストが一致する段落・要素を探す
        const els = div.querySelectorAll('p, li, blockquote');
        for (const el of els) {
          const elText = el.textContent?.trim() ?? '';
          if (elText.startsWith(text.slice(0, 20)) && text.length > 0) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      }
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
    // プライベート保管庫を開いている間に作成 → private/ 配下に暗号化保存
    const filename = privateMode ? `private/${name}` : name;
    const result = await window.electronAPI.saveNote({ filename, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }
    setShowNewNoteModal(false);
    setNewNoteName('Untitled');
    await loadNotesList();
    const savedName = result.name ?? name;
    const note: Note = { name: savedName, path: result.path ?? savedName, updatedAt: new Date().toISOString(), content: initial };
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
        await window.electronAPI.saveNote({ filename: savedName, content: finalContent });
        await loadNotesList();

        // 初期生成文章からプロンプトブロックを検出して保留登録する
        const promptBlockRegex = /\[PROMPT\]\s*名前\s*[:：]\s*([^\n\r]+)\s*指示\s*[:：]\s*([\s\S]+?)\s*\[\/PROMPT\]/i;
        const promptMatch = promptBlockRegex.exec(fullText);
        if (promptMatch) {
          const pName = promptMatch[1].trim();
          const pPromptText = promptMatch[2].trim();
          if (pName && pPromptText) {
            setPendingPrompt({ name: pName, prompt: pPromptText });
          }
        }
      },
      (error) => {
        setIsGenerating(false);
        setStreamedText('');
        alert(error instanceof Error ? error.message : String(error));
      }
    );
  }

  async function createMocFromModal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = mocTitle.trim() || 'MOC';
    let filename = `moc/${cleanFilename(title)}`;
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === filename.toLowerCase())) {
      filename = `moc/${cleanFilename(`${title} (${counter++})`)}`;
    }
    const now = new Date();
    const formatted = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    let body = `# ${title} (MOC)\n作成日時: ${formatted}\n\n`;

    if (mocAiMode && config.geminiApiKey) {
      setIsMocGenerating(true);
      try {
        const noteInfos: NoteInfo[] = notes
          .filter(n => !n.name.startsWith('moc/') && !n.name.startsWith('_'))
          .slice(0, 80) // API負荷軽減
          .map(n => ({
            name: n.name.replace(/^.*\//, '').replace(/\.md$/i, ''),
            tags: n.tags ?? [],
            snippet: (n.content ?? '').replace(/^#[^\n]*\n/, '').replace(/作成日時:[^\n]*\n?/, '').trim().slice(0, 100),
          }));
        const generated = await generateMocContent(config.geminiApiKey, title, noteInfos);
        body += generated + '\n';
      } catch (err) {
        alert('AI MOC生成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
        setIsMocGenerating(false);
        return;
      }
      setIsMocGenerating(false);
    } else {
      body += `## リンク\n\n- [[関連ノート]]\n`;
    }

    const result = await window.electronAPI.saveNote({ filename, content: body });
    if (!result.success) { alert(result.error ?? '作成失敗'); return; }
    setShowMocModal(false);
    setMocTitle('');
    setMocAiMode(false);
    await loadNotesList();
    const note: Note = { name: filename, path: result.path ?? filename, updatedAt: new Date().toISOString(), content: body };
    await openNote(note);
    setEditMode('edit');
  }

  function renameNote(note: Note) {
    setRenameNoteTarget(note);
    setRenameNewName(note.name.replace(/^.*\//, '').replace(/\.md$/i, ''));
    setShowRenameModal(true);
  }

  // タグ更新・追加・削除ロジック
  async function updateNoteTags(targetNote: Note, nextTags: string[]) {
    let newContent = content;
    // タグ行のパターン
    const tagLineRegex = /^(タグ|tags|tag)\s*[:：]\s*[^\n\r]*/im;
    const dateLineRegex = /^(作成日時\s*[:：]\s*[^\n\r]*)/m;

    const tagsString = nextTags.join(', ');

    if (tagLineRegex.test(newContent)) {
      // 既存のタグ行を置換
      newContent = newContent.replace(tagLineRegex, `タグ: ${tagsString}`);
    } else if (dateLineRegex.test(newContent)) {
      // 作成日時行の直後にタグ行を挿入
      newContent = newContent.replace(dateLineRegex, (match) => `${match}\nタグ: ${tagsString}`);
    } else {
      // どちらもなければファイルの先頭に挿入
      newContent = `タグ: ${tagsString}\n\n${newContent}`;
    }

    setContent(newContent);
    setNoteContext(newContent);
    
    // 保存
    const result = await window.electronAPI.saveNote({ filename: targetNote.name, content: newContent });
    if (result.success) {
      setSelectedNote(prev => prev ? { ...prev, tags: nextTags, content: newContent } : null);
      await loadNotesList();
    }
  }

  async function handleAddTag(tag: string) {
    if (!selectedNote || !tag.trim()) return;
    const cleanTag = tag.trim().replace(/^#/, '');
    const currentTags = selectedNote.tags || [];
    if (currentTags.includes(cleanTag)) return;
    const nextTags = [...currentTags, cleanTag];
    await updateNoteTags(selectedNote, nextTags);
    setNewTagInput('');
  }

  async function handleRemoveTag(tagToRemove: string) {
    if (!selectedNote) return;
    const currentTags = selectedNote.tags || [];
    const nextTags = currentTags.filter(t => t !== tagToRemove);
    await updateNoteTags(selectedNote, nextTags);
  }

  // モード解決関数
  function getSystemPrompt(mode: string): string {
    if (mode in SYSTEM_PROMPTS) {
      return SYSTEM_PROMPTS[mode as ChatMode];
    }
    const custom = (config.customPrompts || []).find(p => p.id === mode);
    return custom ? custom.prompt : SYSTEM_PROMPTS['deep-think'];
  }

  // プロンプトを本文から検出し、自動登録する（手動保存や「はい」選択時に使用）
  async function scanAndRegisterPrompts(text: string, forcePrompts?: { name: string; prompt: string }[]) {
    let updated = false;
    const nextCustomPrompts = [...(config.customPrompts || [])];

    if (forcePrompts) {
      for (const p of forcePrompts) {
        const existingIdx = nextCustomPrompts.findIndex(cp => cp.name.toLowerCase() === p.name.toLowerCase());
        if (existingIdx >= 0) {
          if (nextCustomPrompts[existingIdx].prompt !== p.prompt) {
            nextCustomPrompts[existingIdx] = { id: nextCustomPrompts[existingIdx].id, name: p.name, prompt: p.prompt };
            updated = true;
          }
        } else {
          const newPrompt = { id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: p.name, prompt: p.prompt };
          nextCustomPrompts.push(newPrompt);
          updated = true;
        }
      }
    }

    const promptBlockRegex = /\[PROMPT\]\s*名前\s*[:：]\s*([^\n\r]+)\s*指示\s*[:：]\s*([\s\S]+?)\s*\[\/PROMPT\]/gi;
    let match;
    while ((match = promptBlockRegex.exec(text)) !== null) {
      const name = match[1].trim();
      const promptText = match[2].trim();
      if (!name || !promptText) continue;

      const existingIdx = nextCustomPrompts.findIndex(cp => cp.name.toLowerCase() === name.toLowerCase());
      if (existingIdx >= 0) {
        if (nextCustomPrompts[existingIdx].prompt !== promptText) {
          nextCustomPrompts[existingIdx] = { id: nextCustomPrompts[existingIdx].id, name, prompt: promptText };
          updated = true;
        }
      } else {
        const newPrompt = { id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name, prompt: promptText };
        nextCustomPrompts.push(newPrompt);
        updated = true;
      }
    }

    if (updated) {
      const newConfig = { ...config, customPrompts: nextCustomPrompts };
      setConfig(newConfig);
      await window.electronAPI.saveConfig(newConfig);
    }
  }

  // 設定画面での手動追加・削除
  async function handleAddCustomPrompt(name: string, promptText: string) {
    if (!name.trim() || !promptText.trim()) return;
    const nextCustomPrompts = [...(config.customPrompts || [])];
    const existingIdx = nextCustomPrompts.findIndex(cp => cp.name.toLowerCase() === name.trim().toLowerCase());
    if (existingIdx >= 0) {
      alert('同じ名前のプロンプトが既に存在します。');
      return;
    }
    const newPrompt = { id: `custom-${Date.now()}`, name: name.trim(), prompt: promptText.trim() };
    nextCustomPrompts.push(newPrompt);
    const newConfig = { ...config, customPrompts: nextCustomPrompts };
    setConfig(newConfig);
    await window.electronAPI.saveConfig(newConfig);
    setNewPromptName('');
    setNewPromptText('');
  }

  async function handleDeleteCustomPrompt(id: string) {
    if (!window.confirm('このプロンプトを削除しますか？')) return;
    const nextCustomPrompts = (config.customPrompts || []).filter(cp => cp.id !== id);
    const newConfig = { ...config, customPrompts: nextCustomPrompts };
    setConfig(newConfig);
    await window.electronAPI.saveConfig(newConfig);
    if (chatMode === id) {
      setChatMode('deep-think');
    }
  }

  async function saveCurrentNote() {
    if (!selectedNote) return;
    setIsSaving(true);
    setSaveOk(false);
    
    await scanAndRegisterPrompts(content);

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

  async function createWikiNote(title: string) {
    let name = cleanFilename(title);
    const now = new Date();
    const formattedDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const initial = `# ${title}\n作成日時: ${formattedDate}\n\n`;
    const result = await window.electronAPI.saveNote({ filename: name, content: initial });
    if (!result.success) {
      alert(result.error ?? 'ノートを作成できませんでした');
      return;
    }
    await loadNotesList();
    const savedName = result.name ?? name;
    const note: Note = { name: savedName, path: result.path ?? savedName, updatedAt: new Date().toISOString(), content: initial };
    await openNote(note);
    setEditMode('edit');
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
      // 会話からタグを自動生成
      const extracted = await generateNoteTags(config.geminiApiKey, userPrompt, aiReply);

      if (selectedNote) {
        const currentTags = selectedNote.tags || [];
        const nextTags = Array.from(new Set([...currentTags, ...extracted]));
        if (extracted.length > 0) {
          const nextMasterTags = Array.from(new Set([...masterTags, ...extracted]));
          setMasterTags(nextMasterTags);
          window.electronAPI.saveMasterTags(nextMasterTags);
        }

        await window.electronAPI.appendToNote({ filename: selectedNote.name, appendContent: block });
        const noteContent = await window.electronAPI.readNote(selectedNote.name);
        
        // 保存済みの内容に対してタグを更新
        let finalContent = noteContent;
        const tagLineRegex = /^(タグ|tags|tag)\s*[:：]\s*[^\n\r]*/im;
        const dateLineRegex = /^(作成日時\s*[:：]\s*[^\n\r]*)/m;
        const tagsString = nextTags.join(', ');

        if (tagLineRegex.test(finalContent)) {
          finalContent = finalContent.replace(tagLineRegex, `タグ: ${tagsString}`);
        } else if (dateLineRegex.test(finalContent)) {
          finalContent = finalContent.replace(dateLineRegex, (match) => `${match}\nタグ: ${tagsString}`);
        } else {
          finalContent = `タグ: ${tagsString}\n\n${finalContent}`;
        }

        // 更新したタグ付きのテキストを再度保存
        await window.electronAPI.saveNote({ filename: selectedNote.name, content: finalContent });

        setContent(finalContent);
        setNoteContext(finalContent);
        setSelectedNote(prev => prev ? { ...prev, tags: nextTags, content: finalContent } : null);

        // 最新のノート本文全体から [PROMPT] をスキャンして保留登録する
        const promptBlockRegexGlobal = /\[PROMPT\]\s*名前\s*[:：]\s*([^\n\r]+)\s*指示\s*[:：]\s*([\s\S]+?)\s*\[\/PROMPT\]/gi;
        let match;
        let detectedPrompt: { name: string; prompt: string } | null = null;
        while ((match = promptBlockRegexGlobal.exec(finalContent)) !== null) {
          const pName = match[1].trim();
          const pPromptText = match[2].trim();
          if (pName && pPromptText) {
            const exists = (config.customPrompts || []).some(
              (cp) => cp.name.toLowerCase() === pName.toLowerCase() && cp.prompt === pPromptText
            );
            if (!exists) {
              detectedPrompt = { name: pName, prompt: pPromptText };
              break;
            }
          }
        }
        if (detectedPrompt) {
          setPendingPrompt(detectedPrompt);
        }
      } else {
        const title = await generateNoteTitle(config.geminiApiKey, userPrompt, aiReply);
        const filename = cleanFilename(title);
        const tagsString = extracted.join(', ');
        const fullContent = `# ${title}\n\n作成日時: ${new Date().toLocaleString()}\nタグ: ${tagsString}\n\n${block}\n`;
        const result = await window.electronAPI.saveNote({ filename, content: fullContent });
        if (result.success) {
          const savedName = result.name ?? filename;
          const note: Note = { name: savedName, path: result.path ?? savedName, updatedAt: new Date().toISOString(), content: fullContent, tags: extracted };
          setSelectedNote(note);
          setContent(fullContent);
          setNoteContext(fullContent);
          setOpenTabs((prev) => (prev.some((t) => t.name === savedName) ? prev : [...prev, note]));

          // 新規自動保存ノート全体から [PROMPT] をスキャンして保留登録する
          const promptBlockRegexGlobal = /\[PROMPT\]\s*名前\s*[:：]\s*([^\n\r]+)\s*指示\s*[:：]\s*([\s\S]+?)\s*\[\/PROMPT\]/gi;
          let match;
          let detectedPrompt: { name: string; prompt: string } | null = null;
          while ((match = promptBlockRegexGlobal.exec(fullContent)) !== null) {
            const pName = match[1].trim();
            const pPromptText = match[2].trim();
            if (pName && pPromptText) {
              const exists = (config.customPrompts || []).some(
                (cp) => cp.name.toLowerCase() === pName.toLowerCase() && cp.prompt === pPromptText
              );
              if (!exists) {
                detectedPrompt = { name: pName, prompt: pPromptText };
                break;
              }
            }
          }
          if (detectedPrompt) {
            setPendingPrompt(detectedPrompt);
          }
        }
      }
      await loadNotesList();
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Auto save error:', err);
      setAutoSaveStatus('idle');
    }
  }

  async function handlePcAiAction(action: 'tags' | 'summary') {
    if (!selectedNote || !config.geminiApiKey) return;
    const body = content;

    if (action === 'tags') {
      setAutoSaveStatus('saving');
      const tags = await generateTagsFromContent(config.geminiApiKey, body, masterTags);
      const current = selectedNote.tags || [];
      const nextTags = Array.from(new Set([...current, ...tags]));
      const tagLineRegex = /^(タグ|tags|tag)\s*[:：]\s*[^\n\r]*/im;
      const tagsString = nextTags.join(', ');
      const nextContent = tagLineRegex.test(body)
        ? body.replace(tagLineRegex, `タグ: ${tagsString}`)
        : `タグ: ${tagsString}\n\n${body}`;
      await window.electronAPI.saveNote({ filename: selectedNote.name, content: nextContent });
      setContent(nextContent);
      setNoteContext(nextContent);
      setSelectedNote((prev) => prev ? { ...prev, tags: nextTags, content: nextContent } : null);
      const nextMasterTags = Array.from(new Set([...masterTags, ...tags]));
      setMasterTags(nextMasterTags);
      await window.electronAPI.saveMasterTags(nextMasterTags);
      await loadNotesList();
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 1500);
      return;
    }

    // 要約
    setIsGenerating(true);
    const client = new GeminiClient(config.geminiApiKey);
    let acc = body + '\n\n## 要約\n\n';
    setContent(acc);
    await client.chatStream(
      [{ role: 'user', content: `以下のノートを3〜5行で簡潔に要約してください。要約本文のみを出力してください。\n\n${body.slice(0, 8000)}` }],
      SYSTEM_PROMPTS['markdown-struct'],
      aiModelMode,
      null,
      (chunk) => { acc += chunk; setContent(acc); },
      async () => {
        await window.electronAPI.saveNote({ filename: selectedNote.name, content: acc });
        setNoteContext(acc);
        await loadNotesList();
        setIsGenerating(false);
      },
      (err) => {
        setIsGenerating(false);
        alert(err instanceof Error ? err.message : String(err));
      },
    );
  }

  async function sendChat(overridePrompt?: string) {
    const prompt = (overridePrompt ?? chatInput).trim();
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
      getSystemPrompt(chatMode),
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
      chatMode === 'long-doc' ? { contextLimit: 100000 } : undefined,
    );
  }

  useEffect(() => {
    window.electronAPI.loadConfig().then((loaded) => {
      setConfig(loaded);
      if (!loaded.geminiApiKey) setRibbonView('settings');
    });
    window.electronAPI.readMasterTags().then((tags) => setMasterTags(tags));
    // 起動時 git pull → 完了後にノートリスト読み込み
    window.electronAPI.startupGitPull().then((res) => {
      if (!res.success && !res.skipped) setStartupPullError(res.error ?? null);
      setStartupPulling(false);
      loadNotesList();
      window.electronAPI.checkMigration().then(({ done }) => {
        if (!done) setShowMigrationDialog(true);
      });
    });
    const unsubscribe = window.electronAPI.onGitStatusChanged((status, error) => {
      setGitStatus(status);
      setGitError(error ?? null);
    });
    // 保管庫の状態取得＋自動ロック通知の購読
    window.electronAPI.vaultStatus().then((s) => {
      setVaultExists(s.exists);
      setVaultUnlocked(s.unlocked);
    });
    const unsubVault = window.electronAPI.onVaultLocked(() => {
      setVaultUnlocked(false);
      setPrivateMode(false);
    });
    return () => { unsubscribe(); unsubVault(); };
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

  async function handleRunMigration() {
    setMigrationStatus('running');
    const result = await window.electronAPI.runMigration();
    if (result.skipped) { setShowMigrationDialog(false); return; }
    if (result.success) {
      setMigrationLog(`${(result.moved ?? []).length}件のファイルを notes/ フォルダへ移行しました。`);
      setMigrationStatus('done');
      await loadNotesList();
    } else {
      setMigrationLog(`エラー: ${result.error}`);
      setMigrationStatus('error');
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#070a13] text-gray-100">
      {/* 起動時 git pull ローディング画面 */}
      {startupPulling && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#070a13]">
          <div className="mb-4 text-2xl font-bold text-gray-200">📄 AIチャットノート</div>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            GitHubから最新データを取得中...
          </div>
        </div>
      )}
      {/* pull エラーバナー（操作は続行可能） */}
      {!startupPulling && startupPullError && (
        <div className="flex shrink-0 items-center justify-between bg-amber-900/60 px-4 py-1 text-xs text-amber-300">
          <span>起動時の同期に失敗しました: {startupPullError}</span>
          <button onClick={() => setStartupPullError(null)} className="ml-4 text-amber-400 hover:text-white">✕</button>
        </div>
      )}
      {/* フォルダ移行ダイアログ */}
      {showMigrationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[420px] rounded-xl border border-white/10 bg-[#0d1117] p-6 shadow-2xl">
            <h2 className="mb-3 text-base font-bold text-white">フォルダ構成の更新</h2>
            {migrationStatus === 'idle' && (
              <>
                <p className="mb-4 text-sm text-gray-300">
                  ノートを <code className="rounded bg-white/10 px-1">notes/</code>・<code className="rounded bg-white/10 px-1">memos/</code>・<code className="rounded bg-white/10 px-1">moc/</code> フォルダに整理します。<br />
                  ルート直下の .md ファイルを <code className="rounded bg-white/10 px-1">notes/</code> へ移行します。
                </p>
                <div className="flex gap-3">
                  <button onClick={handleRunMigration} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500">移行する</button>
                  <button onClick={() => setShowMigrationDialog(false)} className="flex-1 rounded-lg border border-white/10 py-2 text-sm text-gray-400 hover:bg-white/5">後で</button>
                </div>
              </>
            )}
            {migrationStatus === 'running' && (
              <p className="text-sm text-indigo-300">移行中...</p>
            )}
            {(migrationStatus === 'done' || migrationStatus === 'error') && (
              <>
                <p className={`mb-4 text-sm ${migrationStatus === 'done' ? 'text-emerald-400' : 'text-red-400'}`}>{migrationLog}</p>
                <button onClick={() => setShowMigrationDialog(false)} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500">閉じる</button>
              </>
            )}
          </div>
        </div>
      )}
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
            <RibbonButton icon={<Search className="h-4 w-4" />} active={ribbonView === 'search'} title="検索/一覧" onClick={() => setRibbonView('search')} />
            <RibbonButton icon={<ListTree className="h-4 w-4" />} active={ribbonView === 'outline'} title="アウトライン" onClick={() => setRibbonView('outline')} />
            <RibbonButton icon={<FolderOpen className="h-4 w-4" />} active={ribbonView === 'filetree'} title="ファイルツリー" onClick={() => setRibbonView('filetree')} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <button
              title="Git同期"
              onClick={syncGit}
              className="flex h-10 w-10 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-200"
            >
              {gitStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            </button>
            <button
              title={vaultUnlocked ? 'プライベート保管庫（解除中・クリックでロック）' : 'プライベート保管庫（クリックで解除）'}
              onClick={handleVaultKeyClick}
              className={`flex h-10 w-10 items-center justify-center rounded transition-colors hover:bg-white/10 ${vaultUnlocked ? 'text-emerald-400 hover:text-emerald-300' : 'text-gray-500 hover:text-gray-200'}`}
            >
              {vaultUnlocked ? <KeyRound className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
            <RibbonButton icon={<Settings className="h-4 w-4" />} active={ribbonView === 'settings'} title="設定" onClick={() => setRibbonView('settings')} />
          </div>
        </nav>

        {/* グラフビュー（全画面オーバーレイ） */}
        {ribbonView === 'graph' && (
          <div className="absolute inset-y-0 bottom-0 left-12 right-0 z-40">
            <GraphView
              notes={notes}
              onSelectNote={handleGraphSelectNote}
              onClose={handleGraphClose}
              onCreateNote={handleGraphCreateNote}
            />
          </div>
        )}

        {/* ローカルグラフビュー（全画面オーバーレイ） */}
        {ribbonView === 'local-graph' && localGraphTarget && (
          <div className="absolute inset-y-0 bottom-0 left-12 right-0 z-40">
            <GraphView
              notes={notes}
              onSelectNote={handleGraphSelectNote}
              onClose={handleGraphClose}
              isLocal={true}
              centerNoteName={localGraphTarget}
              onCreateNote={handleGraphCreateNote}
            />
          </div>
        )}

        {/* ノートリスト */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b1020]/70">
          {ribbonView === 'search' ? (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="p-3 border-b border-white/10">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">検索・一覧</h2>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-4 min-h-0">
                {/* 1. タグ一覧セクション */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-indigo-300">
                    <span>▼ 全タグ一覧</span>
                  </div>
                  <div className="pl-2 space-y-1">
                    {Object.keys(allTagsMap).length === 0 ? (
                      <div className="px-2 py-1 text-xs text-gray-500">タグが見つかりません</div>
                    ) : (
                      Object.entries(allTagsMap).map(([tag, tagNotes]) => {
                        const isExpanded = expandedTags.includes(tag);
                        return (
                          <div key={tag} className="space-y-0.5">
                            <button
                              onClick={() => {
                                setExpandedTags(prev =>
                                  isExpanded ? prev.filter(t => t !== tag) : [...prev, tag]
                                );
                              }}
                              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-emerald-400 hover:bg-white/5 transition-colors"
                            >
                              <span className="text-[10px] text-gray-500">{isExpanded ? '▼' : '▶'}</span>
                              <span className="font-semibold truncate">#{tag} ({tagNotes.length})</span>
                            </button>
                            {isExpanded && (
                              <div className="pl-4 border-l border-white/5 ml-2.5 space-y-0.5">
                                {tagNotes.map(n => (
                                  <button
                                    key={n.name}
                                    onClick={() => openNote(n)}
                                    className={`flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs hover:bg-white/10 ${selectedNote?.name === n.name ? 'text-indigo-300 font-medium' : 'text-gray-400'}`}
                                  >
                                    <FileText className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{n.name.replace(/\.md$/i, '')}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 2. リンク一覧セクション */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-indigo-300">
                    <span>▼ 全リンク一覧</span>
                  </div>
                  <div className="pl-2 space-y-1">
                    {(() => {
                      const notesWithLinks = notes.filter(n => {
                        const cleanName = n.name.replace(/\.md$/i, '');
                        const relations = globalLinksMap[cleanName] || { outgoing: [], incoming: [] };
                        return relations.outgoing.length > 0 || relations.incoming.length > 0;
                      });

                      if (notesWithLinks.length === 0) {
                        return <div className="px-2 py-1 text-xs text-gray-500">リンク関係があるノートがありません</div>;
                      }

                      return notesWithLinks.map(n => {
                        const cleanName = n.name.replace(/\.md$/i, '');
                        const isExpanded = expandedLinks.includes(cleanName);
                        const relations = globalLinksMap[cleanName] || { outgoing: [], incoming: [] };

                        return (
                          <div key={n.name} className="space-y-0.5">
                            <button
                              onClick={() => {
                                setExpandedLinks(prev =>
                                  isExpanded ? prev.filter(ln => ln !== cleanName) : [...prev, cleanName]
                                );
                              }}
                              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-white/5 transition-colors ${selectedNote?.name === n.name ? 'text-indigo-300 font-semibold' : 'text-gray-300'}`}
                            >
                              <span className="text-[10px] text-gray-500">{isExpanded ? '▼' : '▶'}</span>
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">{cleanName}</span>
                            </button>
                            {isExpanded && (
                              <div className="pl-4 border-l border-white/5 ml-2.5 space-y-2 py-1">
                                {/* 発リンク */}
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-bold text-gray-500 px-2 uppercase">発リンク</div>
                                  {relations.outgoing.length === 0 ? (
                                    <div className="text-[10px] text-gray-600 px-2 italic">なし</div>
                                  ) : (
                                    relations.outgoing.map(dest => {
                                      const destNote = notes.find(note => note.name.replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase() === dest.toLowerCase());
                                      return (
                                        <button
                                          key={dest}
                                          onClick={() => {
                                            if (destNote) {
                                              openNote(destNote);
                                            } else {
                                              createWikiNote(dest);
                                            }
                                          }}
                                          className={`flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-[11px] hover:bg-white/5 transition-colors ${
                                            destNote
                                              ? 'text-indigo-300/80 hover:text-indigo-300'
                                              : 'text-red-400/60 hover:text-red-400 font-medium'
                                          }`}
                                          title={destNote ? undefined : 'クリックして新規ノートを作成'}
                                        >
                                          [[{dest}]]
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                                {/* 被リンク */}
                                <div className="space-y-0.5">
                                  <div className="text-[10px] font-bold text-gray-500 px-2 uppercase">被リンク</div>
                                  {relations.incoming.length === 0 ? (
                                    <div className="text-[10px] text-gray-600 px-2 italic">なし</div>
                                  ) : (
                                    relations.incoming.map(src => {
                                      const srcNote = notes.find(note => note.name.replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase() === src.toLowerCase());
                                      return (
                                        <button
                                          key={src}
                                          onClick={() => srcNote && openNote(srcNote)}
                                          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-[11px] text-indigo-300/80 hover:text-indigo-300 hover:bg-white/5 transition-colors"
                                        >
                                          [[{src}]]
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          ) : ribbonView === 'outline' ? (
            /* ── アウトラインパネル ── */
            <div className="flex flex-1 flex-col min-h-0">
              <div className="p-3 border-b border-white/10">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">アウトライン</h2>
                {selectedNote && (
                  <p className="mt-1 truncate text-[10px] text-indigo-300">{selectedNote.name}</p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2 min-h-0">
                {!selectedNote ? (
                  <p className="px-2 py-4 text-xs text-gray-500 text-center">ファイルを開いてください</p>
                ) : (() => {
                  const items = parseOutline(content);
                  if (items.length === 0) return (
                    <p className="px-2 py-4 text-xs text-gray-500 text-center">見出しがありません</p>
                  );
                  const headingItems = items.filter(h => h.kind === 'heading') as { kind: 'heading'; level: number; text: string; line: number }[];
                  const minLevel = headingItems.length > 0 ? Math.min(...headingItems.map(h => h.level)) : 1;
                  return (
                    <div className="space-y-0.5">
                      {items.map((item, i) => {
                        if (item.kind === 'heading') {
                          return (
                            <button
                              key={i}
                              onClick={() => scrollToHeading(item.text, item.level, item.line)}
                              className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-300 hover:bg-white/5 hover:text-indigo-300 transition-colors"
                              style={{ paddingLeft: `${(item.level - minLevel) * 12 + 8}px` }}
                            >
                              <span className="shrink-0 mt-0.5 text-[9px] text-gray-600 font-mono">H{item.level}</span>
                              <span className="truncate">{item.text}</span>
                            </button>
                          );
                        }
                        if (item.kind === 'user') {
                          return (
                            <button
                              key={i}
                              onClick={() => scrollToHeading(item.text, 0, item.line)}
                              className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-white/5 transition-colors"
                            >
                              <span className="shrink-0 mt-0.5 text-[9px] font-bold text-blue-400">U</span>
                              <span className="truncate text-blue-300">{item.text}</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={i}
                            onClick={() => scrollToHeading(item.text, 0, item.line)}
                            className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-white/5 transition-colors"
                          >
                            <span className="shrink-0 mt-0.5 text-[9px] font-bold text-emerald-400">AI</span>
                            <span className="truncate text-emerald-300">{item.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : ribbonView === 'filetree' ? (
            /* ── ファイルツリーパネル ── */
            <div className="flex flex-1 flex-col min-h-0">
              <div className="p-3 border-b border-white/10">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">ファイルツリー</h2>
                <p className="mt-0.5 text-[10px] text-gray-500">{notes.length} ファイル</p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 min-h-0">
                {(() => {
                  const tree = buildFileTree(notes);
                  const dirs = Object.keys(tree).sort();
                  return dirs.map((dir) => {
                    const dirNotes = tree[dir].slice().sort((a, b) => a.name.localeCompare(b.name));
                    const isCollapsed = collapsedDirs.has(dir);
                    if (dir === '') {
                      return (
                        <div key="root" className="space-y-0.5 mb-1">
                          {dirNotes.map((note) => (
                            <button
                              key={note.name}
                              onClick={() => openNote(note)}
                              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-white/5 ${selectedNote?.name === note.name ? 'text-indigo-300 font-medium bg-indigo-500/10' : 'text-gray-400'}`}
                            >
                              <FileText className="h-3 w-3 shrink-0 text-gray-500" />
                              <span className="truncate">{note.name.replace(/\.md$/i, '')}</span>
                            </button>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div key={dir} className="mb-1">
                        <button
                          onClick={() => setCollapsedDirs(prev => {
                            const next = new Set(prev);
                            next.has(dir) ? next.delete(dir) : next.add(dir);
                            return next;
                          })}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-300 hover:bg-white/5 transition-colors"
                        >
                          <ChevronRight className={`h-3 w-3 shrink-0 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                          {isCollapsed ? <FolderClosed className="h-3 w-3 shrink-0 text-yellow-500/70" /> : <FolderOpen className="h-3 w-3 shrink-0 text-yellow-400/80" />}
                          <span className="truncate font-medium">{dir.split('/').pop()}</span>
                          <span className="ml-auto text-[10px] text-gray-600">{dirNotes.length}</span>
                        </button>
                        {!isCollapsed && (
                          <div className="ml-4 border-l border-white/5 pl-1 space-y-0.5">
                            {dirNotes.map((note) => (
                              <button
                                key={note.name}
                                onClick={() => openNote(note)}
                                className={`flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs transition-colors hover:bg-white/5 ${selectedNote?.name === note.name ? 'text-indigo-300 font-medium bg-indigo-500/10' : 'text-gray-400'}`}
                              >
                                <FileText className="h-3 w-3 shrink-0 text-gray-500" />
                                <span className="truncate">{note.name.split('/').pop()?.replace(/\.md$/i, '')}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : (
            <>
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
                <button
                  className="flex w-full items-center justify-center gap-2 rounded bg-emerald-900/60 border border-emerald-700/40 px-3 py-2 font-semibold hover:bg-emerald-800/60 transition-colors text-sm text-emerald-300"
                  onClick={() => setShowMocModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  🗺 MOC作成
                </button>
                <div className="relative flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2">
                  <Search className="h-4 w-4 text-gray-500" />
                  <input
                    className="w-full bg-transparent text-sm outline-none"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggest(true);
                      setSuggestIndex(-1);
                    }}
                    onFocus={() => setShowSuggest(true)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (showSuggest && suggestions.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSuggestIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSuggestIndex(prev => Math.max(prev - 1, -1));
                        } else if (e.key === 'Enter') {
                          if (suggestIndex >= 0) {
                            e.preventDefault();
                            selectSuggestion(suggestions[suggestIndex]);
                          }
                        } else if (e.key === 'Escape') {
                          setShowSuggest(false);
                          setSuggestIndex(-1);
                        }
                      }
                    }}
                    placeholder="検索 (tag:タグ名, link:ノート名)"
                  />
                  {showSuggest && suggestions.length > 0 && (
                    <ul 
                      className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded border border-white/10 bg-[#0c1222] py-1 shadow-xl top-full"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {suggestions.map((s, idx) => (
                        <li
                          key={idx}
                          onClick={() => selectSuggestion(s)}
                          className={`cursor-pointer px-3 py-1.5 text-xs transition-colors ${
                            idx === suggestIndex ? 'bg-indigo-600 text-white' : 'hover:bg-white/5 text-gray-300'
                          }`}
                        >
                          {s.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {privateMode && (
                  <div className="mb-2 flex items-center justify-between rounded bg-emerald-900/30 px-2 py-1.5 text-xs text-emerald-300">
                    <span>🔑 プライベート保管庫を表示中</span>
                    <button onClick={handleVaultLock} className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-emerald-500/30">ロックして戻る</button>
                  </div>
                )}
                <div className="flex items-center justify-between border-b border-white/5 pb-2 text-xs text-gray-400 px-1">
                  <span className="text-gray-500">{filteredNotes.length}<span className="text-gray-600">/{notes.length}件</span></span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="rounded border border-white/10 bg-[#0f172a] px-2 py-1 outline-none text-gray-200"
                  >
                    <option value="date-desc">作成日新しい順</option>
                    <option value="date-asc">作成日古い順</option>
                    <option value="name-asc">名前順 (A-Z)</option>
                    <option value="name-desc">名前逆順 (Z-A)</option>
                  </select>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {isLoading ? (
                  <div className="p-4 text-sm text-gray-400">読み込み中...</div>
                ) : (
                  filteredNotes.map((note) => {
                    const empty = note.isEmpty ?? false;
                    return (
                      <button
                        key={note.name}
                        className={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-white/10 ${
                          selectedNote?.name === note.name
                            ? 'bg-indigo-500/20 text-indigo-100'
                            : empty
                            ? 'text-yellow-300/80'
                            : 'text-gray-300'
                        }`}
                        onClick={() => openNote(note)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, note });
                        }}
                      >
                        <FileText className={`h-4 w-4 shrink-0 ${empty && selectedNote?.name !== note.name ? 'text-yellow-400' : ''}`} />
                        <span className="truncate">{note.name.replace(/^.*\//, '').replace(/\.md$/i, '')}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
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
              {editMode === 'edit' && (
                <button
                  className="rounded px-2 py-1 text-xs font-bold font-mono text-gray-400 hover:bg-white/10 hover:text-gray-100 disabled:opacity-40"
                  onClick={wrapSelectionWithWikiLink}
                  disabled={!selectedNote}
                  title="選択テキストをWikiリンク化 (Ctrl+L / [)"
                >
                  [[ ]]
                </button>
              )}
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

          {/* ノート情報ヘッダー (日付とタグ) */}
          {selectedNote && (
            <div className="border-b border-white/5 bg-[#090d19]/30 px-6 py-3">
              {/* 日付の表示 */}
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="font-semibold text-gray-500">作成日付:</span>
                {(() => {
                  const match = content.match(/作成日時\s*[:：]\s*([^\n\r]+)/);
                  if (match) {
                    return match[1].trim();
                  }
                  return new Date(selectedNote.updatedAt).toLocaleString();
                })()}
              </div>

              {/* タグ表示 & 追加UI (日付の下) */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(selectedNote.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-500/20"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 text-emerald-400/60 hover:text-red-400 transition-colors"
                      title="タグを削除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                
                {/* タグ追加フォーム */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddTag(newTagInput);
                  }}
                  className="flex items-center"
                >
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    placeholder="タグを追加"
                    className="h-6 w-24 rounded border border-white/10 bg-black/20 px-2 text-xs text-gray-200 outline-none focus:border-indigo-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                    className="ml-1 flex h-6 w-6 items-center justify-center rounded bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 transition-colors"
                    title="追加"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* エディタ本体 */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedNote ? (
              editMode === 'edit' ? (
                <textarea
                  ref={editorRef}
                  className="h-full w-full resize-none bg-[#090d19] p-5 font-mono text-sm leading-7 text-gray-100 outline-none cursor-text"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  spellCheck={false}
                />
              ) : (
                <div
                  ref={previewDivRef}
                  className="markdown-preview h-full overflow-y-auto p-6"
                  onContextMenu={handlePreviewContextMenu}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code: ({ children, className }) => {
                        if (!className) {
                          const s = String(children).trim();
                          if (s === USER_HR_CODE) return <hr style={{ border: 'none', borderTop: '1.5px solid #378ADD', opacity: 0.5, margin: '12px 0' }} />;
                          if (s === AI_HR_CODE)   return <hr style={{ border: 'none', borderTop: '1.5px solid #1D9E75', opacity: 0.5, margin: '12px 0' }} />;
                        }
                        return <code className={className}>{children}</code>;
                      },
                      a: (props) => {
                        const { href, children } = props;
                        if (href && href.startsWith('#wiki-')) {
                          const noteName = decodeURIComponent(href.replace('#wiki-', ''));
                          const displayText = children?.toString() || noteName;
                          return (
                            <span
                              className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleWikiLinkClick(noteName);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setWikiLinkContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  noteName,
                                  displayText,
                                });
                              }}
                            >
                              {children}
                            </span>
                          );
                        }
                        return (
                          <a
                            href={href}
                            className="text-blue-400 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      }
                    }}
                  >
                    {preprocessContent(content)}
                  </ReactMarkdown>
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
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => {
                        const { href, children } = props;
                        if (href && href.startsWith('#wiki-')) {
                          const noteName = decodeURIComponent(href.replace('#wiki-', ''));
                          return (
                            <span
                              className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleWikiLinkClick(noteName);
                              }}
                            >
                              {children}
                            </span>
                          );
                        }
                        return (
                          <a
                            href={href}
                            className="text-blue-400 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      }
                    }}
                  >
                    {preprocessContent(streamedText)}
                  </ReactMarkdown>
                </div>
              )}

              {/* プロンプト追加確認UI */}
              {pendingPrompt && (
                <div className="mb-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3.5 text-sm">
                  <div className="font-semibold text-indigo-300">✨ 新しいカスタムプロンプトを追加しますか？</div>
                  <div className="mt-1 text-xs text-gray-300">名前: {pendingPrompt.name}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await scanAndRegisterPrompts('', [pendingPrompt]);
                        setPendingPrompt(null);
                      }}
                      className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
                    >
                      はい (追加する)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingPrompt(null)}
                      className="rounded bg-gray-800 border border-white/10 px-3 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-700 transition-colors"
                    >
                      いいえ (チャットで調整する)
                    </button>
                  </div>
                </div>
              )}

              {/* 設定ドロップダウン（入力欄の上） */}
              <div className="mb-3 flex items-center gap-2">
                <select
                  className="rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                  value={chatMode}
                  onChange={(e) => setChatMode(e.target.value)}
                >
                  <option value="deep-think">思考整理</option>
                  <option value="markdown-struct">ノート作成</option>
                  <option value="long-explain">長文詳細説明</option>
                  <option value="prompt-gen">プロンプト作成</option>
                  <option value="long-doc">長文解析</option>
                  {(config.customPrompts || []).map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      {cp.name}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                  value={aiModelMode}
                  onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
                >
                  <option value="flash-lite">Flash Lite</option>
                  <option value="flash">Flash</option>
                  <option value="pro">Pro</option>
                </select>
                {autoSaveStatus !== 'idle' && (
                  <span className="ml-auto flex items-center text-xs text-gray-500">
                    {autoSaveStatus === 'saving' ? '保存中...' : '✓ 自動保存しました'}
                  </span>
                )}
              </div>

              {/* AIクイックアクション */}
              {selectedNote && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => sendChat(selectedNote.name.replace(/\.md$/i, ''))}
                    className="flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-40 transition-colors"
                  >
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    タイトルから生成
                  </button>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => handlePcAiAction('tags')}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                  >
                    <Tag className="h-3.5 w-3.5 text-emerald-400" />
                    タグ生成
                  </button>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => handlePcAiAction('summary')}
                    className="flex items-center gap-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors"
                  >
                    <ListTree className="h-3.5 w-3.5 text-indigo-400" />
                    要約
                  </button>
                </div>
              )}

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

            {/* 暗号化保管庫セクション */}
            <div className="mb-5 border-t border-white/10 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">🔒 暗号化保管庫（private/）</h3>
              {!vaultExists ? (
                <button
                  type="button"
                  onClick={() => { setVaultPwInput(''); setVaultPwInput2(''); setVaultError(''); setShowVaultSetup(true); }}
                  className="w-full rounded bg-indigo-600/30 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/50 transition-colors"
                >
                  保管庫を作成（パスワード設定）
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={vaultUnlocked ? 'text-emerald-400' : 'text-gray-400'}>
                      状態: {vaultUnlocked ? '🔓 ロック解除中' : '🔒 ロック中'}
                    </span>
                    {vaultUnlocked ? (
                      <button type="button" onClick={handleVaultLock} className="ml-auto rounded bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/30">今すぐロック</button>
                    ) : (
                      <button type="button" onClick={() => { setVaultPwInput(''); setVaultError(''); setShowVaultUnlock(true); }} className="ml-auto rounded bg-indigo-500/20 px-3 py-1 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-500/30">ロック解除</button>
                    )}
                  </div>
                  <label className="block text-xs">
                    <span className="mb-1 block text-gray-400">自動ロック時間（分・0で無効）</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded bg-black/30 px-3 py-1.5 outline-none text-gray-200"
                      value={config.vaultAutoLockMinutes ?? 15}
                      onChange={(e) => setConfig((prev) => ({ ...prev, vaultAutoLockMinutes: Number(e.target.value) }))}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* カスタムプロンプトセクション */}
            <div className="mb-5 border-t border-white/10 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">■ カスタムプロンプト</h3>
              
              {/* 登録済みリスト */}
              <div className="mb-4 max-h-36 overflow-y-auto rounded border border-white/10 bg-black/25 p-2 text-xs">
                {(config.customPrompts || []).length === 0 ? (
                  <div className="py-2 text-center text-gray-500">登録されたカスタムプロンプトはありません</div>
                ) : (
                  (config.customPrompts || []).map((cp) => (
                    <div key={cp.id} className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-semibold text-gray-200 truncate">{cp.name}</div>
                        <div className="text-gray-400 truncate mt-0.5">{cp.prompt}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomPrompt(cp.id)}
                        className="rounded bg-red-500/20 px-2 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/30 transition-colors shrink-0"
                      >
                        削除
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* 手動追加フォーム */}
              <div className="space-y-3 rounded border border-white/5 bg-white/5 p-3">
                <div className="text-xs font-semibold text-indigo-300">新規追加 (手動)</div>
                <label className="block text-xs">
                  <span className="mb-1 block text-gray-400">プロンプト名</span>
                  <input
                    className="w-full rounded bg-black/30 px-3 py-1.5 outline-none text-gray-200"
                    placeholder="例: 翻訳アシスタント"
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-gray-400">指示 (システムプロンプト)</span>
                  <textarea
                    className="w-full h-16 rounded bg-black/30 px-3 py-1.5 outline-none text-gray-200 resize-none"
                    placeholder="AIに対する具体的な指示テキスト..."
                    value={newPromptText}
                    onChange={(e) => setNewPromptText(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleAddCustomPrompt(newPromptName, newPromptText)}
                  className="w-full rounded bg-indigo-600/30 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/50 transition-colors"
                >
                  プロンプトを追加
                </button>
              </div>
            </div>

            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">保存</button>
          </form>
        </div>
      )}

      {/* MOC作成モーダル */}
      {showMocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form className="w-full max-w-md rounded-lg border border-emerald-800/40 bg-[#101827] p-5 shadow-xl" onSubmit={createMocFromModal}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-emerald-300">🗺 MOC作成</h2>
              <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => { setShowMocModal(false); setMocTitle(''); setMocAiMode(false); }}>✕</button>
            </div>
            <label className="mb-3 block text-sm text-gray-300">
              MOCのタイトル
              <input
                autoFocus
                className="mt-1 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-white outline-none"
                value={mocTitle}
                onChange={(e) => setMocTitle(e.target.value)}
                placeholder="例: 開発ノートまとめ"
              />
            </label>
            <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="rounded"
                checked={mocAiMode}
                onChange={(e) => setMocAiMode(e.target.checked)}
              />
              <span>AIで自動生成する（既存ノートを分析してリンクを作成）</span>
            </label>
            {mocAiMode && (
              <p className="mb-4 rounded bg-emerald-900/30 px-3 py-2 text-xs text-emerald-400">
                最大80件のノートをGeminiで分析し、テーマ別にグループ化したMOCを自動生成します。
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={isMocGenerating || !mocTitle.trim()}
                className="flex-1 rounded bg-emerald-700 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {isMocGenerating ? 'AI生成中...' : 'MOCを作成'}
              </button>
              <button type="button" className="rounded border border-white/10 px-4 py-2 text-sm text-gray-400 hover:bg-white/5" onClick={() => { setShowMocModal(false); setMocTitle(''); setMocAiMode(false); }}>
                キャンセル
              </button>
            </div>
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
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-gray-300">ノート名</span>
              <input
                className="w-full rounded bg-black/30 px-3 py-2 outline-none"
                value={newNoteName}
                onChange={(e) => setNewNoteName(e.target.value)}
                autoFocus
              />
            </label>

            {privateMode && (
              <p className="mb-5 rounded bg-emerald-900/30 px-3 py-2 text-xs text-emerald-300">
                🔑 プライベート保管庫に暗号化して保存されます
              </p>
            )}

            {isAiNoteMode && (
              <div className="mb-5 block text-sm">
                <span className="mb-2 block text-gray-300">AI設定</span>
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                    value={chatMode}
                    onChange={(e) => setChatMode(e.target.value)}
                  >
                    <option value="deep-think">思考整理</option>
                    <option value="markdown-struct">ノート作成</option>
                    <option value="long-explain">長文詳細説明</option>
                    <option value="prompt-gen">プロンプト作成</option>
                    <option value="long-doc">長文解析</option>
                    {(config.customPrompts || []).map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="flex-1 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-gray-300 outline-none hover:bg-black/60 transition-colors"
                    value={aiModelMode}
                    onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
                  >
                    <option value="flash-lite">Flash Lite</option>
                    <option value="flash">Flash</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>
              </div>
            )}

            <button className="w-full rounded bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400">作成</button>
          </form>
        </div>
      )}

      {/* 保管庫ロック解除ダイアログ */}
      {showVaultUnlock && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">🔒 保管庫のロック解除</h2>
            <p className="mb-4 text-xs text-gray-400">パスワードを入力してください（このセッション中は再入力不要）</p>
            <input
              type="password"
              className="mb-2 w-full rounded bg-black/30 px-3 py-2 outline-none"
              value={vaultPwInput}
              onChange={(e) => setVaultPwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVaultUnlock(); }}
              autoFocus
            />
            {vaultError && <p className="mb-2 text-xs text-red-400">{vaultError}</p>}
            <div className="flex gap-3">
              <button onClick={handleVaultUnlock} className="flex-1 rounded bg-indigo-500 py-2 text-sm font-semibold hover:bg-indigo-400">解除</button>
              <button onClick={() => { setShowVaultUnlock(false); setPendingPrivateNote(null); setVaultPwInput(''); }} className="rounded border border-white/10 px-4 py-2 text-sm text-gray-400 hover:bg-white/5">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 保管庫の新規作成（パスワード設定）ダイアログ */}
      {showVaultSetup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl">
            <h2 className="mb-1 text-lg font-semibold">🔒 保管庫を作成</h2>
            <p className="mb-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">
              ⚠️ パスワードを忘れると中身は<strong>二度と復元できません</strong>。必ず安全な場所に控えてください。
            </p>
            <input
              type="password"
              placeholder="パスワード（4文字以上）"
              className="mb-2 w-full rounded bg-black/30 px-3 py-2 outline-none"
              value={vaultPwInput}
              onChange={(e) => setVaultPwInput(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              placeholder="パスワード（確認）"
              className="mb-2 w-full rounded bg-black/30 px-3 py-2 outline-none"
              value={vaultPwInput2}
              onChange={(e) => setVaultPwInput2(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVaultSetup(); }}
            />
            {vaultError && <p className="mb-2 text-xs text-red-400">{vaultError}</p>}
            <div className="flex gap-3">
              <button onClick={handleVaultSetup} className="flex-1 rounded bg-indigo-500 py-2 text-sm font-semibold hover:bg-indigo-400">作成</button>
              <button onClick={() => { setShowVaultSetup(false); setVaultPwInput(''); setVaultPwInput2(''); setVaultError(''); }} className="rounded border border-white/10 px-4 py-2 text-sm text-gray-400 hover:bg-white/5">キャンセル</button>
            </div>
          </div>
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

      {/* プレビュー用右クリックコンテキストメニュー（吹き出し） */}
      {previewContextMenu && (
        <div
          className="fixed z-[100] rounded border border-indigo-500/30 bg-[#111625] px-2 py-1 shadow-2xl transition-all"
          style={{ top: `${previewContextMenu.y - 40}px`, left: `${previewContextMenu.x}px`, transform: 'translateX(-50%)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex items-center rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors whitespace-nowrap"
            onClick={handleWrapPreviewSelection}
          >
            Wikiリンク化する
          </button>
        </div>
      )}

      {/* Wikiリンク用右クリックメニュー（リンクをやめる） */}
      {wikiLinkContextMenu && (
        <div
          className="fixed z-[100] min-w-[120px] rounded border border-white/10 bg-[#111625] py-1 shadow-2xl editor-context-menu"
          style={{ top: `${wikiLinkContextMenu.y}px`, left: `${wikiLinkContextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center px-4 py-2 text-left text-xs text-gray-200 hover:bg-indigo-500/20 hover:text-indigo-300 transition-colors"
            onClick={handleRemoveWikiLink}
          >
            リンクをやめる
          </button>
          <button
            className="flex w-full items-center px-4 py-2 text-left text-xs text-gray-400 hover:bg-white/5 transition-colors border-t border-white/5"
            onClick={() => setWikiLinkContextMenu(null)}
          >
            キャンセル
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
