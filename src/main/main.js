const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const cryptoVault = require('./cryptoVault');

let mainWindow;

// ---------- 暗号化保管庫（private/）の状態 ----------
let vaultPassword = null;        // ロック解除中だけメモリ保持
let vaultAutoLockTimer = null;
const isPrivatePath = (name) => name.replace(/\\/g, '/').startsWith('private/');
const vaultFilePath = () => path.join(appConfig.notesPath, 'private', '_vault.json');

// private/_names.enc にタイムスタンプ→表示名マッピングを追記
// モバイル側が vault unlock 後に displayName を解決するために使う
async function updatePrivateNamesEnc(notesPath, timestampFilename, displayName) {
  const namesPath = path.join(notesPath, 'private', '_names.enc');
  let existing = {};
  try {
    if (fs.existsSync(namesPath)) {
      const raw = fs.readFileSync(namesPath, 'utf8');
      if (cryptoVault.isEncrypted(raw)) {
        const json = await cryptoVault.decryptAsync(raw, vaultPassword);
        existing = JSON.parse(json);
      }
    }
  } catch (e) {
    console.error('_names.enc read failed:', e.message);
  }
  existing[timestampFilename] = displayName;
  const encrypted = cryptoVault.encrypt(JSON.stringify(existing), vaultPassword);
  fs.writeFileSync(namesPath, encrypted, 'utf8');
}

function vaultAutoLockMinutes() {
  const n = Number(appConfig.vaultAutoLockMinutes);
  return Number.isFinite(n) ? n : 15;
}

function refreshVaultAutoLock() {
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  const mins = vaultAutoLockMinutes();
  if (vaultPassword && mins > 0) {
    vaultAutoLockTimer = setTimeout(() => {
      vaultPassword = null;
      mainWindow?.webContents.send('vault-locked');
    }, mins * 60000);
  }
}
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
  vaultAutoLockMinutes: 15,
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
    appConfig = { ...appConfig, ...newConfig };

    if (appConfig.notesPath && !fs.existsSync(appConfig.notesPath)) {
      fs.mkdirSync(appConfig.notesPath, { recursive: true });
    }

    fs.writeFileSync(configFilePath, JSON.stringify(appConfig, null, 2), 'utf8');

    ensureGitAttributes(appConfig.notesPath);

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

