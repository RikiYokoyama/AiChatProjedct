export interface Note {
  name: string; // ファイル名 (.md付き)
  updatedAt: string;
  content: string;
  tags: string[];
  wikiLinks: string[];
  favorite?: boolean;
  archived?: boolean;
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

export function buildNote(name: string, content: string, updatedAt?: string): Note {
  return {
    name,
    content,
    updatedAt: updatedAt ?? new Date().toISOString(),
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

// [[link]] → markdownリンクへ変換（プレビュー用）
export function preprocessWikiLinks(text: string) {
  if (!text) return '';
  let processed = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '[$2](#wiki-$1)');
  processed = processed.replace(/\[\[([^\]]+)\]\]/g, '[$1](#wiki-$1)');
  return processed;
}
