// クイックチャット用の保存ロジック。1会話=1ノートとして、送信ごとに新規作成または追記する。
// 書式はPC版・PC版Liteと同じ（# タイトル / 作成日時 / --- ## User ## AI / 末尾1行のタグ）
import { generateNoteTags, generateNoteTitle } from './gemini';
import {
  addEntryToIndex,
  fetchNoteContentFromGitHub,
  saveNoteToGitHub,
} from './githubSync';
import {
  applyTagsToContent,
  cleanFilename,
  extractCreatedAt,
  extractTags,
  initialNoteContent,
  sanitizeTags,
} from './notes';
import { readNote, writeNote } from './storage';

// 気軽に調べる用途のため簡潔さを優先。[[ ]] はノートを開いたときにリンクとして機能する
export const QUICK_SYSTEM_PROMPT =
  'ユーザーの質問に日本語で正確かつ簡潔に答えてください。事実関係は厳格に確認し、不確かな内容は推測せず「不明」と明示してください。回答の重要な概念・ツール名・固有名詞は Obsidian の内部リンク形式 `[[キーワード]]` で囲んでください（過剰な繰り返しや日常語へのリンクは避ける）。';

// 1つの会話（=1つのノート）の保存状態。新規チャットで作り直す
export interface QuickSession {
  path: string | null; // GitHub上のパス（未設定時は端末内のファイル名）。null = 未作成
  remote: boolean;
  content: string;
  sha?: string;
}

export function newQuickSession(): QuickSession {
  return { path: null, remote: false, content: '' };
}

export interface SaveTurnArgs {
  session: QuickSession;
  gitRemoteUrl: string;
  geminiApiKey: string;
  masterTags: string[];
  user: string;
  ai: string;
}

export interface SaveTurnResult {
  created: boolean;
  path: string;
  addedMasterTags: string[];
}

const TITLE_FAILED = 'AIチャット';

function fallbackTitle(userPrompt: string): string {
  return userPrompt.replace(/\s+/g, ' ').trim().slice(0, 20) || TITLE_FAILED;
}

// PC版と同じ notes/YYYY-MM/ 。UTC基準のcurrentYearMonth()は月初の日本時間でずれるためローカル時刻で算出する
function localYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// 既存ノートを上書きしないよう、同名があれば " (2)" を付けて空きを探す
async function findFreeRemotePath(gitRemoteUrl: string, dir: string, filename: string): Promise<string> {
  const base = filename.replace(/\.md$/i, '');
  for (let i = 1; i <= 20; i++) {
    const candidate = i === 1 ? `${dir}/${base}.md` : `${dir}/${base} (${i}).md`;
    try {
      await fetchNoteContentFromGitHub(gitRemoteUrl, candidate);
    } catch (err) {
      if (/GitHub API error 404/.test(errorMessage(err))) return candidate;
      throw err;
    }
  }
  throw new Error('同名のノートが多すぎるため保存できません。タイトルを変えて再度お試しください。');
}

async function findFreeLocalName(filename: string): Promise<string> {
  const base = filename.replace(/\.md$/i, '');
  for (let i = 1; i <= 20; i++) {
    const candidate = i === 1 ? `${base}.md` : `${base} (${i}).md`;
    try {
      if (!(await readNote(candidate))) return candidate;
    } catch {
      return candidate; // ネイティブでは未作成ファイルの読み込みが例外になる
    }
  }
  throw new Error('同名のノートが多すぎるため保存できません。タイトルを変えて再度お試しください。');
}

// 1往復分（User/AI）を保存する。成功したときだけsessionを更新する
export async function saveQuickTurn(args: SaveTurnArgs): Promise<SaveTurnResult> {
  const { session, gitRemoteUrl, geminiApiKey, masterTags, user, ai } = args;
  const block = `---\n\n## User\n\n${user.trim()}\n\n## AI\n\n${ai.trim()}`;
  const isNew = session.path === null;

  const [rawTitle, rawTags] = await Promise.all([
    isNew ? generateNoteTitle(geminiApiKey, user, ai) : Promise.resolve(''),
    generateNoteTags(geminiApiKey, user, ai),
  ]);
  const newTags = sanitizeTags(rawTags, masterTags);
  const known = new Set(masterTags.map((t) => t.toLowerCase()));
  const addedMasterTags = newTags.filter((t) => !known.has(t.toLowerCase()));

  if (isNew) {
    const title = (rawTitle && rawTitle !== TITLE_FAILED ? rawTitle : fallbackTitle(user))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);
    const content = applyTagsToContent(`${initialNoteContent(title)}${block}\n`, newTags, masterTags);
    const filename = cleanFilename(title);
    const remote = !!gitRemoteUrl;

    let path: string;
    let sha: string | undefined;
    if (remote) {
      path = await findFreeRemotePath(gitRemoteUrl, `notes/${localYearMonth()}`, filename);
      sha = await saveNoteToGitHub(gitRemoteUrl, path, content);
      // 他の画面の一覧にも出るよう索引へ追加（失敗しても会話の保存には影響させない）
      await addEntryToIndex(gitRemoteUrl, {
        name: path.split('/').pop() ?? path,
        path,
        updatedAt: extractCreatedAt(content) ?? new Date().toISOString(),
        isMoc: false,
      });
    } else {
      path = await findFreeLocalName(filename);
      await writeNote(path, content);
    }
    session.path = path;
    session.remote = remote;
    session.content = content;
    session.sha = sha;
    return { created: true, path, addedMasterTags };
  }

  // 追記。タグ行は常に末尾1行に統合し直す
  const build = (base: string) =>
    applyTagsToContent(`${base.trimEnd()}\n\n${block}\n`, [...extractTags(base), ...newTags], masterTags);
  const path = session.path as string;
  let content = build(session.content);

  if (session.remote) {
    let sha: string | undefined;
    try {
      sha = await saveNoteToGitHub(gitRemoteUrl, path, content, session.sha);
    } catch (err) {
      // PC側の更新などでshaが古くなった場合は、最新を取り直して1回だけ再試行する
      if (!/push error (409|422)/.test(errorMessage(err))) throw err;
      const latest = await fetchNoteContentFromGitHub(gitRemoteUrl, path);
      content = build(latest.content);
      sha = await saveNoteToGitHub(gitRemoteUrl, path, content, latest.sha);
    }
    session.sha = sha;
  } else {
    await writeNote(path, content);
  }
  session.content = content;
  return { created: false, path, addedMasterTags };
}
