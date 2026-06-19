const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');

let mainWindow;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const appUserDataPath = app.getPath('userData');
const configFilePath = path.join(appUserDataPath, 'config.json');
const defaultNotesPath = path.join(app.getPath('documents'), 'AiChatNotes');

if (!fs.existsSync(defaultNotesPath)) {
  fs.mkdirSync(defaultNotesPath, { recursive: true });
}

let appConfig = {
  geminiApiKey: '',
  notesPath: defaultNotesPath,
  gitRemoteUrl: '',
  autoSync: false,
};

function loadConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = fs.readFileSync(configFilePath, 'utf8');
      appConfig = { ...appConfig, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }

  return appConfig;
}

function saveConfig(newConfig) {
  try {
    const prevNotesPath = appConfig.notesPath;
    appConfig = { ...appConfig, ...newConfig };

    if (appConfig.notesPath && !fs.existsSync(appConfig.notesPath)) {
      fs.mkdirSync(appConfig.notesPath, { recursive: true });
    }

    fs.writeFileSync(configFilePath, JSON.stringify(appConfig, null, 2), 'utf8');

    // notesPathが変わったらファイル監視を再起動
    if (appConfig.notesPath !== prevNotesPath) {
      startFileWatcher(appConfig.notesPath);
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to save config:', err);
    return { success: false, error: err.message };
  }
}

// 再帰的にディレクトリ内のファイルを探索するヘルパー
function getFilesRecursively(dir, filterExt = '.md') {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of list) {
    const res = path.resolve(dir, file.name);
    if (file.isDirectory()) {
      // backup フォルダと .git フォルダは検索対象から除外
      if (file.name === 'backup' || file.name === '.git') continue;
      results = results.concat(getFilesRecursively(res, filterExt));
    } else if (file.isFile() && file.name.endsWith(filterExt)) {
      results.push(res);
    }
  }
  return results;
}

// コミット前にルートの .md を archive/YYYY-MM/ へ移動
function packMarkdownFiles(notesPath) {
  const files = fs.readdirSync(notesPath, { withFileTypes: true });
  const mdFiles = files.filter(f => f.isFile() && f.name.endsWith('.md'));
  if (mdFiles.length === 0) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const archiveDir = path.join(notesPath, 'archive', `${year}-${month}`);

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  for (const file of mdFiles) {
    const srcPath = path.join(notesPath, file.name);
    const destPath = path.join(archiveDir, file.name);
    // 同名がすでにあれば中身を比較し、同じなら上書き、違えば上書き（最新優先）
    fs.renameSync(srcPath, destPath);
    console.log(`Packed: ${srcPath} -> ${destPath}`);
  }
}

// ローカルの archive/ と backup/ を削除してルートだけに保つ
function cleanLocalArchive(notesPath) {
  const archiveDir = path.join(notesPath, 'archive');
  const backupDir = path.join(notesPath, 'backup');
  if (fs.existsSync(archiveDir)) {
    fs.rmSync(archiveDir, { recursive: true, force: true });
    console.log('Removed local archive/');
  }
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log('Removed local backup/');
  }
}

