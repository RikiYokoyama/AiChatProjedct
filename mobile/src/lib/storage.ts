// ノートと設定の永続化レイヤー
// ネイティブ (iOS/Android): Capacitor Filesystem の Documents ディレクトリに .md として保存
// Web (開発時): localStorage にフォールバック
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Note, buildNote } from './notes';

const NOTES_DIR = 'notes';
const isNative = Capacitor.isNativePlatform();

export interface CustomPrompt {
  id: string;
  name: string;
  prompt: string;
}

export interface AppConfig {
  geminiApiKey: string;
  gitRemoteUrl: string; // https://TOKEN@github.com/owner/repo.git
  autoSync: boolean;
  customPrompts: CustomPrompt[];
}

export const emptyConfig: AppConfig = {
  geminiApiKey: '',
  gitRemoteUrl: '',
  autoSync: false,
  customPrompts: [],
};

// ---------- 設定 ----------

export async function loadConfig(): Promise<AppConfig> {
  const { value } = await Preferences.get({ key: 'app-config' });
  if (!value) return { ...emptyConfig };
  try {
    return { ...emptyConfig, ...JSON.parse(value) };
  } catch {
    return { ...emptyConfig };
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await Preferences.set({ key: 'app-config', value: JSON.stringify(config) });
}

// ---------- ノートメタデータ（お気に入り・アーカイブ） ----------

interface NoteMeta {
  favorites: string[];
  archived: string[];
}

export async function loadNoteMeta(): Promise<NoteMeta> {
  const { value } = await Preferences.get({ key: 'note-meta' });
  if (!value) return { favorites: [], archived: [] };
  try {
    return { favorites: [], archived: [], ...JSON.parse(value) };
  } catch {
    return { favorites: [], archived: [] };
  }
}

export async function saveNoteMeta(meta: NoteMeta): Promise<void> {
  await Preferences.set({ key: 'note-meta', value: JSON.stringify(meta) });
}

// ---------- ノート本体 ----------

async function ensureNotesDir() {
  try {
    await Filesystem.mkdir({ path: NOTES_DIR, directory: Directory.Documents, recursive: true });
  } catch {
    // 既に存在する場合は無視
  }
}

function webKey(name: string) {
  return `note:${name}`;
}

export async function listNotes(): Promise<Note[]> {
  if (!isNative) {
    const notes: Note[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('note:')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const { content, updatedAt } = JSON.parse(raw);
        notes.push(buildNote(key.slice(5), content, updatedAt));
      } catch {
        // 破損エントリは無視
      }
    }
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  await ensureNotesDir();
  const result = await Filesystem.readdir({ path: NOTES_DIR, directory: Directory.Documents });
  const notes: Note[] = [];
  for (const file of result.files) {
    if (!file.name.toLowerCase().endsWith('.md')) continue;
    try {
      const read = await Filesystem.readFile({
        path: `${NOTES_DIR}/${file.name}`,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      const updatedAt = file.mtime ? new Date(file.mtime).toISOString() : new Date().toISOString();
      notes.push(buildNote(file.name, read.data as string, updatedAt));
    } catch {
      // 読めないファイルはスキップ
    }
  }
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readNote(name: string): Promise<string> {
  if (!isNative) {
    const raw = localStorage.getItem(webKey(name));
    if (!raw) return '';
    try {
      return JSON.parse(raw).content ?? '';
    } catch {
      return '';
    }
  }
  const read = await Filesystem.readFile({
    path: `${NOTES_DIR}/${name}`,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
  return read.data as string;
}

export async function writeNote(name: string, content: string): Promise<void> {
  if (!isNative) {
    localStorage.setItem(webKey(name), JSON.stringify({ content, updatedAt: new Date().toISOString() }));
    return;
  }
  await ensureNotesDir();
  await Filesystem.writeFile({
    path: `${NOTES_DIR}/${name}`,
    directory: Directory.Documents,
    data: content,
    encoding: Encoding.UTF8,
  });
}

export async function deleteNote(name: string): Promise<void> {
  if (!isNative) {
    localStorage.removeItem(webKey(name));
    return;
  }
  await Filesystem.deleteFile({ path: `${NOTES_DIR}/${name}`, directory: Directory.Documents });
}

export async function renameNote(oldName: string, newName: string): Promise<void> {
  const content = await readNote(oldName);
  await writeNote(newName, content);
  await deleteNote(oldName);
}
