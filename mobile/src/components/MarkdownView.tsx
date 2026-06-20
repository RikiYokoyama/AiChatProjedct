import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessWikiLinks } from '../lib/notes';

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
        {preprocessWikiLinks(text)}
      </ReactMarkdown>
    </div>
  );
}