// ルート直下に取り残された .md を作成日時の notes/YYYY-MM/ へ移動（救済用）
function migrateRootMdFiles(notesPath) {
  const files = fs.readdirSync(notesPath, { withFileTypes: true });
  const mdFiles = files.filter(f => f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('_'));
  if (mdFiles.length === 0) return;

  for (const file of mdFiles) {
    const srcPath = path.join(notesPath, file.name);
    let ym;
    try {
      const content = fs.readFileSync(srcPath, 'utf8');
      ym = extractCreatedAt(content)
        ? yearMonthFromContent(content)
        : (() => { const d = fs.statSync(srcPath).mtime; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    } catch {
      ym = yearMonthFromContent('');
    }
    const destDir = path.join(notesPath, 'notes', ym);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, file.name);
    if (fs.existsSync(destPath)) {
      // 同名が既にあれば上書き（最新優先）
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    } else {
      fs.renameSync(srcPath, destPath);
    }
    console.log(`Migrated: ${srcPath} -> ${destPath}`);
  }
}

// runGitSyncInternal の同時実行を防ぐキュー（index.lock競合やrebase中の二重実行を防止）
let gitSyncQueue = Promise.resolve();
function runGitSync() {
  const result = gitSyncQueue.then(() => runGitSyncInternal());
  // エラーで後続がブロックされないよう、キュー自体は常に解決させる
  gitSyncQueue = result.catch(() => {});
  return result;
}

async function runGitSyncInternal() {
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

    // 1. ルート直下に取り残された .md を notes/YYYY-MM/ へ移動（救済）
    migrateRootMdFiles(notesPath);

    // 2. Gitにステージ＆コミット
    await git.add('.');
    const status = await git.status();

    if (status.files.length > 0) {
      await git.commit('Auto-commit: AI chat log');
    }

    // 3. リモートと同期 (Pull & Push)
    if (appConfig.gitRemoteUrl) {
      // モバイル版は常に origin の main へ書き込むため、PC版もブランチ名は main に固定する
      // （ローカルの現在ブランチ名に依存すると、master等の別ブランチに分岐してしまう）
      const branchName = 'main';
      await ensureOnMainBranch(git);

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

    mainWindow?.webContents.send('git-status-changed', 'success');
    return { success: true };
  } catch (err) {
    console.error('Git sync failed:', err);
    mainWindow?.webContents.send('git-status-changed', 'error', err.message);
    return { success: false, error: err.message };
  }
}


// ---------- アプリ終了前にpush ----------
let hasPendingCommit = false;
let isQuitting = false;

function setupQuitHandler(win) {
  win.on('close', (event) => {
    if (isQuitting) return; // 確認済みなら閉じる
    event.preventDefault();   // ウィンドウ破棄を同期的に阻止
    isQuitting = true;

    (async () => {
      // git 設定がない場合はダイアログなしで終了
      if (!appConfig.gitRemoteUrl || !appConfig.notesPath) {
        win.destroy();
        return;
      }

      let statusFiles = [];
      try {
        const git = simpleGit(appConfig.notesPath);
        const isRepo = await git.checkIsRepo().catch(() => false);
        if (isRepo) {
          await git.add('.');
          const status = await git.status();
          statusFiles = status.files;
          if (statusFiles.length > 0) {
            await git.commit('Auto-commit: AI chat log');
            hasPendingCommit = true;
          }
          if (!hasPendingCommit) {
            try {
              const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
              const log = await git.log([`origin/${branch}..HEAD`]);
              hasPendingCommit = log.total > 0;
            } catch { /* origin未設定は無視 */ }
          }
        }
      } catch (err) {
        console.error('Pre-quit status check failed:', err.message);
      }

      // 常にダイアログを表示（git エラーがあっても表示する）
      const added    = statusFiles.filter(f => f.index === 'A' || f.working_dir === '?').map(f => f.path);
      const modified = statusFiles.filter(f => f.index === 'M' || f.working_dir === 'M').map(f => f.path);
      const deleted  = statusFiles.filter(f => f.index === 'D' || f.working_dir === 'D').map(f => f.path);
      win.webContents.send('quit-confirm', { added, modified, deleted, hasPending: hasPendingCommit });

      // renderer からの応答を待つ（古いリスナーを除去してから登録）
      ipcMain.removeAllListeners('quit-response');
      ipcMain.once('quit-response', async (_, response) => {
        if (response === 'cancel') { isQuitting = false; return; }

        if (response === 'push') {
          const steps = [
            { label: 'git add .', done: false },
            { label: 'git commit', done: false },
            { label: 'git push origin', done: false },
          ];
          const send = (i, state, error) => {
            steps[i] = { ...steps[i], state, error };
            win.webContents.send('quit-progress', [...steps]);
          };

          try {
            send(0, 'running');
            send(0, 'done');
            send(1, 'running');
            send(1, 'done');
            send(2, 'running');
            await runGitSync();
            send(2, 'done');
            await new Promise(r => setTimeout(r, 800));
          } catch (err) {
            send(2, 'error', err.message);
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        hasPendingCommit = false;
        win.destroy();
      });
    })();
  });
}

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
  ensureGitAttributes(appConfig.notesPath);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  setupQuitHandler(mainWindow);

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
      // バージョンが違う古いキャッシュは再構築のためクリアする
      // v3: gitCreatedAt（本文から日時が取れない場合のgit追加日時）を追加
      if (cacheObj._version !== 3) {
        return { _version: 3 };
      }
      return cacheObj;
    }
  } catch (err) {
    console.error('Failed to load metadata cache:', err);
  }
  return { _version: 3 };
}

function saveMetadataCache(cache) {
  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save metadata cache:', err);
  }
}

