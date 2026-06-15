// モバイル向け軽量 GitHub 同期
// git クローンの代わりに GitHub Git Trees API を使い、.md ファイルを archive/YYYY-MM/ 階層とローカルのフラット階層で双方向同期する。
import { Preferences } from '@capacitor/preferences';
import { listNotes, writeNote } from './storage';

const API = 'https://api.github.com';

export interface SyncResult {
  pushed: string[];
  pulled: string[];
  conflicts: string[];
}

interface SyncState {
  // ファイル名 → 最後に同期した時点のコンテンツハッシュ
  baseHashes: Record<string, string>;
  // ファイル名 → GitHub上の現在のリポジトリ内フルパス (例: "archive/2026-06/memo.md")
  remotePaths: Record<string, string>;
}

async function loadSyncState(): Promise<SyncState> {
  const { value } = await Preferences.get({ key: 'github-sync-state' });
  if (!value) return { baseHashes: {}, remotePaths: {} };
  try {
    const parsed = JSON.parse(value);
    return { baseHashes: {}, remotePaths: {}, ...parsed };
  } catch {
    return { baseHashes: {}, remotePaths: {} };
  }
}

async function saveSyncState(state: SyncState): Promise<void> {
  await Preferences.set({ key: 'github-sync-state', value: JSON.stringify(state) });
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface RemoteFile {
  name: string;      // ローカル用ファイル名 (例: "memo.md")
  path: string;      // GitHub上のフルパス (例: "archive/2026-06/memo.md")
  sha: string;
  content: string;
}

export class GitHubSync {
  constructor(
    private token: string,
    private repo: string, // owner/repo
    private branch: string = 'main',
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // Git Trees API を使ってリポジトリ内すべてのファイルを再帰的に取得
  private async fetchRemoteList(): Promise<{ name: string; path: string; sha: string }[]> {
    const res = await fetch(
      `${API}/repos/${this.repo}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`,
      { headers: this.headers() }
    );
    if (res.status === 404) return []; // 空のリポジトリ
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const tree = data.tree as { path: string; sha: string; type: string }[];
    
    // archive/ フォルダ以下、またはルートにある .md ファイルを対象とする (backup/ は除外)
    return tree
      .filter((i) => i.type === 'blob' && i.path.toLowerCase().endsWith('.md') && !i.path.startsWith('backup/'))
      .map((i) => {
        const parts = i.path.split('/');
        const name = parts[parts.length - 1];
        return { name, path: i.path, sha: i.sha };
      });
  }

  private async fetchRemoteFile(remotePath: string): Promise<RemoteFile> {
    const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(
      `${API}/repos/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const name = remotePath.split('/').pop() || remotePath;
    return { name, path: remotePath, sha: data.sha, content: decodeBase64Utf8(data.content) };
  }

  private async putFile(remotePath: string, content: string, sha?: string): Promise<void> {
    const body: Record<string, unknown> = {
      message: `sync: update ${remotePath} from mobile`,
      content: encodeBase64Utf8(content),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${API}/repos/${this.repo}/contents/${encodedPath}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub push error ${res.status} (repo: ${this.repo}, path: ${remotePath}): ${body}`);
    }
  }

  // 新しいアーカイブ用パスを生成する (例: archive/YYYY-MM/name.md)
  private generateArchivePath(name: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `archive/${year}-${month}/${name}`;
  }

  async sync(): Promise<SyncResult> {
    if (!this.token || !this.repo) {
      throw new Error('GitリモートURLが正しく設定されていません。形式: https://TOKEN@github.com/owner/repo.git');
    }

    const result: SyncResult = { pushed: [], pulled: [], conflicts: [] };
    const state = await loadSyncState();
    const localNotes = await listNotes();
    const remoteList = await this.fetchRemoteList();
    
    // マッピングの整理
    const remoteMap = new Map(remoteList.map((r) => [r.name, r]));
    const localMap = new Map(localNotes.map((n) => [n.name, n]));

    // 1. ローカルにあるノートの処理
    for (const note of localNotes) {
      const localHash = await sha256(note.content);
      const baseHash = state.baseHashes[note.name];
      const remote = remoteMap.get(note.name);

      if (!remote) {
        // リモートに存在しない新規ファイル → 新しいアーカイブパスを作成してプッシュ
        const archivePath = this.generateArchivePath(note.name);
        await this.putFile(archivePath, note.content);
        state.baseHashes[note.name] = localHash;
        state.remotePaths[note.name] = archivePath;
        result.pushed.push(note.name);
        continue;
      }

      // リモートにファイルがある場合
      const remotePath = remote.path;
      const remoteFile = await this.fetchRemoteFile(remotePath);
      const remoteHash = await sha256(remoteFile.content);

      // パス情報を更新
      state.remotePaths[note.name] = remotePath;

      if (remoteHash === localHash) {
        state.baseHashes[note.name] = localHash;
        continue; // 変更なし
      }

      const localChanged = baseHash !== localHash;
      const remoteChanged = baseHash !== remoteHash;

      if (localChanged && remoteChanged && baseHash) {
        // 双方変更 → 競合回避: リモート版を "(conflict).md" としてローカルに保存し、ローカルの内容を上書きプッシュ
        const conflictName = note.name.replace(/\.md$/i, '') + ' (conflict).md';
        await writeNote(conflictName, remoteFile.content);
        
        await this.putFile(remotePath, note.content, remoteFile.sha);
        state.baseHashes[note.name] = localHash;
        result.conflicts.push(note.name);
      } else if (remoteChanged && !localChanged) {
        // リモートのみ変更 → プル (ローカルに上書き)
        await writeNote(note.name, remoteFile.content);
        state.baseHashes[note.name] = remoteHash;
        result.pulled.push(note.name);
      } else {
        // ローカルのみ変更（または初回同期） → プッシュ
        await this.putFile(remotePath, note.content, remoteFile.sha);
        state.baseHashes[note.name] = localHash;
        result.pushed.push(note.name);
      }
    }

    // 2. リモートにだけ新しく追加されたノートの処理
    for (const remote of remoteList) {
      if (localMap.has(remote.name)) continue;
      
      const remoteFile = await this.fetchRemoteFile(remote.path);
      await writeNote(remote.name, remoteFile.content);
      state.baseHashes[remote.name] = await sha256(remoteFile.content);
      state.remotePaths[remote.name] = remote.path;
      result.pulled.push(remote.name);
    }

    // 保存状態のクリーンアップ (ローカルで削除されたファイルの削除など)
    const activeNames = new Set(localNotes.map(n => n.name));
    for (const key in state.baseHashes) {
      if (!activeNames.has(key) && !remoteMap.has(key)) {
        delete state.baseHashes[key];
        delete state.remotePaths[key];
      }
    }

    await saveSyncState(state);
    return result;
  }
}

function parseRemoteUrl(url: string): { token: string; repo: string; branch: string } {
  // https://TOKEN@github.com/owner/repo.git
  const m = url.match(/https:\/\/([^@]+)@github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (!m) return { token: '', repo: '', branch: 'main' };
  return { token: m[1], repo: m[2], branch: 'main' };
}

export async function syncNotes(gitRemoteUrl: string): Promise<SyncResult> {
  const { token, repo, branch } = parseRemoteUrl(gitRemoteUrl);
  return new GitHubSync(token, repo, branch).sync();
}
