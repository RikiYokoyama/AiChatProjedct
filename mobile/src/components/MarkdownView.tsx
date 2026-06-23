import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessWikiLinks } from '../lib/notes';

const USER_HR_CODE = '__HR_USER__';
const AI_HR_CODE   = '__HR_AI__';

function isUserLabelLine(t: string) {
  return /^#{1,6}\s+(User|ユーザー)$/i.test(t) ||
         /^\*\*(User|ユーザー)\*\*$/i.test(t) ||
         /^(User|ユーザー)[:：]?\s*$/i.test(t);
}
function isAiLabelLine(t: string) {
  return /^#{1,6}\s+(AI|Claude|Assistant)$/i.test(t) ||
         /^\*\*(AI|Claude|Assistant)\*\*$/i.test(t) ||
         /^(AI|Claude|Assistant)[:：]?\s*$/i.test(t);
}

function replaceUserAiWithHr(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (isUserLabelLine(t)) return `\`${USER_HR_CODE}\``;
      if (isAiLabelLine(t))   return `\`${AI_HR_CODE}\``;
      return line;
    })
    .join('\n');
}

// Wikiリンク（[[...]]）対応のMarkdownレンダラー
export default function MarkdownView({
  text,
  onWikiLinkClick,
  existingNames,
}: {
  text: string;
  onWikiLinkClick?: (noteName: string) => void;
  existingNames?: Set<string>;
}) {
  function noteExists(noteName: string): boolean {
    if (!existingNames) return true;
    const lower = noteName.toLowerCase();
    if (existingNames.has(lower) || existingNames.has(lower + '.md')) return true;
    // パス形式 (notes/2026-06/Name) のリンクに対してベースネームでもマッチ
    const base = lower.split('/').pop() ?? lower;
    return existingNames.has(base) || existingNames.has(base + '.md');
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ children, className }) => {
            if (!className) {
              const s = String(children).trim();
              if (s === USER_HR_CODE) return <hr style={{ border: 'none', borderTop: '1.5px solid #378ADD', opacity: 0.5, margin: '12px 0' }} />;
              if (s === AI_HR_CODE)   return <hr style={{ border: 'none', borderTop: '1.5px solid #1D9E75', opacity: 0.5, margin: '12px 0' }} />;
            }
            return <code className={className}>{children}</code>;
          },
          a: ({ href, children }) => {
            if (href && href.startsWith('#wiki-')) {
              const noteName = decodeURIComponent(href.replace('#wiki-', ''));
              const exists = noteExists(noteName);
              return (
                <span
                  className={
                    exists
                      ? 'cursor-pointer font-semibold text-indigo-400 active:text-indigo-300'
                      : 'cursor-pointer text-gray-500 underline decoration-dashed underline-offset-2 active:text-gray-400'
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onWikiLinkClick?.(noteName);
                  }}
                >
                  {children}
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                {children}
              </a>
            );
          },
        }}
      >
        {replaceUserAiWithHr(preprocessWikiLinks(text))}
      </ReactMarkdown>
    </div>
  );
}
