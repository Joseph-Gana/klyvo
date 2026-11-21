import { parseMarkdownBlocks } from '../../utils/markdownParser';
import { CodeBlock } from './CodeBlock';
import { renderInlineMarkdown, resolveSafeMarkdownUrl } from './inlineMarkdown';

export { resolveSafeMarkdownUrl, type SanitizedMarkdownUrl } from './inlineMarkdown';

export function MarkdownContent({
  content,
  messageId,
}: {
  content: string;
  messageId: string;
}) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-3 text-[15px] leading-[1.65] text-[#1F2937] dark:text-[#E2E8F0]">
      {blocks.map((block, index) => {
        const key = `${messageId}-blk-${index}`;
        switch (block.type) {
          case 'heading': {
            if (block.level === 1) {
              return (
                <h1
                  key={key}
                  className="font-display text-xl font-semibold text-[#0B1020] dark:text-white pt-1"
                >
                  {renderInlineMarkdown(block.text)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={key}
                  className="font-display text-lg font-semibold text-[#0B1020] dark:text-white pt-1"
                >
                  {renderInlineMarkdown(block.text)}
                </h2>
              );
            }
            return (
              <h3
                key={key}
                className="font-display text-base font-semibold text-[#0B1020] dark:text-white pt-1"
              >
                {renderInlineMarkdown(block.text)}
              </h3>
            );
          }

          case 'paragraph':
            return <p key={key}>{renderInlineMarkdown(block.text)}</p>;

          case 'unordered-list':
            return (
              <ul key={key} className="list-disc pl-5 space-y-1.5">
                {block.items.map((item, idx) => (
                  <li key={idx}>{renderInlineMarkdown(item)}</li>
                ))}
              </ul>
            );

          case 'ordered-list':
            return (
              <ol key={key} className="list-decimal pl-5 space-y-1.5">
                {block.items.map((item, idx) => (
                  <li key={idx}>{renderInlineMarkdown(item)}</li>
                ))}
              </ol>
            );

          case 'blockquote':
            return (
              <blockquote
                key={key}
                className="rounded-xl border border-[#E5E7EB] dark:border-white/10 bg-[#F9FAFB] dark:bg-[#1B2337]/60 px-4 py-3 text-sm text-[#4B5563] dark:text-[#CBD5E1]"
              >
                {renderInlineMarkdown(block.text)}
              </blockquote>
            );

          case 'code':
            return (
              <CodeBlock
                key={key}
                code={block.code}
                language={block.language}
                blockId={`${messageId}-code-${index}`}
              />
            );

          case 'divider':
            return <hr key={key} className="border-[#E5E7EB] dark:border-white/10 my-4" />;
        }
      })}
    </div>
  );
}