// タグ抽出（先頭20,000文字制限でReDoS/フリーズ防止）
// 作成日時行 "作成日時: YYYY/MM/DD HH:mm" → ISO文字列（失敗時はnull）
// 見つからない場合は frontmatter の "date: YYYY-MM-DD" にもフォールバックする
function extractCreatedAt(content) {
  if (!content) return null;
  const m = content.match(/^作成日時[:：]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/m);
  if (m) {
    const [, y, mo, d, h = '0', min = '0'] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  // frontmatter (--- で囲まれた先頭ブロック) の date: を読む
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const dm = fm[1].match(/^date[:：]\s*['"]?(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/m);
    if (dm) {
      const [, y, mo, d, h = '0', min = '0'] = dm;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min));
      if (!isNaN(dt.getTime())) return dt.toISOString();
    }
  }
  return null;
}

// 本文から作成日時が取れないノート用のフォールバック。
// git にそのファイルが最初に追加された日時を返す（失敗時null）。
// mtime は git pull/checkout で一斉に書き換わり全ノートが同じ日時になるため、
// git 履歴に基づく安定した日時を優先する。
async function getGitAddedDate(notesPath, relativePath) {
  try {
    const git = simpleGit(notesPath);
    const out = await git.raw(['log', '--diff-filter=A', '--format=%aI', '-1', '--', relativePath]);
    const iso = (out || '').trim().split('\n')[0];
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// content の作成日時（なければ現在時刻）から "YYYY-MM" を返す
function yearMonthFromContent(content) {
  const iso = extractCreatedAt(content) ?? new Date().toISOString();
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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
      if (file === 'backup') continue; // モバイルと統一：backup/ は除外
      if (file.startsWith('_') && file.endsWith('.md')) continue; // モバイルと統一：_始まりファイルは除外
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

            // private/ 配下はキャッシュ不使用。ロック解除中は非同期復号してdisplayNameを取得
            if (isPrivatePath(relativePath)) {
              let displayName = null, tags = [], createdAt = null;
              if (vaultPassword) {
                try {
                  const rawContent = await fs.promises.readFile(filePath, 'utf8');
                  if (cryptoVault.isEncrypted(rawContent)) {
                    const decrypted = await cryptoVault.decryptAsync(rawContent, vaultPassword);
                    displayName = decrypted.split('\n')[0].replace(/^#+\s*/, '').trim() || null;
                    tags = extractTags(decrypted);
                    createdAt = extractCreatedAt(decrypted);
                  }
                } catch (err) {
                  console.error(`Private decrypt failed (${relativePath}):`, err.message);
                }
              }
              // 暗号化されていてロック中は本文から日時が取れないため git の追加日時を使う
              const gitCreatedAt = createdAt ? null : await getGitAddedDate(basePath, relativePath);
              results.push({ name: relativePath, path: filePath, updatedAt: createdAt ?? gitCreatedAt ?? mtimeStr, displayName, content: '', tags, wikiLinks: [], isEmpty: false });
              return;
            }

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
              const createdAt = extractCreatedAt(content);
              // 本文から日時が取れない場合のみ git の追加日時を引く（mtimeより正確で安定）
              const gitCreatedAt = createdAt ? null : await getGitAddedDate(basePath, relativePath);
              cached = { updatedAt: mtimeStr, createdAt, gitCreatedAt, tags, wikiLinks, isEmpty };
              cache[relativePath] = cached;
              cacheUpdated.value = true;
            }

            results.push({
              name: relativePath,
              path: filePath,
              updatedAt: cached.createdAt ?? cached.gitCreatedAt ?? mtimeStr,
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
    let content = await fs.promises.readFile(filePath, 'utf8');
    // private/ 配下の暗号化ノートは非同期復号して返す
    if (isPrivatePath(filename) && cryptoVault.isEncrypted(content)) {
      if (!vaultPassword) throw new Error('VAULT_LOCKED');
      try {
        content = await cryptoVault.decryptAsync(content, vaultPassword);
      } catch (decErr) {
        console.error('Decrypt error in read-note:', decErr.message);
        throw new Error('復号に失敗しました: ' + decErr.message);
      }
      refreshVaultAutoLock();
    }
    return content;
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

    let relName = filename.endsWith('.md') ? filename : `${filename}.md`;
    // パス区切りを含まない = 新規ノート → 作成日時の notes/YYYY-MM/ へ振り分け
    if (!relName.includes('/') && !relName.includes('\\')) {
      const ym = yearMonthFromContent(content);
      relName = `notes/${ym}/${relName}`;
    }

    // private/ の新規ファイルはタイムスタンプIDで保存（GitHub上でファイル名を匿名化）
    // _names.enc に表示名マッピングを追加してモバイルでも名前解決できるようにする
    if (isPrivatePath(relName) && !relName.startsWith('private/_')) {
      const basename = path.basename(relName);
      if (!/^\d{13,}\.md$/.test(basename)) {
        const displayName = basename.replace(/\.md$/i, '');
        const timestampFilename = `${Date.now()}.md`;
        relName = `private/${timestampFilename}`;
        // _names.enc を非同期で更新（失敗しても保存自体は続行）
        if (vaultPassword) {
          updatePrivateNamesEnc(notesPath, timestampFilename, displayName).catch(err =>
            console.error('_names.enc update failed:', err.message)
          );
        }
      }
    }

    const filePath = resolveNotePath(notesPath, relName);

    // private/ 配下は暗号化して保存
    let toWrite = content;
    if (isPrivatePath(relName)) {
      if (!vaultPassword) return { success: false, error: 'VAULT_LOCKED' };
      toWrite = cryptoVault.encrypt(content, vaultPassword);
      refreshVaultAutoLock();
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, toWrite, 'utf8');
    return { success: true, path: filePath, name: relName };
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
    updateIndex();
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
    updateIndex();
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
    if (isPrivatePath(filename)) {
      if (!vaultPassword) return { success: false, error: 'VAULT_LOCKED' };
      let existing = '';
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        existing = cryptoVault.isEncrypted(raw) ? cryptoVault.decrypt(raw, vaultPassword) : raw;
      }
      const merged = existing.trimEnd() + '\n\n' + appendContent.trimStart();
      fs.writeFileSync(filePath, cryptoVault.encrypt(merged, vaultPassword), 'utf8');
      refreshVaultAutoLock();
      return { success: true, path: filePath };
    }
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + appendContent.trimStart(), 'utf8');
    return { success: true, path: filePath };
  } catch (err) {
    console.error('Failed to append to note:', err);
    return { success: false, error: err.message };
  }
});

