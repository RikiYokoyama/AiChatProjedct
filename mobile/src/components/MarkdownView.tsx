import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessWikiLinks } from '../lib/notes';

// Wikiリンク（[[...]]）対応のMarkdownレンダラー
export default function MarkdownView({
  text,
  onWikiLinkClick,
}: {
  text: string;
  onWikiLinkClick?: (noteName: string) => void;
}) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href && href.startsWith('#wiki-')) {
              const noteName = decodeURIComponent(href.replace('#wiki-', ''));
              return (
                <span
                  className="cursor-pointer font-semibold text-indigo-400 active:text-indigo-300"
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
