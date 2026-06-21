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
}

export function cleanFilename(value: string) {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, '-');
  return name.endsWith('.md') ? name : `${name || 'Untitled'}.md`;
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

// タグ行を更新（なければ作成日時行の直後、それもなければ先頭に挿入）
export function applyTagsToContent(content: string, tags: string[]): string {
  const tagLineRegex = /^(タグ|tags|tag)\s*[:：]\s*[^\n\r]*/im;
  const dateLineRegex = /^(作成日時\s*[:：]\s*[^\n\r]*)/m;
  const tagsString = tags.join(', ');
  if (tagLineRegex.test(content)) {
    return content.replace(tagLineRegex, `タグ: ${tagsString}`);
  }
  if (dateLineRegex.test(content)) {
    return content.replace(dateLineRegex, (match) => `${match}\nタグ: ${tagsString}`);
  }
  return `タグ: ${tagsString}\n\n${content}`;
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
  let processed = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2](#wiki-$1)');
  processed = processed.replace(/\[\[([^\]]+)\]\]/g, '[$1](#wiki-$1)');
  return processed;
}
