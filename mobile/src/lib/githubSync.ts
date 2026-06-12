// モバイル向け軽量 GitHub 同期
// git クローンの代わりに GitHub Contents API を使い、.md ファイル単位で双方向同期する。
// 競合回避: 各ファイルの「最後に同期したコンテンツのハッシュ」を保持し、
//   - ローカルのみ変更 → push
//   - リモートのみ変更 → pull
//   - 両方変更        → リモートを「<name> (conflict).md」として保存し、ローカルを push
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
}

async function loadSyncState(): Promise<SyncState> {
  const { value } = await Preferences.get({ key: 'github-sync-state' });
  if (!value) return { baseHashes: {} };
  try {
    return { baseHashes: {}, ...JSON.parse(value) };
  } catch {
    return { baseHashes: {} };
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
  name: string;
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

  private async fetchRemoteList(): Promise<{ name: string; sha: string }[]> {
    const res = await fetch(`${API}/repos/${this.repo}/contents/?ref=${encodeURIComponent(this.branch)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return []; // 空のリポジトリ
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    const items = (await res.json()) as { name: string; sha: string; type: string }[];
    return items.filter((i) => i.type === 'file' && i.name.toLowerCase().endsWith('.md'));
  }

  private async fetchRemoteFile(name: string): Promise<RemoteFile> {
    const res = await fetch(
      `${API}/repos/${this.repo}/contents/${encodeURIComponent(name)}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { name, sha: data.sha, content: decodeBase64Utf8(data.content) };
  }

  private async putFile(name: string, content: string, sha?: string): Promise<void> {
    const body: Record<string, unknown> = {
      message: `sync: update ${name} from mobile`,
      content: encodeBase64Utf8(content),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`${API}/repos/${this.repo}/contents/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub push error ${res.status}: ${await res.text()}`);
  }

  async sync(): Promise<SyncResult> {
    if (!this.token || !this.repo) {
      throw new Error('GitHubトークンとリポジトリ（owner/repo）を設定してください。');
    }

    const result: SyncResult = { pushed: [], pulled: [], conflicts: [] };
    const state = await loadSyncState();
    const localNotes = await listNotes();
    const remoteList = await this.fetchRemoteList();
    const remoteMap = new Map(remoteList.map((r) => [r.name, r]));
    const localMap = new Map(localNotes.map((n) => [n.name, n]));

    // ローカルにあるノートの処理
    for (const note of localNotes) {
      const localHash = await sha256(note.content);
      const baseHash = state.baseHashes[note.name];
      const remote = remoteMap.get(note.name);

      if (!remote) {
        // リモートに無い → 新規 push
        await this.putFile(note.name, note.content);
        state.baseHashes[note.name] = localHash;
        result.pushed.push(note.name);
        continue;
      }

      const remoteFile = await this.fetchRemoteFile(note.name);
      const remoteHash = await sha256(remoteFile.content);

      if (remoteHash === localHash) {
        state.baseHashes[note.name] = localHash;
        continue; // 同一
      }

      const localChanged = baseHash !== localHash;
      const remoteChanged = baseHash !== remoteHash;

      if (localChanged && remoteChanged && baseHash) {
        // 双方変更 → リモート版を競合ファイルとして退避し、ローカルを push
        const conflictName = note.name.replace(/\.md$/i, '') + ' (conflict).md';
        await writeNote(conflictName, remoteFile.content);
        await this.putFile(note.name, note.content, remoteFile.sha);
        state.baseHashes[note.name] = localHash;
        result.conflicts.push(note.name);
      } else if (remoteChanged && !localChanged) {
        // リモートのみ変更 → pull
        await writeNote(note.name, remoteFile.content);
        state.baseHashes[note.name] = remoteHash;
        result.pulled.push(note.name);
      } else {
        // ローカルのみ変更（または初回同期） → push
        await this.putFile(note.name, note.content, remoteFile.sha);
        state.baseHashes[note.name] = localHash;
        result.pushed.push(note.name);
      }
    }

    // リモートにだけあるノート → pull
    for (const remote of remoteList) {
      if (localMap.has(remote.name)) continue;
      const remoteFile = await this.fetchRemoteFile(remote.name);
      await writeNote(remote.name, remoteFile.content);
      state.baseHashes[remote.name] = await sha256(remoteFile.content);
      result.pulled.push(remote.name);
    }

    await saveSyncState(state);
    return result;
  }
}

export async function syncNotes(token: string, repo: string, branch: string): Promise<SyncResult> {
  return new GitHubSync(token, repo, branch || 'main').sync();
}
