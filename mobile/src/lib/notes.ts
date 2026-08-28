export interface Note {
  name: string; // ファイル名 (.md付き)
  updatedAt: string;
  content: string; // 空文字 = 未ロード（GitHub直接アクセス時）
  tags: string[];
  wikiLinks: string[];
  favorite?: boolean;
  archived?: boolean;
  remotePath?: string; // GitHub上のパス (例: notes/ファイル.md)
  sha?: string;        // GitHub blob SHA（更新・削除用）
  displayName?: string; // private/ ノートの表示名（暗号化コンテンツから取得）
}

export function cleanFilename(value: string) {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, '-');
  let base = name.replace(/\.md$/i, '');
  if (base.length > 50) {
    // PC版のパス長制限（Windows/OneDrive環境でのgit pull失敗）を回避するため50文字に切り詰め
    base = base.slice(0, 50);
  }
  return `${base || 'Untitled'}.md`;
}

export function noteTitle(name: string) {
  return name.replace(/\.md$/i, '');
}

export function extractTags(content: string): string[] {
  const match = content.match(/^(?:タグ|tags|tag)\s*[:：]\s*([^\n\r]*)/im);
  if (!match) return [];
  return match[1]
    .split(/[,，、]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}

export function extractWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const target = m[1].trim().replace(/\.md$/i, '');
    if (target) links.add(target);
  }
  return Array.from(links);
}

// 作成日時行 "作成日時: YYYY/MM/DD HH:mm" → ISO文字列（失敗時はnull）
export function extractCreatedAt(content: string): string | null {
  const m = content.match(/^作成日時[:：]\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/m);
  if (!m) return null;
  const [, y, mo, d, h = '0', min = '0'] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// ISO文字列 or 日付文字列を "YYYY/MM/DD HH:mm" 形式で表示（不正な値は空文字）
export function formatDateTime(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildNote(name: string, content: string, updatedAt?: string): Note {
  return {
    name,
    content,
    updatedAt: extractCreatedAt(content) ?? updatedAt ?? new Date().toISOString(),
    tags: extractTags(content),
    wikiLinks: extractWikiLinks(content),
  };
}

export function initialNoteContent(title: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `# ${title}\n作成日時: ${formatted}\n\n`;
}

// タグ1件を正規化。前後の記号除去・[[..]]展開・日付/空/1文字は除外（不採用ならnull）
function sanitizeTag(raw: string): string | null {
  let t = raw.trim();
  const wikiMatch = t.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (wikiMatch) t = wikiMatch[1].trim();
  t = t.replace(/^[[\]#"'`]+|[[\]#"'`]+$/g, '').trim();
  if (!t) return null;
  if (t === '---') return null;
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t)) return null; // 日付
  if (t.length <= 1) return null;
  return t;
}

// タグ配列をサニタイズし重複除去。既存のマスタータグと大文字小文字違いで一致するものは
// そのマスタータグの表記に統一する（新規と紛らわしい重複タグを作らないため）
export function sanitizeTags(rawTags: string[], masterTags: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTags) {
    for (const part of raw.split(/[,，、\n]+/)) {
      const cleaned = sanitizeTag(part);
      if (!cleaned) continue;
      const reused = masterTags.find((m) => m.toLowerCase() === cleaned.toLowerCase());
      const finalTag = reused ?? cleaned;
      const key = finalTag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(finalTag);
    }
  }
  return result;
}

// 既存の全てのタグ行（表記揺れ・複数行含む）を除去した上で、末尾に正準フォーマットの
// タグ行を1行だけ追加する（タグが空なら追加しない）
const TAG_LINE_REGEX = /^(?:タグ|tags?)\s*[:：]\s*[^\n\r]*\r?\n?/gim;

export function applyTagsToContent(content: string, tags: string[], masterTags: string[] = []): string {
  const cleanTags = sanitizeTags(tags, masterTags);
  let stripped = content.replace(TAG_LINE_REGEX, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  if (cleanTags.length === 0) return `${stripped}\n`;
  return `${stripped}\n\nタグ: ${cleanTags.join(', ')}\n`;
}

// タイトル・日付・タグ行しかない未記入ファイルを判定
export function isEmptyNote(content: string): boolean {
  const meaningful = content.split('\n').filter((l) => {
    const t = l.trim();
    return (
      t !== '' &&
      !t.startsWith('#') &&
      !/^作成日時[:：]/i.test(t) &&
      !/^(タグ|tags?)[:：]/i.test(t)
    );
  });
  return meaningful.length === 0;
}

// [[link]] → markdownリンクへ変換（プレビュー用）
export function preprocessWikiLinks(text: string) {
  if (!text) return '';
  let processed = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, name, display) =>
    `[${display}](#wiki-${encodeURIComponent(name.trim())})`
  );
  processed = processed.replace(/\[\[([^\]]+)\]\]/g, (_, name) =>
    `[${name}](#wiki-${encodeURIComponent(name.trim())})`
  );
  return processed;
}