// ---------- 暗号化保管庫の IPC ----------
// 保管庫の状態を返す
ipcMain.handle('vault-status', async () => {
  const exists = fs.existsSync(vaultFilePath());
  return { exists, unlocked: !!vaultPassword, autoLockMinutes: vaultAutoLockMinutes() };
});

// 保管庫を新規作成（パスワード設定）
ipcMain.handle('vault-setup', async (event, { password }) => {
  try {
    if (!password) return { success: false, error: 'パスワードが空です' };
    const privDir = path.join(appConfig.notesPath, 'private');
    fs.mkdirSync(privDir, { recursive: true });
    if (fs.existsSync(vaultFilePath())) {
      return { success: false, error: '保管庫は既に存在します' };
    }
    const token = cryptoVault.createVerifyToken(password);
    fs.writeFileSync(vaultFilePath(), JSON.stringify({ version: 1, token }, null, 2), 'utf8');
    vaultPassword = password;
    refreshVaultAutoLock();
    return { success: true };
  } catch (err) {
    console.error('vault-setup failed:', err);
    return { success: false, error: err.message };
  }
});

// パスワードでロック解除
ipcMain.handle('vault-unlock', async (event, { password }) => {
  try {
    if (!fs.existsSync(vaultFilePath())) return { success: false, error: '保管庫がありません' };
    const { token } = JSON.parse(fs.readFileSync(vaultFilePath(), 'utf8'));
    if (!cryptoVault.verifyPassword(token, password)) {
      return { success: false, error: 'パスワードが違います' };
    }
    vaultPassword = password;
    refreshVaultAutoLock();
    return { success: true };
  } catch (err) {
    console.error('vault-unlock failed:', err);
    return { success: false, error: err.message };
  }
});

