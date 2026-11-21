import React from 'react';
import { Check, Copy } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface CodeBlockProps {
  code: string;
  language: string;
  blockId: string;
}

const KEYWORDS = new Set([
  'import',
  'export',
  'from',
  'default',
  'async',
  'await',
  'function',
  'const',
  'let',
  'var',
  'return',
  'if',
  'else',
  'try',
  'catch',
  'throw',
  'new',
  'interface',
  'type',
  'extends',
  'implements',
  'true',
  'false',
  'null',
  'undefined',
]);

function highlightLine(line: string): React.ReactNode[] {
  const tokenRegex =
    /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith('//')) {
      parts.push(
        <span key={key} className="text-[#64748B] italic">
          {token}
        </span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      parts.push(
        <span key={key} className="text-[#B8F34A]">
          {token}
        </span>,
      );
    } else if (/^\d/.test(token)) {
      parts.push(
        <span key={key} className="text-[#F59E0B]">
          {token}
        </span>,
      );
    } else if (KEYWORDS.has(token)) {
      parts.push(
        <span key={key} className="text-[#A78BFA] font-medium">
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [' '];
}

export function CodeBlock({ code, language, blockId }: CodeBlockProps) {
  const { settings } = useWorkspace();
  const { copiedId, copy } = useCopyToClipboard();
  const isCopied = copiedId === blockId;
  const lines = code.split('\n');

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[#1B2337] bg-[#0B1020] text-[#E2E8F0]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#12192E] border-b border-white/10">
        <span className="text-xs font-mono font-medium text-[#94A3B8]">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={() => copy(code, blockId)}
          aria-label={isCopied ? 'Code copied' : 'Copy code block'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[#CBD5E1] hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8F34A]"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#B8F34A]" />
              <span className="text-[#B8F34A]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="overflow-x-auto p-4 text-[13px] leading-relaxed font-mono">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                {settings.showCodeLineNumbers && (
                  <td
                    aria-hidden="true"
                    className="select-none pr-4 text-right text-[#475569] tabular-nums w-8 align-top"
                  >
                    {idx + 1}
                  </td>
                )}
                <td className="whitespace-pre text-[#E2E8F0]">{highlightLine(line)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
