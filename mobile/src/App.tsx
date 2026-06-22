import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BottomNav, { Tab } from './components/BottomNav';
import FilesScreen from './screens/NotesScreen';
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
  loadMasterTags,
  saveMasterTagsLocal,
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
  generateTagsFromContent,
  generateNoteTitle,
  generateMocContent,
  NoteInfo,
} from './lib/gemini';
import {
  syncNotes,
  readMasterTagsFromGitHub,
  writeMasterTagsToGitHub,
  fetchNoteListFromGitHub,
  fetchNoteContentFromGitHub,
  saveNoteToGitHub,
  deleteNoteOnGitHub,
  currentYearMonth,
  addEntryToIndex,
  appendToMasterMoc,
  loadNoteListCache,
  setVaultPassword,
  vaultExistsOnGitHub,
  setupVaultOnGitHub,
  unlockVaultFromGitHub,
} from './lib/githubSync';

const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  'deep-think': '思考整理',
  'markdown-struct': 'ノート作成',
  'long-explain': '長文詳細解説',
  'prompt-gen': 'プロンプト作成',
  'long-doc': '長文解析',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('files');
  const [notes, setNotes] = useState<Note[]>([]);
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [masterTags, setMasterTags] = useState<string[]>([]);

  // ノートタブ（NoteScreen）用
  const [noteTabSelectedName, setNoteTabSelectedName] = useState<string | null>(null);
  const [noteTabContent, setNoteTabContent] = useState('');

  // 暗号化保管庫
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultModal, setVaultModal] = useState<null | 'unlock' | 'setup'>(null);
  const [vaultPw, setVaultPw] = useState('');
  const [vaultPw2, setVaultPw2] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [pendingPrivateNote, setPendingPrivateNote] = useState<Note | null>(null);
  const [privateMode, setPrivateMode] = useState(false);

  const [recentNames, setRecentNames] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [archived, setArchived] = useState<string[]>([]);
  const [localGraphTarget, setLocalGraphTarget] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMode, setChatMode] = useState<string>('deep-think');
  const chatModeRef = useRef<string>('deep-think');
  const [aiModelMode, setAiModelMode] = useState<AiModelMode>('flash-lite');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [gitStatus, setGitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ name: string; instruction: string } | null>(null);

  const noteTabSelectedNote = useMemo(
    () => notes.find((n) => n.name === noteTabSelectedName) ?? null,
    [notes, noteTabSelectedName],
  );

  const noteTabContentRef = useRef(noteTabContent);
  noteTabContentRef.current = noteTabContent;

  // stale closure対策: 常に最新のconfigとrunSyncを参照
  const configRef = useRef<AppConfig>(config);
  configRef.current = config;
  const runSyncRef = useRef<(cfg?: AppConfig) => Promise<void>>(async () => {});

  // notesの最新値をrefで保持（auto-saveのstale closure対策）
  const notesRef = useRef<Note[]>(notes);
  notesRef.current = notes;

  // 自動sync間隔（5分）
  const lastAutoSyncRef = useRef<number>(0);
  const MIN_AUTO_SYNC_MS = 5 * 60 * 1000;

  // ---------- 初期化 ----------
  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setConfig(cfg);
      const meta = await loadNoteMeta();
      setFavorites(meta.favorites);
      setArchived(meta.archived);
      if (!cfg.geminiApiKey) setTab('settings');

      // マスタータグをキャッシュから読み込み
      const cachedTags = await loadMasterTags();
      setMasterTags(cachedTags);

      if (cfg.gitRemoteUrl) {
        // ① キャッシュがあれば即座に表示（0秒）
        const cached = await loadNoteListCache();
        if (cached && cached.length > 0) {
          mergeRemoteNotes(cached);
        }

        // ② バックグラウンドで GitHub から最新リストを取得して更新
        fetchNoteListFromGitHub(cfg.gitRemoteUrl).then((remoteList) => {
          mergeRemoteNotes(remoteList);
        }).catch(async () => {
          // GitHub 取得失敗かつキャッシュもない場合はローカルにフォールバック
          if (!cached || cached.length === 0) {
            setNotes(await listNotes());
          }
        });

        // マスタータグを GitHub からも取得
        readMasterTagsFromGitHub(cfg.gitRemoteUrl).then((remoteTags) => {
          if (remoteTags.length > 0) {
            const merged = Array.from(new Set([...cachedTags, ...remoteTags]));
            setMasterTags(merged);
            saveMasterTagsLocal(merged);
          }
        }).catch(() => {});

        // 保管庫の有無を確認
        vaultExistsOnGitHub(cfg.gitRemoteUrl).then(setVaultExists).catch(() => {});
      } else {
        // GitHub 未設定: ローカルストレージから読み込み
        setNotes(await listNotes());
        if (cfg.autoSync && cfg.gitRemoteUrl) runSync(cfg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // リモートリストと現在の state をマージ（sha・content は現在値を優先）
  const mergeRemoteNotes = useCallback((remoteList: { name: string; remotePath: string; sha: string; updatedAt: string }[]) => {
    setNotes(prev => {
      const prevMap = new Map(prev.map(n => [n.name, n]));
      return remoteList.map(r => {
        const existing = prevMap.get(r.name);
        return {
          ...buildNote(r.name, existing?.content ?? '', r.updatedAt),
          remotePath: r.remotePath,
          // 既存の sha（fetchNoteContentFromGitHub で取得済みの値）を優先
          sha: existing?.sha || r.sha,
          favorite: existing?.favorite,
          archived: existing?.archived,
        } as Note;
      });
    });
  }, []);

  const refreshNotes = useCallback(async () => {
    const cfg = configRef.current;
    if (cfg.gitRemoteUrl) {
      try {
        const remoteList = await fetchNoteListFromGitHub(cfg.gitRemoteUrl);
        mergeRemoteNotes(remoteList);
        return;
      } catch { /* fall through to local */ }
    }
    setNotes(await listNotes());
  }, [mergeRemoteNotes]);

  // ---------- アプリ復帰時自動更新（Phase 8） ----------
  useEffect(() => {
    const MIN_REFRESH_MS = 60 * 1000;
    let lastRefresh = 0;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      const cfg = configRef.current;
      const now = Date.now();
      if (now - lastRefresh < MIN_REFRESH_MS) return;
      lastRefresh = now;

      if (cfg.gitRemoteUrl) {
        // GitHub 直接アクセス: _index.json を再取得してノートリストを更新
        try {
          const remoteList = await fetchNoteListFromGitHub(cfg.gitRemoteUrl);
          mergeRemoteNotes(remoteList);
        } catch { /* silent */ }
      } else if (cfg.autoSync) {
        // ローカルストレージ + 旧来の sync
        const syncNow = Date.now();
        if (syncNow - lastAutoSyncRef.current < MIN_AUTO_SYNC_MS) return;
        lastAutoSyncRef.current = syncNow;
        runSyncRef.current(cfg);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeRemoteNotes]);

  // ノートタブ 自動保存
  useEffect(() => {
    if (!noteTabSelectedName) return;
    const timer = setTimeout(async () => {
      const cfg = configRef.current;
      const content = noteTabContentRef.current;
      if (cfg.gitRemoteUrl) {
        // GitHub 直接書き込み
        const note = notesRef.current.find(n => n.name === noteTabSelectedName);
        const remotePath = note?.remotePath ?? `notes/${noteTabSelectedName}`;
        try {
          let sha = note?.sha;
          let newSha: string;
          try {
            newSha = await saveNoteToGitHub(cfg.gitRemoteUrl, remotePath, content, sha);
          } catch (firstErr: unknown) {
            // sha 競合の場合は最新 sha を取得してリトライ
            const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
            if (msg.includes('409') || msg.includes('422')) {
              const latest = await fetchNoteContentFromGitHub(cfg.gitRemoteUrl, remotePath);
              sha = latest.sha;
              newSha = await saveNoteToGitHub(cfg.gitRemoteUrl, remotePath, content, sha);
            } else {
              throw firstErr;
            }
          }
          setNotes(prev => prev.map(n =>
            n.name === noteTabSelectedName
              ? { ...buildNote(n.name, content), remotePath, sha: newSha || n.sha }
              : n
          ));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Auto-save to GitHub failed:', msg);
          alert(`保存に失敗しました: ${msg}`);
        }
      } else {
        await writeNote(noteTabSelectedName, content);
        setNotes((prev) =>
          prev.map((n) =>
            n.name === noteTabSelectedName ? buildNote(n.name, content) : n,
          ),
        );
      }
    }, 1200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteTabContent, noteTabSelectedName]);

  // ノートタブでファイルを選択（GitHub 直接アクセス時はコンテンツをオンデマンド取得）
  const selectNoteForNoteTab = useCallback(async (note: Note) => {
    setNoteTabSelectedName(note.name);
    setNoteTabContent(''); // 即座に前のノートの内容をクリア
    const cfg = configRef.current;
    if (cfg.gitRemoteUrl && note.remotePath && note.content === '') {
      // GitHub からコンテンツをフェッチ
      try {
        const { content, sha } = await fetchNoteContentFromGitHub(cfg.gitRemoteUrl, note.remotePath);
        setNoteTabContent(content);
        setNotes(prev => prev.map(n => n.name === note.name ? { ...n, content, sha } : n));
      } catch (err) {
        if (String(err).includes('VAULT_LOCKED')) {
          setPendingPrivateNote(note);
          setVaultPw(''); setVaultError(''); setVaultModal('unlock');
          return;
        }
        alert('ノートの読み込みに失敗しました: ' + (err instanceof Error ? err.message : String(err)));
      }
    } else {
      setNoteTabContent(note.content);
    }
    setRecentNames((prev) => [note.name, ...prev.filter((n) => n !== note.name)].slice(0, 10));
  }, []);

  // ---------- 保管庫 ----------
  async function handleVaultUnlock() {
    setVaultError('');
    const cfg = configRef.current;
    if (!cfg.gitRemoteUrl) { setVaultError('GitHub未設定です'); return; }
    try {
      const ok = await unlockVaultFromGitHub(cfg.gitRemoteUrl, vaultPw);
      if (!ok) { setVaultError('パスワードが違います'); return; }
      setVaultUnlocked(true);
      setPrivateMode(true);
      setVaultModal(null);
      setVaultPw('');
      const pending = pendingPrivateNote;
      setPendingPrivateNote(null);
      if (pending) selectNoteForNoteTab(pending);
      else setTab('files');
    } catch (e) {
      setVaultError('解除に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleVaultSetup() {
    setVaultError('');
    if (vaultPw.length < 4) { setVaultError('パスワードは4文字以上にしてください'); return; }
    if (vaultPw !== vaultPw2) { setVaultError('パスワードが一致しません'); return; }
    const cfg = configRef.current;
    if (!cfg.gitRemoteUrl) { setVaultError('GitHub未設定です'); return; }
    try {
      await setupVaultOnGitHub(cfg.gitRemoteUrl, vaultPw);
      setVaultExists(true);
      setVaultUnlocked(true);
      setPrivateMode(true);
      setVaultModal(null);
      setVaultPw(''); setVaultPw2('');
    } catch (e) {
      setVaultError('作成に失敗しました: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  function handleVaultLock() {
    setVaultPassword(null);
    setVaultUnlocked(false);
    setPrivateMode(false);
    if (noteTabSelectedName && noteTabSelectedName.startsWith('private')) {
      setNoteTabContent('');
      setNoteTabSelectedName(null);
    }
  }

  // 鍵アイコン: 未作成→作成 / ロック中→解除 / 解除中→ロック
  function handleVaultKeyClick() {
    if (!vaultExists) { setVaultPw(''); setVaultPw2(''); setVaultError(''); setVaultModal('setup'); }
    else if (!vaultUnlocked) { setVaultPw(''); setVaultError(''); setPendingPrivateNote(null); setVaultModal('unlock'); }
    else handleVaultLock();
  }

  // 検索欄に保管庫パスワードを入力 → 一致したら一発で解除（合言葉＝パスワード方式）
  async function trySecretUnlock(query: string): Promise<boolean> {
    if (!vaultExists || vaultUnlocked || !query.trim()) return false;
    const cfg = configRef.current;
    if (!cfg.gitRemoteUrl) return false;
    try {
      const ok = await unlockVaultFromGitHub(cfg.gitRemoteUrl, query);
      if (ok) { setVaultUnlocked(true); setPrivateMode(true); return true; }
    } catch { /* 失敗時は通常検索として扱う */ }
    return false;
  }

  const isPrivateNote = (n: Note) => (n.remotePath || n.name).startsWith('private/');
  // グラフは常にprivate除外
  const visibleNotes = useMemo(() => notes.filter((n) => !isPrivateNote(n)), [notes]);
  // ファイル一覧: privateMode=trueならprivate専用、それ以外は通常（private除外）
  const filesNotes = useMemo(
    () => notes.filter((n) => (privateMode ? isPrivateNote(n) : !isPrivateNote(n))),
    [notes, privateMode],
  );

  // ---------- ファイル作成 ----------
  async function createNote(title: string, useAi: boolean, aiMode?: string) {
    const firstLine = title.split('\n')[0].trim();
    if (!firstLine) return;

    const modeToUse = (aiMode ?? 'long-explain') as ChatMode;
    setChatMode(modeToUse);
    chatModeRef.current = modeToUse;

    // ファイル作成 → ノートタブに遷移（全モード共通）
    let name = cleanFilename(firstLine);
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${firstLine} (${counter++})`);
    }
    const initial = initialNoteContent(noteTitle(name));
    const ym = currentYearMonth();
    // プライベート表示中に作成したノートは暗号化保管庫(private/)へ
    const isPrivate = privateMode;
    const remotePath = isPrivate ? `private/${name}` : `notes/${ym}/${name}`;
    let newSha: string | undefined;
    try {
      if (config.gitRemoteUrl) {
        newSha = await saveNoteToGitHub(config.gitRemoteUrl, remotePath, initial);
      } else {
        await writeNote(name, initial);
      }
    } catch (err) {
      alert('ノートの作成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    // state に直接追加（refreshNotes は _index.json が古いため不可）
    const newNote: Note = { ...buildNote(name, initial), remotePath, sha: newSha };
    // _index.json と moc/moc.md を非同期で更新（private は公開MOCに載せない）
    if (config.gitRemoteUrl && !isPrivate) {
      const url = config.gitRemoteUrl;
      addEntryToIndex(url, { name, path: remotePath, updatedAt: new Date().toISOString(), isMoc: false }).catch(console.error);
      appendToMasterMoc(url, name).catch(console.error);
    }
    setNotes(prev => [...prev, newNote]);
    selectNoteForNoteTab(newNote);
    setTab('note');
    setChatHistory([]);
    setPendingPrompt(null);

    if (!useAi || !config.geminiApiKey) return;

    // prompt-gen モード
    if (modeToUse === 'prompt-gen') {
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
        initial,
        (chunk) => setStreamedText((prev) => prev + chunk),
        async (fullText) => {
          setChatHistory([...nextHistory, { role: 'model', content: fullText }]);
          setStreamedText('');
          setIsGenerating(false);
          const cleanedText = fullText.replace(/\[PROMPT\][\s\S]*?\[\/PROMPT\]/gi, '').trim();
          const block = `---\n\n## User\n\n${userPrompt.trim()}\n\n## AI\n\n${cleanedText}`;
          const finalContent = `${initial.trimEnd()}\n\n${block}\n`;
          setNoteTabContent(finalContent);
          const cfg2 = configRef.current;
          if (cfg2.gitRemoteUrl) {
            const currentSha = notesRef.current.find(n => n.name === name)?.sha;
            const savedSha = await saveNoteToGitHub(cfg2.gitRemoteUrl, remotePath, finalContent, currentSha);
            setNotes(prev => prev.map(n => n.name === name ? { ...buildNote(n.name, finalContent), remotePath, sha: savedSha || n.sha } : n));
          } else {
            await writeNote(name, finalContent);
            setNotes(prev => prev.map(n => n.name === name ? buildNote(n.name, finalContent) : n));
          }
          const parsed = parseGeneratedPrompt(fullText);
          setPendingPrompt(parsed ?? {
            name: firstLine.slice(0, 10),
            instruction: cleanedText,
          });
        },
        (err) => {
          setIsGenerating(false);
          alert(err instanceof Error ? err.message : String(err));
        },
      );
      return;
    }

    // その他のAIモード
    setIsGenerating(true);
    let acc = initial;
    const client = new GeminiClient(config.geminiApiKey);
    const systemPrompt = getSystemPrompt(modeToUse);
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
        setNoteTabContent(acc);
      },
      async (fullText) => {
        const finalContent = initial + fullText;
        setNoteTabContent(finalContent);
        const cfg2 = configRef.current;
        if (cfg2.gitRemoteUrl) {
          const currentSha = notesRef.current.find(n => n.name === name)?.sha;
          const savedSha = await saveNoteToGitHub(cfg2.gitRemoteUrl, remotePath, finalContent, currentSha);
          setNotes(prev => prev.map(n => n.name === name ? { ...buildNote(n.name, finalContent), remotePath, sha: savedSha || n.sha } : n));
        } else {
          await writeNote(name, finalContent);
          setNotes(prev => prev.map(n => n.name === name ? buildNote(n.name, finalContent) : n));
        }
        setIsGenerating(false);
      },
      (err) => {
        setIsGenerating(false);
        alert(err instanceof Error ? err.message : String(err));
      },
    );
  }

  // MOC作成（moc/ フォルダに作成）useAi=true のとき AI で本文生成
  async function createMoc(title: string, useAi = false) {
    const clean = title.trim();
    if (!clean) return;
    let name = cleanFilename(clean);
    let counter = 1;
    while (notes.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
      name = cleanFilename(`${clean} (${counter++})`);
    }
    const now = new Date().toLocaleString('ja-JP');
    let body = `# ${noteTitle(name)} (MOC)\n\n作成日時: ${now}\n\n`;

    if (useAi && config.geminiApiKey) {
      try {
        const noteInfos: NoteInfo[] = notes
          .filter(n => !(n.remotePath ?? n.name).startsWith('moc/'))
          .slice(0, 80)
          .map(n => ({
            name: n.name.replace(/\.md$/i, ''),
            tags: n.tags ?? [],
            snippet: (n.content ?? '').replace(/^#[^\n]*\n/, '').replace(/作成日時:[^\n]*\n?/, '').trim().slice(0, 100),
          }));
        const generated = await generateMocContent(config.geminiApiKey, noteTitle(name), noteInfos);
        body += generated + '\n';
      } catch (err) {
        alert('AI MOC生成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
        body += `## リンク\n\n- [[関連ノート]]\n`;
      }
    } else {
      body += `## リンク\n\n- [[関連ノート]]\n`;
    }

    const remotePath = `moc/${name}`;
    let newSha: string | undefined;
    try {
      if (config.gitRemoteUrl) {
        newSha = await saveNoteToGitHub(config.gitRemoteUrl, remotePath, body);
      } else {
        await writeNote(name, body);
      }
    } catch (err) {
      alert('MOCの作成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const newNote: Note = { ...buildNote(name, body), remotePath, sha: newSha };
    setNotes(prev => [...prev, newNote]);
    selectNoteForNoteTab(newNote);
    setTab('note');
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
    const ym = currentYearMonth();
    const remotePath = `memos/${ym}/${name}`;
    let newSha: string | undefined;
    try {
      if (config.gitRemoteUrl) {
        newSha = await saveNoteToGitHub(config.gitRemoteUrl, remotePath, initial);
      } else {
        await writeNote(name, initial);
      }
    } catch (err) {
      alert('メモの作成に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const newNote: Note = { ...buildNote(name, initial), remotePath, sha: newSha };
    if (config.gitRemoteUrl) {
      const url = config.gitRemoteUrl;
      addEntryToIndex(url, { name, path: remotePath, updatedAt: new Date().toISOString(), isMoc: false }).catch(console.error);
    }
    setNotes(prev => [...prev, newNote]);
    selectNoteForNoteTab(newNote);
    setTab('note');
  }

  async function deleteNoteAction(note: Note) {
    if (!window.confirm(`「${noteTitle(note.name)}」を削除しますか？`)) return;
    if (config.gitRemoteUrl && note.remotePath && note.sha) {
      await deleteNoteOnGitHub(config.gitRemoteUrl, note.remotePath, note.sha);
    } else {
      await removeNote(note.name);
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
        selectNoteForNoteTab(target);
        setTab('note');
        return;
      }
      if (!window.confirm(`ファイル「${name}」は存在しません。新しく作成しますか？`)) return;
      const clean = cleanFilename(name);
      const initial = initialNoteContent(noteTitle(clean));
      await writeNote(clean, initial);
      await refreshNotes();
      selectNoteForNoteTab(buildNote(clean, initial));
      setTab('note');
    },
    [notes, selectNoteForNoteTab, refreshNotes],
  );

  // ---------- タグ ----------
  async function updateTags(name: string, currentContent: string, nextTags: string[]) {
    const nextContent = applyTagsToContent(currentContent, nextTags);
    if (name === noteTabSelectedName) setNoteTabContent(nextContent);
    const note = notes.find(n => n.name === name);
    if (config.gitRemoteUrl && note?.remotePath) {
      const newSha = await saveNoteToGitHub(config.gitRemoteUrl, note.remotePath, nextContent, note.sha);
      setNotes(prev => prev.map(n => n.name === name ? { ...buildNote(n.name, nextContent), remotePath: note.remotePath, sha: newSha || n.sha } : n));
    } else {
      await writeNote(name, nextContent);
      await refreshNotes();
    }
  }

  // ---------- クイックAIアクション (EditorScreen / NoteScreen 共通) ----------
  async function handleAiAction(action: 'title' | 'tags' | 'summary') {
    if (!config.geminiApiKey) {
      alert('設定画面でGemini APIキーを入力してください');
      return;
    }

    const targetName = noteTabSelectedName;
    const targetNote = noteTabSelectedNote;
    const body = noteTabContentRef.current;
    const setTargetContent = setNoteTabContent;

    if (!targetName) return;

    if (action === 'tags') {
      setAutoSaveStatus('saving');
      const tags = await generateTagsFromContent(config.geminiApiKey, body, masterTags);
      const current = targetNote?.tags ?? [];
      await updateTags(targetName, body, Array.from(new Set([...current, ...tags])));
      if (tags.length > 0) {
        const nextMasterTags = Array.from(new Set([...masterTags, ...tags]));
        setMasterTags(nextMasterTags);
        saveMasterTagsLocal(nextMasterTags);
        writeMasterTagsToGitHub(config.gitRemoteUrl, nextMasterTags).catch(() => {});
      }
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 1500);
      return;
    }

    if (action === 'title') {
      // 現在のタイトルと本文をAIに渡してより適切なタイトルを生成
      const currentTitle = targetNote ? noteTitle(targetNote.name) : '';
      const newTitle = await generateNoteTitle(config.geminiApiKey, currentTitle, body.slice(0, 600));
      if (!newTitle || newTitle === currentTitle) return;
      // 重複時は番号を付けて回避
      let newName = cleanFilename(newTitle);
      let counter = 1;
      while (notes.some((n) => n.name.toLowerCase() === newName.toLowerCase() && n.name !== targetName)) {
        newName = cleanFilename(`${newTitle} (${counter++})`);
      }
      const oldNote = notes.find(n => n.name === targetName);
      if (config.gitRemoteUrl && oldNote?.remotePath) {
        const newRemotePath = oldNote.remotePath.replace(/[^/]+$/, newName);
        await saveNoteToGitHub(config.gitRemoteUrl, newRemotePath, body);
        if (oldNote.sha) await deleteNoteOnGitHub(config.gitRemoteUrl, oldNote.remotePath, oldNote.sha);
      } else {
        await writeNote(newName, body);
        await removeNote(targetName);
      }
      setNoteTabSelectedName(newName);
      setRecentNames((prev) => [newName, ...prev.filter((n) => n !== targetName)]);
      await refreshNotes();
      return;
    }

    // 要約
    setIsGenerating(true);
    const client = new GeminiClient(config.geminiApiKey);
    let acc = body + '\n\n## 要約\n\n';
    setTargetContent(acc);
    await client.chatStream(
      [{ role: 'user', content: `以下のノートを3〜5行で簡潔に要約してください。要約本文のみを出力してください。\n\n${body.slice(0, 8000)}` }],
      SYSTEM_PROMPTS['markdown-struct'],
      aiModelMode,
      null,
      (chunk) => { acc += chunk; setTargetContent(acc); },
      async () => {
        const note = notes.find(n => n.name === targetName);
        if (config.gitRemoteUrl && note?.remotePath) {
          await saveNoteToGitHub(config.gitRemoteUrl, note.remotePath, acc, note.sha);
        } else {
          await writeNote(targetName, acc);
        }
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

  // モード切替ハンドラ：prompt-gen に切り替えたとき会話履歴をリセット
  function handleChangeChatMode(mode: string) {
    if (mode === 'prompt-gen' && chatMode !== 'prompt-gen') {
      setChatHistory([]);
      setPendingPrompt(null);
    }
    setChatMode(mode);
    chatModeRef.current = mode;
  }

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
      if (extracted.length > 0) {
        const nextMasterTags = Array.from(new Set([...masterTags, ...extracted]));
        setMasterTags(nextMasterTags);
        saveMasterTagsLocal(nextMasterTags);
        writeMasterTagsToGitHub(config.gitRemoteUrl, nextMasterTags).catch(() => {});
      }

      // 対象ファイルが開かれている場合はそこに追記
      const targetName = contextName;
      if (targetName) {
        const currentNote = notes.find((n) => n.name === targetName);
        const base = targetName === noteTabSelectedName ? noteTabContentRef.current
                   : currentNote?.content ?? '';
        const currentTags = currentNote?.tags ?? [];
        const nextTags = Array.from(new Set([...currentTags, ...extracted]));
        const appended = applyTagsToContent(`${base.trimEnd()}\n\n${block}\n`, nextTags);
        if (targetName === noteTabSelectedName) setNoteTabContent(appended);
        if (config.gitRemoteUrl && currentNote?.remotePath) {
          await saveNoteToGitHub(config.gitRemoteUrl, currentNote.remotePath, appended, currentNote.sha);
        } else {
          await writeNote(targetName, appended);
        }
      } else {
        // ファイルを新規作成
        const title = await generateNoteTitle(config.geminiApiKey, userPrompt, aiReply);
        const filename = cleanFilename(title);
        const full = `# ${title}\n\n作成日時: ${new Date().toLocaleString()}\nタグ: ${extracted.join(', ')}\n\n${block}\n`;
        const remotePath = `notes/${filename}`;
        if (config.gitRemoteUrl) {
          await saveNoteToGitHub(config.gitRemoteUrl, remotePath, full);
        } else {
          await writeNote(filename, full);
        }
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
      setGitStatus('error');
      setGitMessage(`自動保存エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    setPendingPrompt(null);
  }

  // 「いいえ・チャットで調整する」— バナーを閉じるだけ（PC側と同じ仕様）
  function dismissPendingPrompt() {
    setPendingPrompt(null);
  }

  async function sendChat(prompt: string) {
    if (!config.geminiApiKey) {
      alert('設定画面でGemini APIキーを入力してください');
      setTab('settings');
      return;
    }
    setPendingPrompt(null);
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
        // 全モードで開いているファイルに追記
        handleAutoSave(prompt, fullText, contextName);
        // prompt-gen モードなら [PROMPT] ブロックを検出して確認待ちに
        if (currentMode === 'prompt-gen') {
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
      chatMode === 'long-doc' ? { contextLimit: 100000 } : undefined,
    );
  }

  // ---------- GitHub同期 ----------
  async function runSync(cfg?: AppConfig) {
    const c = cfg ?? config;
    setGitStatus('syncing');
    setGitMessage(null);
    try {
      const result = await syncNotes(c.gitRemoteUrl);
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
  // 常に最新のrunSyncをrefに保持
  runSyncRef.current = runSync;

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
        {tab === 'files' && (
          <FilesScreen
            notes={filesNotes}
            recentNames={recentNames}
            favorites={favorites}
            archived={archived}
            selectedName={noteTabSelectedName}
            chatModes={chatModes}
            privateMode={privateMode}
            onVaultClick={handleVaultKeyClick}
            onSecretUnlock={trySecretUnlock}
            onOpen={(note) => { selectNoteForNoteTab(note); setTab('note'); }}
            onCreate={createNote}
            onCreateMemo={createMemo}
            onCreateMoc={createMoc}
            onDelete={deleteNoteAction}
            onArchive={toggleArchive}
            onShare={shareNote}
            onToggleFavorite={toggleFavorite}
          />
        )}

        {/* グラフタブ */}
        {tab === 'graph' && (
          <GraphScreen
            notes={visibleNotes}
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
            pendingPrompt={pendingPrompt}
            onAddPrompt={addPendingPrompt}
            onDismissPrompt={dismissPendingPrompt}
            chatMode={chatMode}
            chatModes={chatModes}
            onChangeChatMode={handleChangeChatMode}
            onAiAction={handleAiAction}
            onAddTag={(tag) => noteTabSelectedNote && updateTags(noteTabSelectedNote.name, noteTabContent, Array.from(new Set([...(noteTabSelectedNote.tags ?? []), tag.replace(/^#/, '')])))}
            onRemoveTag={(tag) => noteTabSelectedNote && updateTags(noteTabSelectedNote.name, noteTabContent, (noteTabSelectedNote.tags ?? []).filter((t) => t !== tag))}
          />
        )}

        {/* 設定タブ */}
        {tab === 'settings' && (
          <>
            <SettingsScreen
              config={config}
              gitStatus={gitStatus}
              gitMessage={gitMessage}
              aiModelMode={aiModelMode}
              onSave={handleSaveConfig}
              onSync={() => runSync()}
              onDeletePrompt={handleDeletePrompt}
              onModelModeChange={setAiModelMode}
            />
            <div className="mx-auto max-w-2xl px-4 pb-6">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-200">🔒 暗号化保管庫（private/）</h3>
                {!vaultExists ? (
                  <button
                    onClick={() => { setVaultPw(''); setVaultPw2(''); setVaultError(''); setVaultModal('setup'); }}
                    className="w-full rounded bg-indigo-600/30 py-2 text-xs font-semibold text-indigo-300 active:bg-indigo-600/50"
                  >保管庫を作成（パスワード設定）</button>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={vaultUnlocked ? 'text-emerald-400' : 'text-gray-400'}>
                      状態: {vaultUnlocked ? '🔓 解除中' : '🔒 ロック中'}
                    </span>
                    {vaultUnlocked ? (
                      <button onClick={handleVaultLock} className="ml-auto rounded bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-300 active:bg-red-500/30">今すぐロック</button>
                    ) : (
                      <button onClick={() => { setVaultPw(''); setVaultError(''); setVaultModal('unlock'); }} className="ml-auto rounded bg-indigo-500/20 px-3 py-1 text-[11px] font-semibold text-indigo-300 active:bg-indigo-500/30">ロック解除</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* 保管庫モーダル */}
      {vaultModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setVaultModal(null)}>
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#101827] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-semibold text-gray-100">
              {vaultModal === 'setup' ? '🔒 保管庫を作成' : '🔒 ロック解除'}
            </h2>
            {vaultModal === 'setup' && (
              <p className="mb-3 rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">
                ⚠️ パスワードを忘れると中身は<strong>二度と復元できません</strong>。
              </p>
            )}
            <input
              type="password"
              placeholder="パスワード"
              className="mb-2 w-full rounded bg-black/30 px-3 py-2 text-gray-100 outline-none"
              value={vaultPw}
              onChange={(e) => setVaultPw(e.target.value)}
              autoFocus
            />
            {vaultModal === 'setup' && (
              <input
                type="password"
                placeholder="パスワード（確認）"
                className="mb-2 w-full rounded bg-black/30 px-3 py-2 text-gray-100 outline-none"
                value={vaultPw2}
                onChange={(e) => setVaultPw2(e.target.value)}
              />
            )}
            {vaultError && <p className="mb-2 text-xs text-red-400">{vaultError}</p>}
            <div className="flex gap-3">
              <button
                onClick={vaultModal === 'setup' ? handleVaultSetup : handleVaultUnlock}
                className="flex-1 rounded bg-indigo-500 py-2 text-sm font-semibold text-white active:bg-indigo-400"
              >{vaultModal === 'setup' ? '作成' : '解除'}</button>
              <button
                onClick={() => { setVaultModal(null); setPendingPrivateNote(null); setVaultPw(''); setVaultPw2(''); }}
                className="rounded border border-white/10 px-4 py-2 text-sm text-gray-400 active:bg-white/5"
              >キャンセル</button>
            </div>
          </div>
        </div>
      )}


      <BottomNav
        active={tab}
        onChange={(t) => {
          if (t !== 'graph') setLocalGraphTarget(null);
          setTab(t);
        }}
      />
    </div>
  );
}