// 手動ロック
ipcMain.handle('vault-lock', async () => {
  vaultPassword = null;
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  return { success: true };
});

ipcMain.handle('sync-git', async () => runGitSync());

// モバイル版が常に main へ書き込むため、PC版もブランチをmainに固定する共通処理
async function ensureOnMainBranch(git) {
  try {
    const branches = await git.branch();
    if (branches.current && branches.current !== 'main') {
      if (branches.all.includes('main')) {
        await git.checkout('main');
      } else {
        await git.checkoutLocalBranch('main');
      }
    }
  } catch {
    try { await git.checkoutLocalBranch('main'); } catch { /* 既にmainの場合は無視 */ }
  }
}

// 起動時の git pull のみ（push しない）
async function startupGitPullInternal() {
  const notesPath = appConfig.notesPath;
  if (!notesPath || !appConfig.gitRemoteUrl) return { success: true, skipped: true };
  if (!fs.existsSync(notesPath)) return { success: true, skipped: true };
  try {
    const git = simpleGit(notesPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { success: true, skipped: true };
    await ensureOnMainBranch(git);
    // 未コミット変更（_index.json など）が残っていても rebase が失敗しないよう --autostash
    await git.pull('origin', 'main', { '--rebase': 'true', '--autostash': null });
    await updateIndex();
    return { success: true };
  } catch (err) {
    console.warn('Startup git pull failed:', err.message);
    return { success: false, error: err.message };
  }
}

// runGitSync/pullOnly と同じキューに乗せて、起動直後の手動操作との衝突を防ぐ
ipcMain.handle('startup-git-pull', async () => {
  const result = gitSyncQueue.then(() => startupGitPullInternal());
  gitSyncQueue = result.catch(() => {});
  return result;
});

// ---------- 手動 git pull（リボンバーの「プル」ボタン用） ----------
async function pullOnlyInternal() {
  const notesPath = appConfig.notesPath;
  if (!notesPath || !appConfig.gitRemoteUrl) {
    return { success: false, error: 'Gitリモートが設定されていません。' };
  }
  if (!fs.existsSync(notesPath)) {
    return { success: false, error: 'Notes folder was not found.' };
  }
  try {
    const git = simpleGit(notesPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { success: false, error: 'Gitリポジトリが初期化されていません。' };
    }
    await ensureOnMainBranch(git);
    // updateIndex 等でノートリポジトリに未コミット変更（_index.json など）が残っていると
    // rebase が拒否されるため、--autostash で自動退避・自動復元しながら pull する
    await git.pull('origin', 'main', { '--rebase': 'true', '--autostash': null });
    mainWindow?.webContents.send('notes-changed');
    return { success: true };
  } catch (err) {
    console.error('Git pull failed:', err.message);
    return { success: false, error: err.message };
  }
}

// runGitSync と同じキューに乗せて、pushとpullの同時実行を防ぐ
function pullOnly() {
  const result = gitSyncQueue.then(() => pullOnlyInternal());
  gitSyncQueue = result.catch(() => {});
  return result;
}

ipcMain.handle('git-pull-only', async () => pullOnly());

// ノートリポジトリに .gitattributes を設定（競合防止）
function ensureGitAttributes(notesPath) {
  if (!notesPath || !fs.existsSync(notesPath)) return;
  const gitAttrsPath = path.join(notesPath, '.gitattributes');
  const desired = [
    '# 追記系ファイルは行単位マージで競合を防ぐ',
    'moc/_All_Notes_MOC.md merge=union',
    '',
  ].join('\n');
  try {
    const existing = fs.existsSync(gitAttrsPath) ? fs.readFileSync(gitAttrsPath, 'utf8') : '';
    if (!existing.includes('merge=union')) {
      fs.writeFileSync(gitAttrsPath, existing ? existing.trimEnd() + '\n' + desired : desired, 'utf8');
    }
  } catch (err) {
    console.warn('ensureGitAttributes failed:', err.message);
  }
}

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-md-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'MDファイルを開く',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: appConfig.notesPath,
  });
  if (result.canceled) return null;
  // notesPath 相対パスに変換して返す
  return result.filePaths.map((fp) => {
    const rel = path.relative(appConfig.notesPath, fp).replace(/\\/g, '/');
    return { absolutePath: fp, relativePath: rel };
  });
});

