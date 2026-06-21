import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessWikiLinks } from '../lib/notes';

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

function hideUserAiLabels(text: string): string {
  return text
    .split('\n')
    .filter(line => !isUserLabelLine(line.trim()) && !isAiLabelLine(line.trim()))
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
    if (!existingNames) return true; // 未指定時は存在扱い（スタイル変化なし）
    const lower = noteName.toLowerCase();
    return existingNames.has(lower) || existingNames.has(lower + '.md');
  }

  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        {hideUserAiLabels(preprocessWikiLinks(text))}
      </ReactMarkdown>
    </div>
  );
}
