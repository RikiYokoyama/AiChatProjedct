import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Plus, 
  Settings, 
  Send, 
  RefreshCw, 
  Sparkles, 
  BrainCircuit, 
  Eye, 
  Edit3,
  AlertTriangle,
  FileText,
  Save,
  Check,
  Search,
  X,
  MessageSquare,
  Folder,
  Network
} from 'lucide-react';
import { GeminiClient, ChatMessage, ChatMode, AiSpeedMode, AiModelMode } from './lib/gemini';
import GraphView from './GraphView';

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

export default function App() {
  // 状態管理
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview');

  const [searchQuery, setSearchQuery] = useState('');
  const [visibleNotesCount, setVisibleNotesCount] = useState(100);
  
  // 検索クエリが変化したときに表示数を初期値に戻す
  useEffect(() => {
    setVisibleNotesCount(100);
  }, [searchQuery]);
  
  // 検索絞り込みロジック (タイトルにキーワ
  const [chatMode, setChatMode] = useState<ChatMode>('deep-think');
  const [aiSpeedMode, setAiSpeedMode] = useState<AiSpeedMode>('fast');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash-lite');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Git同期ステータス: 'idle' | 'syncing' | 'success' | 'error'
  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitError, setGitError] = useState<string | null>(null);

  // 設定用
  const [config, setConfig] = useState<AppConfig>({
    geminiApiKey: '',
    notesPath: '',
    gitRemoteUrl: '',
    autoSync: true
  });
  const [showSettings, setShowSettings] = useState(false);

  const [showSettings, setShowSettings] = useState(false);

  // ファイル名入力モーダル用
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameModalInput, setNameModalInput] = useState('');
  const [nameModalMode, setNameModalMode] = useState<'new' | 'rename'>('new');
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
  const [showSettings, setShowSettings] = useState(false);

  // ファイル名入力モーダル用
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameModalInput, setNameModalInput] = useState('');
  const [nameModalMode, setNameModalMode] = useState<'new' | 'rename'>('new');

  // UIレイアウト制御状態
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 左サイドバーノート項目の右クリックメニュー表示用
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    note: Note | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    note: null
    x: number;
    y: number;
    note: Note | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    note: null
  });

  // 画面のどこかをクリックしたらサイドバーの右クリックメニューを閉じる
  useEffect(() => {
    const handleCloseMenu = () => {
      setSidebarContextMenu(prev => {
        if (prev.visible) return { ...prev, visible: false };
        return prev;
      });
    };
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  // 初期ロードとリスナー設定
  useEffect(() => {
    // 設定ロード
    window.electronAPI.loadConfig().then(cfg => {
      setConfig(cfg);
      if (!cfg.geminiApiKey) {
        setShowSettings(true); // 最初は設定を開かせる
      }
    });

    // ノート一覧取得
    loadNotesList();

    // Gitステータス通知受信
    const unsubscribe = window.electronAPI.onGitStatusChanged((status, error) => {
      setGitStatus(status);
      if (error) {
        setGitError(error);
      } else {
        setGitError(null);
      }
      loadNotesList(); // リストを再ロード
    });

    return () => {
      unsubscribe();
    };
  }, []);

    setEditMode('preview');
  };

  // 設定の保存
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await window.electronAPI.saveConfig(config);
    if (res.success) {
      setShowSettings(false);
      loadNotesList();
    } else {
      alert(`設定の保存に失敗しました: ${res.error}`);
    }
  };

  // 保存先フォルダのダイアログ選択
  const handleSelectDirectory = async () => {
    const selectedPath = await window.electronAPI.openDirectoryDialog();
    if (selectedPath) {
      setConfig({ ...config, notesPath: selectedPath });
    }
  };

  // 手動Git同期
  const handleManualSync = async () => {
    setGitStatus('syncing');
    setGitError(null);
    const res = await window.electronAPI.syncGit();
    if (!res.success) {
      setGitStatus('error');
      setGitError(res.error || '不明なエラー');
    } else {
      setGitStatus('success');
    }
    loadNotesList();
  };
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }

        isRightDragging = true;
        hasMoved = false;
        startX = e.screenX;
        startY = e.screenY;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isRightDragging) return;

      const deltaX = e.screenX - startX;
      const deltaY = e.screenY - startY;

      // わずかなブレを検知（移動量が2ピクセル以上あれば移動開始）
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        hasMoved = true;
      }

      if (hasMoved) {
        startX = e.screenX;
        startY = e.screenY;
        window.electronAPI.windowMoving({ deltaX, deltaY });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        isRightDragging = false;
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      // 右ボタンをドラッグ移動した場合は、右クリックメニュー（コンテキストメニュー）をキャンセルする
      if (hasMoved) {
        e.preventDefault();
        hasMoved = false;
      }
    };

    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    };
  }, []);

  // ノート一覧のロード
  const loadNotesList = async () => {
    const list = await window.electronAPI.listNotes();
    setNotes(list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  };

  const sanitizeFilename = (title: string) => {
    return title.replace(/[\\/:*?"<>|#]/g, '').trim();
  };

    try {
      const client = new GeminiClient(config.geminiApiKey);
      
      await client.chatStream(
        updatedHistory,
        chatMode,
        updatedAt: new Date().toISOString()
      });
    } else {
      console.error(`ノートの保存に失敗しました: ${res.error}`);
    }
    
    // すでに同じ名前のノートがある場合はそれを選択して編集画面へ
    const existing = notes.find(note => note.name.toLowerCase() === `${defaultTitle}.md`.toLowerCase());
    if (existing) {
      handleSelectNote(existing);
      setViewMode('editor');
      return;
    }

    const newNoteContent = `---\ndate: ${dateStr}\n---\n# ${defaultTitle}\n\n`;
    
    // 保存を実行
    await window.electronAPI.saveNote({
      filename: `${defaultTitle}.md`,
      content: newNoteContent
    });
    
    await loadNotesList();
    
    const newNote = {
      name: `${defaultTitle}.md`,
      path: '',
      updatedAt: now.toISOString(),
      content: newNoteContent
    };
    handleSelectNote(newNote);
    setViewMode('editor');
  };

  // [[サジェストのキー操作および入力判定
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const selectionStart = e.target.selectionStart;
            firstUserMsg.split('\n')[0].slice(0, 40).trim() ||
            'AI-Chat';

          // 全会話履歴からMarkdownを構築
          const now = new Date();
          let md = `---\ndate: ${now.toISOString().split('T')[0]}\ntags: [AI-Chat]\n---\n# ${autoTitle}\n\n## 対話ログ\n`;
          newHistory.forEach(msg => {
            const roleName = msg.role === 'user' ? '👤 ユーザー' : '🤖 Gemini';
            md += `\n### ${roleName}\n\n${msg.content}\n`;
          });

          // ステートを更新
          setNoteTitle(autoTitle);
          setNoteBody(md);

          // 同じファイル名で保存（追加会話も同じファイルに上書き）
          await handleSaveNote(autoTitle, md);
        },
        (err) => {
          // エラーメッセージをチャット履歴に表示（alertではなくインライン表示）
          const errorMsg: ChatMessage = {
            role: 'model',
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertSuggestion(suggestions[suggestionIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

  const insertSuggestion = (selectedName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = noteBody;
    const startPos = suggestionCursorPos; // "[[" の開始位置
    const selectionStart = textarea.selectionStart;

    const before = value.slice(0, startPos);
    const after = value.slice(selectionStart);
    const inserted = `[[${selectedName}]]`;
    const newValue = before + inserted + after;

    setNoteBody(newValue);
    setShowSuggestions(false);

    const newCursorPos = startPos + inserted.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  // プレビュー用のWikiリンク一時置換ヘルパー
  const parseWikiLinksForPreview = (text: string) => {
    return text.replace(/\[\[(.*?)\]\]/g, (match, rawLink) => {
      if (!rawLink) return match;
      const parts = rawLink.split('|');
      const targetRaw = parts[0].trim();
      const cleanTarget = targetRaw.split('#')[0].split('^')[0].trim();
      const alias = parts[1] ? parts[1].trim() : targetRaw;
      return `[${alias}](note-link:${encodeURIComponent(cleanTarget)})`;
    });
  };

  const parseCalloutsForPreview = (text: string) => {
    if (!text) return '';
    return text.replace(/^(?![ \t]*>)(?:[ \t]*)(!?\[!(question|help|info|note|gemini|success|done|warning|caution|summary|quote|abstract)\])/gm, '> $1');
  };

  interface ParsedYaml {
    tags?: string[];
    date?: string;
    [key: string]: any;
  }

  const parseFrontmatter = (content: string): { frontmatter: ParsedYaml | null; bodyWithoutFm: string } => {
    const match = content.match(/^---([\s\S]*?)---/);
    if (!match) {
      return { frontmatter: null, bodyWithoutFm: content };
    }
    
    const yamlText = match[1];
    const bodyWithoutFm = content.slice(match[0].length);
    const result: ParsedYaml = {};
    
    const lines = yamlText.split('\n');
    let currentKey: string | null = null;
    
    lines.forEach(line => {
              return chunk;
            }
            return prev + chunk;
          });
        },
        async (fullText) => {
          const newHistory: ChatMessage[] = [...updatedHistory, { role: 'model', content: fullText }];
          setChatHistory(newHistory);
          setStreamedText('');
              return chunk;
            }
            return prev + chunk;
          });
        },
        async (fullText) => {
          const newHistory: ChatMessage[] = [...updatedHistory, { role: 'model', content: fullText }];
          setChatHistory(newHistory);
          setStreamedText('');
          setIsGenerating(false);

          // タイトル決定（既存タイトルがあるか、なければ最初のメッセージから自動決定）
          const firstUserMsg = newHistory.find(m => m.role === 'user')?.content || '';
          const autoTitle = noteTitle ||
            firstUserMsg.split('\n')[0].slice(0, 40).trim() ||
            'AI-Chat';

          // 新しい追記用Markdownテキストを構築
          const now = new Date();
          const dateStr = now.toISOString().split('T')[0];
          
          let updatedMd = '';
          const hasExistingContent = noteBody && noteBody.trim().length > 0;

          if (hasExistingContent) {
            // すでに内容がある場合は、手動で修正された現行のnoteBodyの末尾に「追記」する
            // 適切な改行コードを追加
            updatedMd = noteBody.trimEnd();
            updatedMd += `\n\n### 👤 ユーザー (追加対話)\n\n${userMsg.content}\n\n### 🤖 Gemini\n\n${fullText}\n`;
          } else {
            // 新規ノート等で空の場合は、ヘッダー（フロントマター等）を含めて一から作成
            updatedMd = `---\ndate: ${dateStr}\ntags: [AI-Chat]\n---\n# ${autoTitle}\n\n## 対話ログ\n\n### 👤 ユーザー\n\n${userMsg.content}\n\n### 🤖 Gemini\n\n${fullText}\n`;
          }

          // ステートを更新
          setNoteTitle(autoTitle);
          setNoteBody(updatedMd);

          // 保存
          await handleSaveNote(autoTitle, updatedMd);
        },
        (err) => {
          // エラーメッセージをチャット履歴に表示（alertではなくインライン表示）
          const errorMsg: ChatMessage = {
            role: 'model',
            content: `⚠️ **エラーが発生しました**\n\n${err.message || '通信エラーが発生しました。'}\n\nもう一度メッセージを送信してください。`
          };
          setChatHistory([...updatedHistory, errorMsg]);
          setStreamedText('');
          setIsGenerating(false);
    } else {
      alert(`リネームに失敗しました: ${res.error}`);
    }
  };

  const handleSaveNote = async (title: string, body: string) => {
    const filenameBase = sanitizeFilename(title) || 'Untitled';
    const filename = `${filenameBase}.md`;
    const res = await window.electronAPI.saveNote({
      filename,
      content: body
    });
    if (res.success) {
      loadNotesList();
      setSelectedNote({
        name: filename,
        content: body,
        path: res.path || '',
        updatedAt: new Date().toISOString()
      });
    } else {
      console.error(`ノートの保存に失敗しました: ${res.error}`);
    }
  };

  // AIとの対話送信
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || isGenerating) return;
    
    const originalInput = chatInput;
    const userMsg: ChatMessage = { role: 'user', content: originalInput };
          <div className="flex flex-col items-center space-y-4 w-full">
            {/* ノートリストトグル */}
            <button
              onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
              className={`p-3 rounded-xl transition-all duration-200 group relative ${
                isLeftSidebarOpen 
                  ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
              title="ノート一覧をトグル"
            >
              <Folder className="w-5 h-5" />
              {/* ツールチップ */}
              <span className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 text-gray-200 text-[10px] font-semibold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-40">
                ノート一覧
              </span>
            </button>

            {/* AIチャットトグル */}
            <button
              onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
              className={`p-3 rounded-xl transition-all duration-200 group relative ${
                isRightSidebarOpen 
                  ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-500/20' 
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
              title="AIチャットをトグル"
            >
              <MessageSquare className="w-5 h-5" />
              {/* ツールチップ */}
              <span className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 text-gray-200 text-[10px] font-semibold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-40">
                AIチャット
              </span>
            </button>
          </div>

          {/* 下部グループ */}
          <div className="flex flex-col items-center space-y-4 w-full">
            {/* Git同期の簡易ステータス表示 & 手動同期クリック */}
            <button
              onClick={handleGitSync}
              disabled={gitStatus === 'syncing'}
              className={`p-3 rounded-xl transition-all duration-200 group relative ${
                gitStatus === 'syncing'
                  ? 'text-amber-400'
                  : gitStatus === 'success'
                  ? 'text-emerald-400'
                  : gitStatus === 'error'
                  ? 'text-red-400'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
              title="GitHub同期"
            >
              <RefreshCw className={`w-5 h-5 ${gitStatus === 'syncing' ? 'animate-spin' : ''}`} />
              <span className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 text-gray-200 text-[10px] font-semibold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-40">
                GitHub同期 ({gitStatus === 'syncing' ? '同期中...' : gitStatus === 'success' ? '最新' : gitStatus === 'error' ? 'エラー' : '待機中'})
              </span>
            </button>
          </div>
          
          <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="autoSync"
                  checked={config.autoSync}
                  onChange={(e) => setConfig({ ...config, autoSync: e.target.checked })}
                  className="bg-bgInput border border-gray-800 rounded text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <label htmlFor="autoSync" className="text-xs font-semibold text-gray-300">保存時にGitHubと自動同期する</label>
              </div>

              {gitError && (
                <div className="flex items-start space-x-1.5 p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-all">{gitError}</span>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4 border-t border-gray-800/60">
                {config.geminiApiKey && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs transition"
                  >
                    キャンセル
                  </button>
              <div className="text-[10px] text-gray-500">
                {gitStatus === 'syncing' ? '同期中...' :
                 gitStatus === 'success' ? '最新状態' :
                 gitStatus === 'error' ? 'エラー発生' : '待機中'}
              </div>
            </div>
          </div>
          <button 
            onClick={handleManualSync}
            disabled={gitStatus === 'syncing'}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition disabled:opacity-40"
            title="手動Git同期"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gitStatus === 'syncing' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </aside>

      {/* 2. メインエリア: 閲覧・編集エディタ */}
                )}
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition shadow-md shadow-indigo-600/10"
                >
                  設定を保存
                </button>
              </div>
            </form>
          </div>
        </div>
      
      // 更新後の保存
      await window.electronAPI.saveNote({
        filename: `${sanitized}.md`,
        content: updatedBody
      });

      setSelectedNote(newNote);
      await loadNotesList();
    } else {
      alert(`リネームに失敗しました: ${res.error}`);
    }
  };

  const handleSaveNote = async (title: string, body: string) => {
    const filenameBase = sanitizeFilename(title) || 'Untitled';
    const filename = `${filenameBase}.md`;
    const res = await window.electronAPI.saveNote({
      filename,
      content: body
    });
    if (res.success) {
      loadNotesList();
      setSelectedNote({
        name: filename,
        content: body,
        path: res.path || '',
        updatedAt: new Date().toISOString()
      });
    } else {
      console.error(`ノートの保存に失敗しました: ${res.error}`);
    }
  };
  const handleDeleteNote = async (note: Note) => {
    const res = await window.electronAPI.deleteNote(note.name);
    if (res.success) {
      if (selectedNote?.name === note.name) {
        setSelectedNote(null);
        setNoteTitle('');
        setNoteBody('');
        setChatHistory([]);
                </div>
              </div>

              <div>
              <div className="text-[10px] text-gray-500">
                {gitStatus === 'syncing' ? '同期中...' :
                 gitStatus === 'success' ? '最新状態' :
                 gitStatus === 'error' ? 'エラー発生' : '待機中'}
              </div>
            </div>
          </div>
          <button 
            onClick={handleManualSync}
            disabled={gitStatus === 'syncing'}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition disabled:opacity-40"
            title="手動Git同期"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gitStatus === 'syncing' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </aside>

      {/* 2. メインエリア: 閲覧・編集エディタ */}
      <main className="flex-1 flex flex-col h-full bg-[#070a13]">
        {/* 上部ヘッダー */}

              {gitError && (
                <div className="flex items-start space-x-1.5 p-3 rounded-lg bg-red-950/20 border border-red-500/20 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            </div>
          </div>
          <button 
            onClick={handleManualSync}
            disabled={gitStatus === 'syncing'}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition disabled:opacity-40"
            title="手動Git同期"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gitStatus === 'syncing' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </aside>
      )}

      {/* 2. メインエリア: 閲覧・編集エディタ */}
      <main className="flex-1 flex flex-col h-full bg-[#070a13]">
        {/* 上部ヘッダー */}
        <div className="h-14 border-b border-gray-800/60 flex items-center justify-between px-6">
          <div className="flex items-center space-x-3">
            {selectedNote ? (
              <div className="flex items-center space-x-2">
                <h2 className="font-semibold text-lg max-w-xs truncate text-gray-100">
                  {noteTitle}
                </h2>
                <button
                  onClick={() => {
                    setNameModalInput(noteTitle);
                    setNameModalMode('rename');
                    setShowNameModal(true);
                    setTimeout(() => nameInputRef.current?.focus(), 100);
                  }}
                  className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200"
                  title="ノート名の変更"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-gray-400 text-sm">ノート未選択</span>
            )}
          </div>
        </div>

        {/* AIチャットサイドパネル */}
        {showChatPanel && (
          <aside className="w-96 glass-panel border-l border-gray-800 flex flex-col h-full shrink-0 bg-bgCard/40">
            <div className="h-14 border-b border-gray-800/60 flex items-center justify-between px-4 bg-bgCard/60">
              <div className="flex items-center space-x-1.5 text-indigo-400 font-semibold text-sm">
                <BrainCircuit className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>
              {aiModelMode === 'flash-lite' ? 'Gemini Flash-Lite' :
               aiModelMode === 'flash-3-5' ? 'Gemini 3.5 Flash' :
               'Gemini Flash'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex bg-bgInput p-0.5 rounded-lg border border-gray-800" title="AIの速度切替">
                  <button
                    type="button"
                    onClick={() => setAiSpeedMode('thinking')}
                    className={`px-2 py-1 text-xs rounded-md font-medium transition ${
                      aiSpeedMode === 'thinking' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    思考
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiSpeedMode('fast')}
                    className={`px-2 py-1 text-xs rounded-md font-medium transition ${
                      aiSpeedMode === 'fast' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    高速
                  </button>
                </div>
                
                <select
                  value={aiModelMode}
                  onChange={(e) => setAiModelMode(e.target.value as any)}
                  className="bg-[#0b0f19] text-xs text-gray-300 border border-gray-800 rounded-lg px-2 py-1 outline-none focus:border-indigo-500 transition"
                >
                  <option value="flash-lite">Gemini 2.5 Flash-Lite</option>
                  <option value="flash">Gemini 2.5 Flash</option>
                  <option value="flash-3-5">Gemini 3.5 Flash</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">



                // 本文中のハッシュタグを最大3個集める
                const hashTags: string[] = [];
              } else {
                // 本文中のハッシュタグを最大3個集める
                const hashTags: string[] = [];
                const hashTagRegex = /(?:^|\s)[#＃]([a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\u3400-\u4dbf_-]+)/g;
                let match;
                while ((match = hashTagRegex.exec(fullText)) !== null && hashTags.length < 3) {
                  if (match[1] && !hashTags.includes(match[1]) && isNaN(Number(match[1]))) {
                    hashTags.push(match[1]);
                  }
                }
                if (hashTags.length > 0) {
                  extractedTags = hashTags.join(', ');
                }
              }
            }

            updatedMd = `---\ndate: ${dateStr}\ntags: [${extractedTags}]\n---\n# ${autoTitle}\n\n## 対話ログ\n\n### 👤 ユーザー\n\n${userMsg.content}\n\n### 🤖 Gemini\n\n${fullText}\n`;
          }

          // ステートを更新
          setNoteTitle(autoTitle);
          setNoteBody(updatedMd);

          // 保存
          await handleSaveNote(autoTitle, updatedMd);
        },
        (err) => {
          // エラーメッセージをチャット履歴に表示（alertではなくインライン表示）
          const errorMsg: ChatMessage = {
            role: 'model',
            content: `⚠️ **エラーが発生しました**\n\n${err.message || '通信エラーが発生しました。'}\n\nもう一度メッセージを送信してください。`
          };
          setChatHistory([...updatedHistory, errorMsg]);
          setStreamedText('');
          setIsGenerating(false);
        }
      );
    } catch (err: any) {
      // 予期しないエラーの安全策
      const errorMsg: ChatMessage = {
        role: 'model',
        content: `⚠️ **予期しないエラー**\n\n${err?.message || '不明なエラーが発生しました。'}\n\nもう一度メッセージを送信してください。`
      };
      setChatHistory(prev => [...prev, errorMsg]);
      setStreamedText('');
      setIsGenerating(false);
    }
  };  return (
    <div className="flex flex-col h-screen w-screen bg-[#070a13] text-gray-100 overflow-hidden font-sans select-none">
      
      {/* 共通ヘッダー（タイトルバー） */}
      <header className="h-[38px] flex items-center justify-between px-4 border-b border-gray-800/40 bg-[#070a13] drag-area shrink-0 select-none">
        <div className="flex items-center space-x-2 text-indigo-400 font-semibold text-xs no-drag">
          <BrainCircuit className="w-4 h-4 animate-pulse" />
          <span className="bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent font-bold tracking-wider">Aegis Note</span>
        </div>
        {/* ウィンドウコントロールボタンとの干渉防止スペース */}
        <div className="w-[140px] shrink-0" />
      </header>

      {/* メインレイアウト */}
      <div className="flex flex-1 h-[calc(100vh-3
        
        {/* 最左端リボンメニュー */}
        <aside className="w-16 bg-[#04060d] border-r border-gray-800/60 flex flex-col items-center py-4 justify-between select-none shrink-0 h-full">
          {/* 上部グループ */}
          <div className="flex flex-col items-center space-y-4 w-full">
            {/* ノートリストトグル */}
            <button
              onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
            {filteredNotes.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-8">
                {notes.length === 0 ? 'ノートがありません' : '一致するノートがありません'}
              </div>
              </div>
            ) : (
              filteredNotes.map(note => {
                const isSelected = selectedNote?.name === note.name;
                return (
                  <button
                    key={note.name}
                    onClick={() => handleSelectNote(note)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSidebarContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        note: note
                      });
                    }}
                    className={`w-full flex items-start space-x-2 p-2 rounded-xl text-left transition ${
                      isSelected 
                        ? 'bg-indigo-600/15 border border-indigo-500/30 text-white font-medium' 
                        : 'hover:bg-gray-800/40 text-gray-450 hover:text-gray-200 border border-transparent'
                    }`}
              {/* ツールチップ */}
              <span className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 text-gray-200 text-[10px] font-semibold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-40">
                AIチャット
              </span>
            </button>

            {/* グラフビュートグル */}
            <button
              onClick={() => setViewMode(viewMode === 'graph' ? 'editor' : 'graph')}
              className={`p-3 rounded-xl transition-all duration-200 group relative ${
                viewMode === 'graph' 
                  ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
              title="グラフビューをトグル"
            >
              <Network className="w-5 h-5" />
              {/* ツールチップ */}
              <span className="absolute left-20 top-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 text-gray-200 text-[10px] font-semibold px-2 py-1 rounded shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition whitespace-nowrap z-40">
                グラフビュー
              </span>
            </button>
          </div>

            }}
            onCreateNote={handleCreateNoteWithName}
            onClose={() => setViewMode('editor')}
          />
        </div>
              }}
              placeholder="ファイル名を入力 (例: my-note)"
              className="w-full bg-bgInput border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition mb-2"
            />
            <p className="text-[10px] text-gray-500 mb-4">※ .md 拡張子は自動で付与されます。空欄の場合は日時で自動生成されます。</p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowNameModal(false)}
                );
              })
            )}
          </div>
        {/* Git同期ステータスパネル */}
        <div className="p-4 border-t border-gray-800/60 bg-bgDarker/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                gitStatus === 'syncing' ? 'bg-amber-400' :
                gitStatus === 'success' ? 'bg-emerald-400' :
                gitStatus === 'error' ? 'bg-red-500' : 'bg-indigo-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                gitStatus === 'syncing' ? 'bg-amber-500' :
                gitStatus === 'success' ? 'bg-emerald-500' :
                gitStatus === 'error' ? 'bg-red-600' : 'bg-indigo-500'
              }`} />
            </span>
            <div className="text-xs">
              <div className="font-semibold text-gray-300">GitHub Sync</div>
              <div className="text-[10px] text-gray-500">
                {gitStatus === 'syncing' ? '同期中...' :
                 gitStatus === 'success' ? '最新状態' :
                 gitStatus === 'error' ? 'エラー発生' : '待機中'}
              </div>
            </div>
          </div>
  
                }
            <button
              onClick={handleSendChatMessage}
              disabled={!chatInput.trim() || isGenerating}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-40 shrink-0"
            >
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* 設定モーダル */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0b0f19] border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl glow-indigo">
              <Settings className="w-5 h-5" />
              <h3 className="text-lg font-bold text-white">アプリケーション設定</h3>
            </div>
            
            <form onSubmit={handleSaveSettings} className="space-y-4">
                {nameModalMode === 'new' ? '作成' : '変更'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* ノートリスト（無限スクロール対応） */}
          <div 
            className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
            onScroll={(e) => {
              const target = e.currentTarget;
              // 一番下までスクロールされたら表示件数を増やす
              if (target.scrollHeight - target.scrollTop - target.clientHeight < 100) {
                if (visibleNotesCount < filteredNotes.length) {
                  setVisibleNotesCount(prev => prev + 50);
                }
              }
            }}
          >
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 mb-2">ローカルノート</div>
            {filteredNotes.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-8">
                {notes.length === 0 ? 'ノートがありません' : '一致するノートがありません'}
              </div>
            ) : (
              filteredNotes.slice(0, visibleNotesCount).map(note => {
                const isSelected = selectedNote?.name === note.name;
                return (
                  <button
                    key={note.name}
                    onClick={() => handleSelectNote(note)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSidebarContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        note: note
                      });
                    }}
                    className={`w-full flex items-start space-x-2 p-2 rounded-xl text-left transition ${
                      isSelected 
                        ? 'bg-indigo-600/15 border border-indigo-500/30 text-white font-medium' 
                        : 'hover:bg-gray-800/40 text-gray-450 hover:text-gray-200 border border-transparent'
                    }`}
                  >
                    <FileText className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                    <div className="overflow-hidden">
                      <div className="text-xs truncate font-medium">{note.name.replace('.md', '')}</div>
                      <div className="text-[9px] text-gray-500 mt-0.5">
                        {new Date(note.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        {/* Git同期ステータスパネル */}
        <div className="p-4 border-t border-gray-800/60 bg-bgDarker/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5">
              <
                {isSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{isSaving ? '保存中...' : saveSuccess ? '保存完了' : '保存'}</span>
                                 className={`obsidian-wiki-link ${isGhost ? 'is-ghost' : ''}`}
                                {...props}
                              >
                                {children}
                              </a>
                 gitStatus === 'success' ? '最新状態' :
                 gitStatus === 'error' ? 'エラー発生' : '待機中'}
              </div>
            </div>
          </div>
          <button 
            onClick={handleManualSync}
            disabled={gitStatus === 'syncing'}
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition disabled:opacity-40"
            title="手動Git同期"
            title="手動Git同期"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${gitStatus === 'syncing' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </aside>
      )}

      {/* 2. メインエリア: 閲覧・編集エディタ */}
        <main className="flex-1 flex flex-col h-full bg-[#070a13] relative">
          {/* 上部ヘッダー */}
          <div className="h-14 border-b border-gray-800/60 flex items-center justify-between px-6">
            <div className="flex items-center space-x-3">
              {selectedNote ? (
                <div className="flex items-center space-x-2">
                  <h2 className="font-semibold text-lg max-w-xs truncate text-gray-100">
                    {noteTitle}
                  </h2>
                  <button
                    onClick={() => {
                      setNameModalInput(noteTitle);
                      setNameModalMode('rename');
                      setShowNameModal(true);
                      setTimeout(() => nameInputRef.current?.focus(), 100);
                    }}
                    className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition"
                    title="ファイル名を変更"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <h2 className="font-semibold text-lg max-w-xs truncate text-gray-100">
                  ノートを選択してください
                </h2>
              )}
                </div>
              )}
            </div>

            {/* 手動保存ボタン */}
            {selectedNote && editMode === 'edit' && (
              <button
                onClick={async () => {
                  setIsSaving(true);
                  setSaveSuccess(false);
                  await handleSaveNote(noteTitle, noteBody);
                  setIsSaving(false);
                  setSaveSuccess(true);
                  setTimeout(() => setSaveSuccess(false), 2000);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition shadow-sm ${
                  saveSuccess
                    ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                }`}
                title="ノートを保存 (Ctrl+S)"
                disabled={isSaving}
              >
                {isSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                  setSaveSuccess(false);
                  await handleSaveNote(noteTitle, noteBody);
                  setIsSaving(false);
                  setSaveSuccess(true);
                  setTimeout(() => setSaveSuccess(false), 2000);
                }}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition shadow-sm ${
                  saveSuccess
                    ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
                }`}
                title="ノートを保存 (Ctrl+S)"
                disabled={isSaving}
              >
                {isSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{isSaving ? '保存中...' : saveSuccess ? '保存完了' : '保存'}</span>
              </button>
            )}
          </div>

          {/* 本文エリア */}
          <div className="flex-1 overflow-y-auto p-8 flex justify-center">
            {selectedNote ? (
              <div className="w-full max-w-3xl h-full flex flex-col">
                {editMode === 'edit' ? (
                  <div className="relative flex-1 flex flex-col">
                    <textarea
                      ref={textareaRef}
                      value={noteBody}
                      onChange={handleTextareaChange}
                      onKeyDown={handleTextareaKeyDown}
                      className="w-full flex-1 bg-transparent resize-none outline-none border-none text-gray-200 font-mono leading-relaxed text-sm focus:ring-0"
                      placeholder="Markdownで書きましょう..."
                    />
                    
                    {/* 予測変換ポップアップ */}
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute z-30 bg-[#0b0f19]/95 border border-gray-800 rounded-xl shadow-xl max-h-48 overflow-y-auto w-64 p-1 bottom-12 left-0 backdrop-blur-md glow-indigo">
                        <div className="text-[9px] font-bold text-gray-55 px-2 py-1 border-b border-gray-800/60 mb-1">
                          ノートを補完 (矢印キーで選択 / Enterで確定)
                        </div>
                        {suggestions.map((name, idx) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => insertSuggestion(name)}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition ${
                              idx === suggestionIndex
                                ? 'bg-indigo-650 text-white font-medium shadow-md'
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                                    const found = notes.find(n => n.name.replace('.md', '').toLowerCase() === noteName.toLowerCase());
                                    if (found) handleSelectNote(found);
                                  }
                                }}
                                className={`obsidian-wiki-link ${isGhost ? 'is-ghost' : ''}`}
                                {...props}
                              >
                                {children}
                              </a>
                            );
                          }
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="obsidian-external-link"

                              {...props}
                            >
                              {children}
                            </a>
                          );
                        }
                                          <div className="property-tags">
                                            {tagList.map(t => (
                                              <span key={t} className="property-tag-badge">
                                                {t}
                                                <button
                                                  onClick={() => handleRemoveTag(t)}
                                                  className="property-tag-remove"
                                                  title="タグを削除"
                                                >
                                                  ×
                                                </button>
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={key} className="property-row">
                                      <div className="property-key">
                                        <span className="property-icon">
                                          {key === 'date' ? '📅' : '📄'}
        {/* モード切替エリア */}
        <div className="h-14 border-b border-gray-800/60 flex items-center justify-between px-4 bg-bgCard/60">
          <div className="flex items-center space-x-1.5 text-indigo-400 font-semibold text-sm">
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>
              {aiModelMode === 'flash-lite' ? 'Gemini Flash-Lite' :
               aiModelMode === 'flash-3-5' ? 'Gemini 3.5 Flash' :
               'Gemini Flash'}



















                          </ReactMarkdown>
                        </>
                      );
                    })()}
                  </div>Suggestions && suggestions.length > 0 && (
                      <div className="absolute z-30 bg-[#0b0f19]/95 border border-gray-800 rounded-xl shadow-xl max-h-48 overflow-y-auto w-64 p-1 bottom-12 left-0 backdrop-blur-md glow-indigo">
                        <div className="text-[9px] font-bold text-gray-505 px-2 py-1 border-b border-gray-800/60 mb-1">
                          ノートを補完 (矢印キーで選択 / Enterで確定)
                        </div>
                        {suggestions.map((name, idx) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => insertSuggestion(name)}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition ${
                              idx === suggestionIndex
                                ? 'bg-indigo-650 text-white font-medium shadow-md'
                                : 'text-gray-300 hover:bg-gray-800/40'
                            }`}
                          >
                            [[{name}]]
                          </button>
                        ))}
                      </div>
                    )}





                                  );
                                }
                                return (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="obsidian-external-link"
                                    {...props}
                                  >
                                    {children}
                                  </a>
                                );
                              },
                              blockquote: ({ children }: any) => {
                                let calloutType = '';
                                let calloutTitle = '';
                                let isCallout = false;
                                let remainingChildren = children;

                                const firstChild = children?.[0] || children;
                                if (firstChild && firstChild.props && firstChild.props.children) {
                                  const pChildren = firstChild.props.children;
                                  const firstTextNode = Array.isArray(pChildren) ? pChildren[0] : pChildren;
                                  
                                  if (typeof firstTextNode === 'string') {
                                    const match = firstTextNode.match(/^\[!(question|help|info|note|gemini|success|done|warning|caution|summary|quote|abstract)\]\s*(.*)/i);
              value={nameModalInput}
              onChange={(e) => setNameModalInput(e.target.value)}
              onKeyDown={(e) => {
                                      </div>
                                    </div>
                                  );
                                }

                                return <blockquote>{children}</blockquote>;
                              }
                            }}
                          >
                            {parseWikiLinksForPreview(parseCalloutsForPreview(bodyWithoutFm))}
                          </ReactMarkdown>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center max-w-sm">
                <BrainCircuit className="w-16 h-16 text-indigo-500/20 mb-4" />
                <h3 className="text-lg font-bold text-gray-300">ノートが開かれていません</h3>
                <p className="text-sm text-gray-500 mt-2">
                  左サイドバーから既存のノートを選択するか、新規ノートを作成して記録を開始してください。
                </p>
              </div>
            )}
          </div>

          {/* グラフビューオーバーレイ (メインエリア内) */}
          {showGraphView && (
            <GraphView
              notes={notes}
              onSelectNote={(note) => {
                handleSelectNote(note);
              }}
              onClose={() => setShowGraphView(false)}
            />
          )}
        </main>

      {/* 3. 右サイドバー: AIチャット窓 */}
                                return <blockquote>{children}</blockquote>;
                              }
                            }}
                          >
                            {parseWikiLinksForPreview(parseCalloutsForPreview(bodyWithoutFm))}
                          </ReactMarkdown>
                        </>
                      );
                    })()}
                }
                if (e.key === 'Escape') {
                  setShowNameModal(false);
                }
              }}
              placeholder="ファイル名を入力 (例: my-note)"
              <button
                type="button"
                onClick={() => setAiSpeedMode('thinking')}
                className={`px-2 py-1 text-xs rounded-md font-medium transition ${
                  aiSpeedMode === 'thinking' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                思考
              </button>
              <button
                type="button"
                onClick={() => setAiSpeedMode('fast')}
                className={`px-2 py-1 text-xs rounded-md font-medium transition ${
                  aiSpeedMode === 'fast' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                高速
              </button>
            </div>

            <select
              value={aiModelMode}
              onChange={(e) => setAiModelMode(e.target.value as AiModelMode)}
              className="bg-bgInput text-xs text-gray-300 border border-gray-800 rounded-lg px-2 py-1 outline-none focus:border-indigo-500 transition font-medium"
              title="使用するAIモデルを切り替え"
            >
              <option value="flash-lite">Flash-Lite</option>
              <option value="flash">Flash</option>
              <option value="flash-3-5">3.5 Flash</option>
            </select>

            <select
              value={chatMode}
              onChange={(e) => setChatMode(e.target.value as ChatMode)}
              className="bg-bgInput text-xs text-gray-300 border border-gray-800 rounded-lg px-2 py-1 outline-none focus:border-indigo-500 transition font-medium"
            >
              <option value="deep-think">🧠 思考整理</option>
              <option value="markdown-struct">📝 ノート作成</option>
              <option value="long-explain">📑 長文詳細解説</option>
            </select>
          </div>
        </div>

        {/* チャットタイムライン */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.length === 0 && !streamedText && (
            <div className="text-center py-16 px-4">
              <BrainCircuit className="w-10 h-10 mx-auto text-indigo-500/20 mb-3" />
              <p className="text-xs text-gray-400">
                {aiSpeedMode === 'thinking' 
                  ? '「思考モード」がアクティブです。複雑な相談や深掘りしたい内容に向いています。'
                  : '「高速モード」がアクティブです。短いやり取りや素早い下書きに向いています。'}
              </p>
            </div>
          )}

          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`text-[10px] text-gray-500 mb-1 p
          {/* Save button removed – auto-saving handled after AI response */}

          <div className="relative flex items-end bg-bgInput border border-gray-800 rounded-xl focus-within:border-indigo-500/50 p-2 transition">
            <textarea
              value={chatInput}
        
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-bgInput border border-gray-800 text-gray-200 rounded-tl-none markdown-preview'
              }`}>
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}

          {/* ストリーミング中の表示 */}
          {streamedText && (
            <div className="flex flex-col items-start">
              <div className="text-[10px] text-gray-500 mb-1 px-1">Gemini (生成中)</div>
              <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm bg-bgInput border border-gray-800 text-gray-200 rounded-tl-none markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamedText}</ReactMarkdown>
              </div>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>

        {/* コントロール・入力エリア */}
        <div className="p-3 border-t border-gray-800/60 bg-bgCard/60 space-y-2">
          {/* Save button removed – auto-saving handled after AI response */}

          <div className="relative flex items-end bg-bgInput border border-gray-800 rounded-xl focus-within:border-indigo-500/50 p-2 transition">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChatMessage();
                }
              }}
              rows={2}
              className="flex-1 bg-transparent resize-none outline-none border-none text-xs text-gray-200 leading-normal focus:ring-0 px-2"
              placeholder="Gemini に話しかける... (Shift+Enterで改行)"
              disabled={isGenerating}
            />
            <button
              onClick={handleSendChatMessage}
              disabled={!chatInput.trim() || isGenerating}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-40 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </main>
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0b0f19] border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl glow-indigo">
            <div className="flex items-center space-x-2 text-indigo-400 mb-6">
              <Settings className="w-5 h-5" />
              <h3 className="text-lg font-bold text-white">アプリケーション設定</h3>
            </div>
            
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">Gemini APIキー *</label>
                <input
                  type="password"
                  required
                  value={config.geminiApiKey}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                  placeholder="AI-key (または AIzaSy...)"
                  className="w-full bg-bgInput border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">ノートのローカル保存先パス</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={config.notesPath}
                    className="flex-1 bg-bgInput border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-400 outline-none"
                  />
                  <button
                    type="button"


















































          <div className="bg-[#0b0f19] border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl glow-indigo">
            <div className="flex items-center space-x-2 text-indigo-400 mb-4">
              <Edit3 className="w-5 h-5" />
              <h3 className="text-lg font-bold text-white">
                {nameModalMode === 'new' ? '新規ノートのファイル名' : 'ファイル名を変更'}
              </h3>
            </div>
            <input
              ref={nameInputRef}
              type="text"
              value={nameModalInput}
              onChange={(e) => setNameModalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleNameModalConfirm();
                }
                if (e.key === 'Escape') {
                  setShowNameModal(false);
                }
              }}
              placeholder="ファイル名を入力 (例: my-note)"
              className="w-full bg-bgInput border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition mb-2"
            />
            <p className="text-[10px] text-gray-500 mb-4">※ .md 拡張子は自動で付与されます。空欄の場合は日時で自動生成されます。</p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowNameModal(false)}
                  setShowNameModal(false);
                }
              }}
              placeholder="ファイル名を入力 (例: my-note)"
              className="w-full bg-bgInput border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition mb-2"
            />
            <p className="text-[10px] text-gray-500 mb-4">※ .md 拡張子は自動で付与されます。空欄の場合は日時で自動生成されます。</p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowNameModal(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs transition"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleNameModalConfirm}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition shadow-md shadow-indigo-600/10"
              >
                {nameModalMode === 'new' ? '作成' : '変更'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 左サイドバー右クリックカスタムメニュー */}
      {sidebarContextMenu.visible && sidebarContextMenu.note && (
        <div
          className="fixed z-50 bg-[#0c101b] border border-gray-800 rounded-xl p-2.5 shadow-2xl flex flex-col min-w-40"
          style={{ left: sidebarContextMenu.x, top: sidebarContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="text-[10px] font-bold text-gray-400 truncate pb-1.5 border-b border-gray-800/60 mb-1.5">
            {sidebarContextMenu.note.name.replace('.md', '')}
          </div>
          <button
            onClick={() => {
              if (sidebarContextMenu.note) {
                if (window.confirm(`ノート「${sidebarContextMenu.note.name.replace('.md', '')}」を完全に削除しますか？\nこの操作は取り消せません。`)) {
                  handleDeleteNote(sidebarContextMenu.note);
                }
              }
              setSidebarContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left text-xs text-red-400 hover:text-red-300 font-semibold px-2 py-1.5 rounded hover:bg-red-500/10 transition"
          >
            ノートを削除する
          </button>
        </div>
      )}

      </div>

    </div>
  );
}
