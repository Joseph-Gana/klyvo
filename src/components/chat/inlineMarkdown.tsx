import React from 'react';

export interface SanitizedMarkdownUrl {
  href: string;
  isExternal: boolean;
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);
const EXPLICIT_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;

function getAppOrigin(explicitOrigin?: string): string | null {
  const candidate =
    explicitOrigin !== undefined
      ? explicitOrigin
      : typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';

  if (!candidate || candidate === 'null') {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveSafeMarkdownUrl(
  rawUrl: string,
  baseOrigin?: string,
): SanitizedMarkdownUrl | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }

  // Reject ASCII control characters before trimming to block scheme obfuscation (e.g. java\tscript:)
  if (CONTROL_CHAR_REGEX.test(rawUrl)) {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Reject protocol-relative URLs (//evil.com) and backslashes (/\evil.com)
  if (trimmed.startsWith('//') || trimmed.includes('\\')) {
    return null;
  }

  if (EXPLICIT_SCHEME_REGEX.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }

    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!/^https?:\/\//i.test(trimmed) || !parsed.hostname) {
        return null;
      }
      return {
        href: parsed.toString(),
        isExternal: true,
      };
    }

    // Require a non-empty recipient or query for mailto:
    if (!parsed.pathname.trim() && !parsed.search.trim()) {
      return null;
    }

    return {
      href: parsed.toString(),
      isExternal: true,
    };
  }

  const isNormalRelative =
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('?') ||
    trimmed.startsWith('#');

  if (!isNormalRelative || /\s/.test(trimmed)) {
    return null;
  }

  const origin = getAppOrigin(baseOrigin);
  if (!origin) {
    return null;
  }

  try {
    const resolved = new URL(trimmed, origin);
    if (
      (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
      resolved.origin !== origin
    ) {
      return null;
    }

    return {
      href: resolved.toString(),
      isExternal: false,
    };
  } catch {
    return null;
  }
}

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const inlineRegex =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:[^()]|\([^()]*\))+\))/g;
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token.slice(0, 12)}`;

    if (token.startsWith('**') && token.endsWith('**')) {
      result.push(
        <strong key={key} className="font-semibold text-[#0B1020] dark:text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      result.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      result.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded-md bg-[#F3F4F6] dark:bg-[#1B2337] text-[#0B1020] dark:text-[#B8F34A] text-[13px] font-mono"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\((.+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1];
        const safeUrl = resolveSafeMarkdownUrl(linkMatch[2]);
        if (safeUrl) {
          result.push(
            <a
              key={key}
              href={safeUrl.href}
              target={safeUrl.isExternal ? '_blank' : undefined}
              rel={safeUrl.isExternal ? 'noopener noreferrer' : undefined}
              className="rounded-sm text-[#7C3AED] dark:text-[#B8F34A] underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] dark:focus-visible:ring-[#B8F34A]"
            >
              {label}
            </a>,
          );
        } else {
          result.push(label);
        }
      } else {
        result.push(token);
      }
    }

    lastIndex = inlineRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
}