ipcMain.handle('save-md-file-dialog', async (event, defaultDir) => {
  const defaultPath = defaultDir
    ? path.join(appConfig.notesPath, defaultDir, '新規ノート.md')
    : path.join(appConfig.notesPath, '新規ノート.md');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '新規MDファイルを作成',
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const rel = path.relative(appConfig.notesPath, result.filePath).replace(/\\/g, '/');
  return { absolutePath: result.filePath, relativePath: rel };
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

// _index.json を生成・保存（ノート操作後に呼ぶ）
async function updateIndex() {
  try {
    const notesPath = appConfig.notesPath;
    if (!notesPath || !fs.existsSync(notesPath)) return;
    const cache = loadMetadataCache();
    const cacheUpdated = { value: false };
    const files = await getAllMarkdownFiles(notesPath, notesPath, cache, cacheUpdated);
    if (cacheUpdated.value) saveMetadataCache(cache);
    // _index.json はモバイルが updatedAt 補完にのみ使う。
    // Contents API の1MB上限を避けるため、必要な {path, updatedAt} だけをインデントなしで出力する。
    const index = files
      .filter(f => !f.name.startsWith('_'))
      .map(f => ({
        path: f.name,
        updatedAt: f.updatedAt,
      }));
    fs.writeFileSync(path.join(notesPath, '_index.json'), JSON.stringify(index), 'utf8');
  } catch (err) {
    console.error('Failed to update index:', err);
  }
}

// フォルダ構成移行処理
const migrationFlagPath = path.join(appUserDataPath, 'migration_v2_done');

async function runFolderMigration() {
  const notesPath = appConfig.notesPath;
  if (!notesPath || !fs.existsSync(notesPath)) return { skipped: true };
  if (fs.existsSync(migrationFlagPath)) return { skipped: true };

  const log = [];
  try {
    // サブフォルダを作成
    for (const dir of ['notes', 'memos', 'moc']) {
      const dirPath = path.join(notesPath, dir);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    }

    // ルート直下の .md ファイルを notes/ へ移行
    const rootEntries = fs.readdirSync(notesPath, { withFileTypes: true });
    const rootMdFiles = rootEntries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_'))
      .map(e => e.name);

    for (const file of rootMdFiles) {
      const src = path.join(notesPath, file);
      const dst = path.join(notesPath, 'notes', file);
      // コピー後に元ファイルを削除
      fs.copyFileSync(src, dst);
      if (fs.existsSync(dst)) {
        fs.unlinkSync(src);
        log.push(file);
      }
    }

    fs.writeFileSync(migrationFlagPath, new Date().toISOString(), 'utf8');
    await updateIndex();
    return { success: true, moved: log };
  } catch (err) {
    console.error('Migration failed:', err);
    return { success: false, error: err.message, moved: log };
  }
}

ipcMain.handle('check-migration', async () => {
  return { done: fs.existsSync(migrationFlagPath) };
});

ipcMain.handle('run-migration', async () => {
  return runFolderMigration();
});

ipcMain.handle('update-index', async () => {
  await updateIndex();
  return { success: true };
});

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

// カスタムプロンプトの読み書き（モバイル版と共有: _custom_prompts.json）
ipcMain.handle('read-custom-prompts', async () => {
  try {
    const notesPath = appConfig.notesPath;
    if (!notesPath) return [];
    const filePath = path.join(notesPath, '_custom_prompts.json');
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
});

ipcMain.handle('save-custom-prompts', async (event, prompts) => {
  try {
    const notesPath = appConfig.notesPath;
    if (!notesPath) return { success: false };
    if (!fs.existsSync(notesPath)) fs.mkdirSync(notesPath, { recursive: true });
    const filePath = path.join(notesPath, '_custom_prompts.json');
    fs.writeFileSync(filePath, JSON.stringify(prompts, null, 2), 'utf8');
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
