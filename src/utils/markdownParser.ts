export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'divider' };

/**
 * Clean, deterministic block-level markdown parser tailored for assistant responses.
 * Separates fenced code blocks, headings, lists, blockquotes, and paragraphs cleanly.
 */
export function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const normalized = input.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const language = line.trimStart().slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: 'divider' });
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !lines[i].trimStart().startsWith('> ') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
    }
  }

  return blocks;
}