// 同期後に archive/ の最新ファイルをルートに展開し、archive/ と backup/ を削除
function unpackMarkdownFiles(notesPath) {
  const archiveRoot = path.join(notesPath, 'archive');
  if (!fs.existsSync(archiveRoot)) return;

  const archivedFiles = getFilesRecursively(archiveRoot, '.md');

  // 同名ファイルが複数ある場合、フォルダ名（YYYY-MM）が最新のものだけ残す
  const latestMap = new Map();
  for (const srcPath of archivedFiles) {
    const filename = path.basename(srcPath);
    const existing = latestMap.get(filename);
    if (!existing) {
      latestMap.set(filename, srcPath);
    } else {
      const existingFolder = path.dirname(existing).split(path.sep).pop() ?? '';
      const currentFolder = path.dirname(srcPath).split(path.sep).pop() ?? '';
      if (currentFolder > existingFolder) {
        latestMap.set(filename, srcPath);
      }
    }
  }

  for (const [filename, srcPath] of latestMap) {
    const destPath = path.join(notesPath, filename);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Unpacked: ${srcPath} -> ${destPath}`);
  }

  // ローカルの archive/ と backup/ を削除
  cleanLocalArchive(notesPath);
}

async function runGitSync() {
  const notesPath = appConfig.notesPath;

  if (!notesPath || !fs.existsSync(notesPath)) {
    return { success: false, error: 'Notes folder was not found.' };
  }

  try {
    const git = simpleGit(notesPath);
    const isRepo = await git.checkIsRepo();

    if (!isRepo) {
      await git.init();
    }

    // 自動バックアップ用のbackupフォルダをGit管理外にする
    const gitignorePath = path.join(notesPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, 'backup/\n', 'utf8');
    }

    if (appConfig.gitRemoteUrl) {
      const remotes = await git.getRemotes();
      const hasOrigin = remotes.some((remote) => remote.name === 'origin');

      if (hasOrigin) {
        await git.remote(['set-url', 'origin', appConfig.gitRemoteUrl]);
      } else {
        await git.addRemote('origin', appConfig.gitRemoteUrl);
      }
    }

    mainWindow?.webContents.send('git-status-changed', 'syncing');

    // 1. コミット前にルート直下の .md をフォルダ分け (Pack)
    packMarkdownFiles(notesPath);

    // 2. Gitにステージ＆コミット
    await git.add('.');
    const status = await git.status();

    if (status.files.length > 0) {
      await git.commit('Auto-commit: AI chat log');
    }

    // 3. リモートと同期 (Pull & Push)
    if (appConfig.gitRemoteUrl) {
      let branchName = 'main';

      try {
        const branches = await git.branch();
        const raw = branches.current || '';
        // "(no branch)" や "(HEAD detached ...)" などの不正な文字列を除外
        branchName = /^[a-zA-Z0-9/_.-]+$/.test(raw) ? raw : 'main';
      } catch (err) {
        await git.checkoutLocalBranch('main');
        branchName = 'main';
      }

      // プッシュする前に、他の端末での変更をプルして取り込む
      try {
        await git.pull('origin', branchName, { '--rebase': 'true' });
      } catch (pullErr) {
        console.warn('Git pull failed, proceeding with push:', pullErr.message);
      }

      try {
        await git.push('origin', branchName, { '--set-upstream': null });
      } catch (pushErr) {
        // 新規リポジトリや main/master 不一致の場合は HEAD:main で強制プッシュ
        if (pushErr.message.includes('rejected') || pushErr.message.includes('refspec') || pushErr.message.includes('failed to push')) {
          console.warn('Push failed, retrying with HEAD:main --force:', pushErr.message);
          await git.raw(['push', 'origin', 'HEAD:refs/heads/main', '--force']);
        } else {
          throw pushErr;
        }
      }
    }

    // 4. 同期完了後に archive/ の .md をルート直下へ復元 (Unpack)
    unpackMarkdownFiles(notesPath);

    mainWindow?.webContents.send('git-status-changed', 'success');
    return { success: true };
  } catch (err) {
    console.error('Git sync failed:', err);
    // 失敗した場合も、念のため手元のファイルを復元しておく
    try {
      unpackMarkdownFiles(notesPath);
    } catch (restoreErr) {
      console.error('Failed to restore files after git failure:', restoreErr);
    }
    mainWindow?.webContents.send('git-status-changed', 'error', err.message);
    return { success: false, error: err.message };
  }
}


// ---------- 自動コミット（ファイル変更後30秒） ----------
let fileWatcher = null;
let commitDebounceTimer = null;
let hasPendingCommit = false;

async function autoCommit() {
  const notesPath = appConfig.notesPath;
  if (!notesPath || !fs.existsSync(notesPath) || !appConfig.gitRemoteUrl) return;
  try {
    const git = simpleGit(notesPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return;
    packMarkdownFiles(notesPath);
    await git.add('.');
    const status = await git.status();
    if (status.files.length > 0) {
      await git.commit('Auto-commit: AI chat log');
      hasPendingCommit = true;
      console.log('Auto-committed locally');
    }
    unpackMarkdownFiles(notesPath);
  } catch (err) {
    console.error('Auto-commit failed:', err.message);
    try { unpackMarkdownFiles(notesPath); } catch {}
  }
}

function startFileWatcher(notesPath) {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
  if (!notesPath || !fs.existsSync(notesPath)) return;
  try {
    fileWatcher = fs.watch(notesPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const normalized = filename.replace(/\\/g, '/');
      if (!normalized.endsWith('.md')) return;
      if (normalized.startsWith('archive/') || normalized.startsWith('backup/')) return;
      clearTimeout(commitDebounceTimer);
      commitDebounceTimer = setTimeout(autoCommit, 30000);
    });
  } catch (err) {
    console.error('Failed to start file watcher:', err.message);
  }
}

// ---------- アプリ終了前にpush ----------
let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting || !appConfig.gitRemoteUrl) return;
  if (!hasPendingCommit) return;
  event.preventDefault();
  isQuitting = true;
  clearTimeout(commitDebounceTimer);
  console.log('Running pre-quit sync...');
  try {
    await runGitSync();
  } catch (err) {
    console.error('Pre-quit sync failed:', err.message);
  }
  hasPendingCommit = false;
  app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070a13',
      symbolColor: '#f3f4f6',
      height: 35,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadConfig();
  startFileWatcher(appConfig.notesPath);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('load-config', () => loadConfig());
ipcMain.handle('save-config', (event, config) => saveConfig(config));

const coordinatesFilePath = path.join(appUserDataPath, 'node_coordinates.json');

function loadCoordinates() {
  try {
    if (fs.existsSync(coordinatesFilePath)) {
      const data = fs.readFileSync(coordinatesFilePath, 'utf8');
      const parsed = JSON.parse(data);
      return {
        '2d': parsed['2d'] || {},
        '3d': parsed['3d'] || {}
      };
    }
  } catch (err) {
    console.error('Failed to load coordinates:', err);
  }
  return { '2d': {}, '3d': {} };
}

function saveCoordinates(coords) {
  try {
    const current = loadCoordinates();
    const newCoords = {
      '2d': coords['2d'] !== undefined ? coords['2d'] : (current['2d'] || {}),
      '3d': coords['3d'] !== undefined ? coords['3d'] : (current['3d'] || {})
    };
    fs.writeFileSync(coordinatesFilePath, JSON.stringify(newCoords, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save coordinates:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('load-coordinates', () => loadCoordinates());
ipcMain.handle('save-coordinates', (event, coords) => saveCoordinates(coords));

// ウィンドウドラッグ移動用
ipcMain.on('window-moving', (event, { deltaX, deltaY }) => {
  if (mainWindow) {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + deltaX, y + deltaY);
  }
});

const graphSettingsFilePath = path.join(appUserDataPath, 'graph_settings.json');

function loadGraphSettings() {
  try {
    if (fs.existsSync(graphSettingsFilePath)) {
      const data = fs.readFileSync(graphSettingsFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load graph settings:', err);
  }
  return { '2d': {}, '3d': {} };
}

function saveGraphSettings(settings) {
  try {
    const current = loadGraphSettings();
    const newSettings = {
      '2d': settings['2d'] !== undefined ? settings['2d'] : (current['2d'] || {}),
      '3d': settings['3d'] !== undefined ? settings['3d'] : (current['3d'] || {})
    };
    fs.writeFileSync(graphSettingsFilePath, JSON.stringify(newSettings, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save graph settings:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('load-graph-settings', () => loadGraphSettings());
ipcMain.handle('save-graph-settings', (event, settings) => saveGraphSettings(settings));

function resolveNotePath(notesPath, filename) {
  const safeFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
  const normalized = path.normalize(safeFilename).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.resolve(notesPath, normalized);
  const root = path.resolve(notesPath);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid note path');
  }

  return filePath;
}

const cacheFilePath = path.join(appUserDataPath, 'metadata_cache.json');

function loadMetadataCache() {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const data = fs.readFileSync(cacheFilePath, 'utf8');
      const cacheObj = JSON.parse(data);
      // バージョンが違う（ハッシュタグ廃止前の古いキャッシュ）場合は再構築のためクリアする
      if (cacheObj._version !== 2) {
        return { _version: 2 };
      }
      return cacheObj;
    }
  } catch (err) {
    console.error('Failed to load metadata cache:', err);
  }
  return { _version: 2 };
}

function saveMetadataCache(cache) {
  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save metadata cache:', err);
  }
}

// タグ抽出（先頭20,000文字制限でReDoS/フリーズ防止）
function extractTags(content) {
  const tags = [];
  if (!content) return tags;
  const safeContent = content.slice(0, 20000);
  
  const fmMatch = safeContent.match(/^---([\s\S]*?)---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    
    // tags: [A, B] 形式の抽出
    const inlineTagsMatch = fm.match(/(?:tags|tag):\s*\[(.*?)\]/i);
    if (inlineTagsMatch) {
      inlineTagsMatch[1].split(',').forEach(t => {
        const cleaned = t.trim().replace(/['"]/g, '');
        if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
      });
    } else {
      // tags: \n - A \n - B 形式の抽出
      const blockTagsMatch = fm.match(/(?:tags|tag):\s*\n((?:\s*-\s*\S+\s*\n?)+)/i);
      if (blockTagsMatch) {
        const lines = blockTagsMatch[1].split('\n');
        lines.forEach(line => {
          const match = line.match(/\s*-\s*(\S+)/);
          if (match) {
            const cleaned = match[1].trim().replace(/['"]/g, '');
            if (cleaned && !tags.includes(cleaned)) {
              tags.push(cleaned);
            }
          }
        });
      } else {
        // tags: A, B または tags: A (単一行カンマ区切りまたは単一) 形式の抽出
        const singleLineMatch = fm.match(/(?:tags|tag):\s*([^\n\r]+)/i);
        if (singleLineMatch) {
          singleLineMatch[1].split(',').forEach(t => {
            const cleaned = t.trim().replace(/['"]/g, '');
            if (cleaned.includes(' ')) {
              cleaned.split(/\s+/).forEach(subT => {
                const subCleaned = subT.trim().replace(/['"]/g, '');
                if (subCleaned && !tags.includes(subCleaned)) tags.push(subCleaned);
              });
            } else {
              if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
            }
          });
        }
      }
    }
  }

  // フロントマターがない場合のフォールバック（本文内の「タグ: ...」「tags: ...」行から抽出）
  if (tags.length === 0) {
    const lines = safeContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^(?:タグ|tags|tag)\s*[:：]\s*(.+)$/i);
      if (match) {
        const rawTags = match[1].trim();
        if (rawTags.startsWith('[') && rawTags.endsWith(']')) {
          rawTags.slice(1, -1).split(',').forEach(t => {
            const cleaned = t.trim().replace(/['"]/g, '');
            if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
          });
        } else {
          rawTags.split(/[,，、\s]+/).forEach(t => {
            const cleaned = t.trim().replace(/['"]/g, '').replace(/^#/, '');
            if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
          });
        }
      }
    }
  }

  return tags;
}

// Wikiリンク抽出（先頭20,000文字制限でReDoS/フリーズ防止）
function extractWikiLinks(content) {
  const links = [];
  if (!content) return links;
  const safeContent = content.slice(0, 20000);
  const textWithoutCode = safeContent.replace(/```[\s\S]*?```/g, '');
  
  const wikiLinkRegex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = wikiLinkRegex.exec(textWithoutCode)) !== null) {
    const rawLink = match[1];
    if (rawLink) {
      // パイプ | でのエイリアス分離
      const target = rawLink.split('|')[0].trim();
      // シャープ # でのヘッダー・ブロックアンカー分離
      const cleanTarget = target.split('#')[0].split('^')[0].trim().replace(/\.md$/, '');
      if (cleanTarget && !links.includes(cleanTarget)) {
        links.push(cleanTarget);
      }
    }
  }
  return links;
}

// 並行処理を制御する非同期プール
async function limitConcurrent(tasks, limit = 50) {
  const results = [];
  const executing = new Set();
  
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function getAllMarkdownFiles(dirPath, basePath, cache, cacheUpdated) {
  let results = [];
  try {
    const exists = await fs.promises.stat(dirPath).then(() => true).catch(() => false);
    if (!exists) return results;
    
    const list = await fs.promises.readdir(dirPath);
    const tasks = [];
    
    for (const file of list) {
      if (file.startsWith('.')) continue; // 隠しフォルダや.obsidian、.gitは無視
      const filePath = path.join(dirPath, file);
      
      tasks.push(async () => {
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isDirectory()) {
            const subResults = await getAllMarkdownFiles(filePath, basePath, cache, cacheUpdated);
            results = results.concat(subResults);
          } else if (file.endsWith('.md')) {
            const relativePath = path.relative(basePath, filePath).replace(/\\/g, '/');
            const mtimeStr = stat.mtime.toISOString();
            
            let cached = cache[relativePath];
            if (!cached || cached.updatedAt !== mtimeStr) {
              let content = '';
              try {
                content = await fs.promises.readFile(filePath, 'utf8');
              } catch (err) {
                console.error(err);
              }
              const tags = extractTags(content);
              const wikiLinks = extractWikiLinks(content);
              const isEmpty = content.split('\n').filter((l) => {
                const t = l.trim();
                return t !== '' && !t.startsWith('#') && !/^作成日時[:：]/i.test(t) && !/^(タグ|tags?)[:：]/i.test(t);
              }).length === 0;
              cached = {
                updatedAt: mtimeStr,
                tags,
                wikiLinks,
                isEmpty
              };
              cache[relativePath] = cached;
              cacheUpdated.value = true;
            }
            
            results.push({
              name: relativePath,
              path: filePath,
              updatedAt: mtimeStr,
              content: '', // 本文ロードをスキップ
              tags: cached.tags,
              wikiLinks: cached.wikiLinks,
              isEmpty: cached.isEmpty ?? false
            });
          }
        } catch (err) {
          console.error(`Error scanning path: ${filePath}`, err);
        }
      });
    }
    
    await limitConcurrent(tasks, 50);
  } catch (err) {
    console.error('Error directory traversal:', err);
  }
  return results;
}

ipcMain.handle('list-notes', async () => {
  try {
    const notesPath = appConfig.notesPath;
    const exists = await fs.promises.stat(notesPath).then(() => true).catch(() => false);
    if (!exists) {
      return [];
    }
    const cache = loadMetadataCache();
    const cacheUpdated = { value: false };
    const files = await getAllMarkdownFiles(notesPath, notesPath, cache, cacheUpdated);
    
    if (cacheUpdated.value) {
      saveMetadataCache(cache);
    }
    return files;
  } catch (err) {
    console.error('Failed to list notes:', err);
    return [];
  }
});

ipcMain.handle('read-note', async (event, filename) => {
  try {
    const notesPath = appConfig.notesPath;
    const filePath = resolveNotePath(notesPath, filename);
    const exists = await fs.promises.stat(filePath).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('File not found');
    }
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    console.error('Failed to read note:', err);
    throw err;
  }
});

ipcMain.handle('save-note', async (event, { filename, content }) => {
  try {
    const notesPath = appConfig.notesPath;

    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(notesPath, { recursive: true });
    }

    const filePath = resolveNotePath(notesPath, filename);

    fs.writeFileSync(filePath, content, 'utf8');

    return { success: true, path: filePath };
  } catch (err) {
    console.error('Failed to save note:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('rename-note', async (event, { oldFilename, newFilename }) => {
  try {
    const notesPath = appConfig.notesPath;
    const oldPath = resolveNotePath(notesPath, oldFilename);
    const newPath = resolveNotePath(notesPath, newFilename);

    if (!fs.existsSync(oldPath)) {
      return { success: false, error: '元のファイルが見つかりません。' };
    }
    if (fs.existsSync(newPath)) {
      return { success: false, error: '同名のファイルが既に存在します。' };
    }

    fs.renameSync(oldPath, newPath);



    return { success: true, path: newPath };
  } catch (err) {
    console.error('Failed to rename note:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-note', async (event, filename) => {
  try {
    const notesPath = appConfig.notesPath;
    const filePath = resolveNotePath(notesPath, filename);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'ファイルが見つかりません。' };
    }

    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    console.error('Failed to delete note:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('append-to-note', async (event, { filename, appendContent }) => {
  try {
    const notesPath = appConfig.notesPath;
    if (!fs.existsSync(notesPath)) fs.mkdirSync(notesPath, { recursive: true });

    const filePath = resolveNotePath(notesPath, filename);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + appendContent.trimStart(), 'utf8');
    return { success: true, path: filePath };
  } catch (err) {
    console.error('Failed to append to note:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync-git', async () => runGitSync());

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  return result.canceled ? null : result.filePaths[0];
});

// HTMLからタグを除去してプレーンテキストを抽出する簡易クリーニング関数
function cleanHtmlToText(html) {
  if (!html) return '';
  
  // 1. script, style, head, noscript, iframe, svg などの不要なセクションを丸ごと削除
  let clean = html.replace(/<(script|style|head|noscript|iframe|svg|canvas)\b[^>]*>([\s\S]*?)<\/\1>/gi, '');
  
  // 2. HTMLコメントを削除
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');
  
  // 3. HTMLタグを削除して空白に置き換え
  clean = clean.replace(/<[^>]+>/g, ' ');
  
  // 4. 特殊文字（実体参照）の簡易変換
  const entities = {
    '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&',
    '&quot;': '"', '&apos;': "'", '&#39;': "'", '&copy;': '©',
    '&reg;': '®'
  };
  for (const [entity, replacement] of Object.entries(entities)) {
    clean = clean.replaceAll(entity, replacement);
  }
  
  // 5. 余計なスペースや連続改行を整理
  clean = clean.replace(/[ \t]+/g, ' ');
  clean = clean.replace(/\n\s*\n+/g, '\n\n');
  
  return clean.trim();
}

// マスタータグリストの読み書き
ipcMain.handle('read-master-tags', async () => {
  try {
    const notesPath = appConfig.notesPath;
    if (!notesPath) return [];
    const filePath = path.join(notesPath, '_master_tags.json');
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
});

ipcMain.handle('save-master-tags', async (event, tags) => {
  try {
    const notesPath = appConfig.notesPath;
    if (!notesPath) return { success: false };
    if (!fs.existsSync(notesPath)) fs.mkdirSync(notesPath, { recursive: true });
    const filePath = path.join(notesPath, '_master_tags.json');
    fs.writeFileSync(filePath, JSON.stringify(tags, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// URLのWebページをフェッチしてクリーンなテキストを返すハンドラー
ipcMain.handle('fetch-url-text', async (event, url) => {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000) // 10秒タイムアウト
    });

    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }

    const html = await response.text();
    const cleanText = cleanHtmlToText(html);
    
    // トークン節約のため最大8000文字程度に制限して返す
    return cleanText.slice(0, 8000);
  } catch (err) {
    console.error('Failed to fetch URL:', err);
    throw new Error(`URLの中身の取得に失敗しました: ${err.message}`);
  }
});
