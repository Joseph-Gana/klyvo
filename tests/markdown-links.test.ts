import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  renderInlineMarkdown,
  resolveSafeMarkdownUrl,
} from '../src/components/chat/inlineMarkdown';
import { parseMarkdownBlocks } from '../src/utils/markdownParser';

function renderInlineHtml(text: string): string {
  return renderToStaticMarkup(
    React.createElement(React.Fragment, null, ...renderInlineMarkdown(text)),
  );
}

async function withMockWindowOrigin(
  origin: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  const globalObj = globalThis as unknown as { window?: unknown };
  const hadWindow = 'window' in globalObj;
  const previousWindow = globalObj.window;

  globalObj.window = { location: { origin } };
  try {
    await fn();
  } finally {
    if (hadWindow) {
      globalObj.window = previousWindow;
    } else {
      delete globalObj.window;
    }
  }
}

test('resolveSafeMarkdownUrl permits https, http, and non-empty mailto URLs', () => {
  assert.deepEqual(resolveSafeMarkdownUrl('https://klyscape.com/docs?v=1#top'), {
    href: 'https://klyscape.com/docs?v=1#top',
    isExternal: true,
  });

  assert.deepEqual(resolveSafeMarkdownUrl('  http://example.com/guide  '), {
    href: 'http://example.com/guide',
    isExternal: true,
  });

  assert.deepEqual(
    resolveSafeMarkdownUrl('mailto:support@klyscape.com?subject=Klyvo'),
    {
      href: 'mailto:support@klyscape.com?subject=Klyvo',
      isExternal: true,
    },
  );
});

test('resolveSafeMarkdownUrl rejects dangerous and unsupported protocols', () => {
  const blockedUrls = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.cookie)',
    '  javascript:void(0)  ',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0000javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:image/svg+xml;base64,PHN2Zz4=',
    'vbscript:msgbox(1)',
    'VbScRiPt:Execute("msgbox 1")',
    'file:///etc/passwd',
    'ftp://files.example.com/archive.zip',
    'blob:https://example.com/1234',
    'tel:+15551234567',
    'custom-scheme:payload',
  ];

  for (const url of blockedUrls) {
    assert.equal(
      resolveSafeMarkdownUrl(url, 'https://klyvo.app'),
      null,
      `Expected blocked URL to be rejected: ${JSON.stringify(url)}`,
    );
  }
});

test('resolveSafeMarkdownUrl handles malformed URLs safely without throwing', () => {
  const malformedUrls = [
    '',
    '   ',
    'not a valid url',
    'https://',
    'http://',
    'http://[invalid',
    'https:example.com',
    'http:example.com',
    'mailto:',
    'mailto:   ',
    '://missing-scheme',
    ':::',
    'ht tp://example.com',
    '//evil.com/phish',
    '/\\evil.com/phish',
    '\\\\evil.com\\share',
  ];

  for (const url of malformedUrls) {
    assert.doesNotThrow(() => resolveSafeMarkdownUrl(url, 'https://klyvo.app'));
    assert.equal(
      resolveSafeMarkdownUrl(url, 'https://klyvo.app'),
      null,
      `Expected malformed URL to be rejected: ${JSON.stringify(url)}`,
    );
  }
});

test('resolveSafeMarkdownUrl preserves valid relative links resolved against app origin', () => {
  const origin = 'https://klyvo.app';

  assert.deepEqual(resolveSafeMarkdownUrl('/settings', origin), {
    href: 'https://klyvo.app/settings',
    isExternal: false,
  });
  assert.deepEqual(resolveSafeMarkdownUrl('./guide?step=2#done', origin), {
    href: 'https://klyvo.app/guide?step=2#done',
    isExternal: false,
  });
  assert.deepEqual(resolveSafeMarkdownUrl('../faq', origin), {
    href: 'https://klyvo.app/faq',
    isExternal: false,
  });
  assert.deepEqual(resolveSafeMarkdownUrl('#section-a', origin), {
    href: 'https://klyvo.app/#section-a',
    isExternal: false,
  });
  assert.deepEqual(resolveSafeMarkdownUrl('?filter=active', origin), {
    href: 'https://klyvo.app/?filter=active',
    isExternal: false,
  });

  // Opaque / invalid / missing origins cannot resolve relative URLs safely
  assert.equal(resolveSafeMarkdownUrl('/settings', 'null'), null);
  assert.equal(resolveSafeMarkdownUrl('/settings', 'javascript:alert(1)'), null);
  assert.equal(resolveSafeMarkdownUrl('/settings'), null);
});

test('renderInlineMarkdown renders safe external links with target="_blank" and rel="noopener noreferrer"', () => {
  const html = renderInlineHtml(
    'Visit [Klyscape](https://klyscape.com), [HTTP Docs](http://example.com/docs), [Wiki](https://en.wikipedia.org/wiki/Markdown_(markup)), or [Email Us](mailto:support@klyscape.com).',
  );

  assert.match(
    html,
    /<a href="https:\/\/klyscape\.com\/" target="_blank" rel="noopener noreferrer"[^>]*>Klyscape<\/a>/,
  );
  assert.match(
    html,
    /<a href="http:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer"[^>]*>HTTP Docs<\/a>/,
  );
  assert.match(
    html,
    /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Markdown_\(markup\)" target="_blank" rel="noopener noreferrer"[^>]*>Wiki<\/a>/,
  );
  assert.match(
    html,
    /<a href="mailto:support@klyscape\.com" target="_blank" rel="noopener noreferrer"[^>]*>Email Us<\/a>/,
  );
});

test('renderInlineMarkdown renders rejected and malformed links as non-clickable plain text', () => {
  const cases = [
    { md: 'Click [JS Payload](javascript:alert(1)) now', label: 'JS Payload' },
    {
      md: 'Click [Data Payload](data:text/html,<script>alert(1)</script>) now',
      label: 'Data Payload',
    },
    { md: 'Click [VBS Payload](vbscript:msgbox(1)) now', label: 'VBS Payload' },
    { md: 'Click [Malformed Link](https://[invalid) now', label: 'Malformed Link' },
    { md: 'Click [Bad Mailto](mailto:) now', label: 'Bad Mailto' },
    { md: 'Click [Proto Relative](//evil.com/steal) now', label: 'Proto Relative' },
    { md: 'Click [Mixed Case](JaVaScRiPt:alert(1)) now', label: 'Mixed Case' },
  ];

  for (const item of cases) {
    const html = renderInlineHtml(item.md);
    assert.equal(html.includes('<a'), false, `Anchor tag leaked for ${item.md}`);
    assert.equal(html.includes('href='), false, `href attribute leaked for ${item.md}`);
    assert.equal(html, `Click ${item.label} now`);
  }
});

test('renderInlineMarkdown renders validated relative links resolved against window.location.origin', async () => {
  await withMockWindowOrigin('https://klyvo.example', () => {
    const html = renderInlineHtml(
      'Go to [Workspace Settings](/settings) or [Section](#details) — never [Evil](//evil.com).',
    );

    assert.match(
      html,
      /<a href="https:\/\/klyvo\.example\/settings"[^>]*>Workspace Settings<\/a>/,
    );
    assert.equal(html.includes('target="_blank"'), false);
    assert.match(
      html,
      /<a href="https:\/\/klyvo\.example\/#details"[^>]*>Section<\/a>/,
    );
    assert.equal(html.includes('evil.com'), false);
    assert.ok(html.includes('Evil'));
  });
});

test('Markdown inline and block parsing preserves headings, bold, italic, inline code, lists, blockquotes, and dividers', () => {
  const md = `# Title [Safe](https://example.com)

Paragraph with **bold**, *italic*, \`inlineCode()\`, and [Blocked](javascript:alert(1)).

- List item one
- List item with [Mail](mailto:hi@example.com)

1. Ordered one

> Quoted **note** with [BadData](data:text/plain,hello)

\`\`\`ts
const x = 1;
\`\`\`

---`;

  const blocks = parseMarkdownBlocks(md);
  assert.deepEqual(
    blocks.map((b) => b.type),
    [
      'heading',
      'paragraph',
      'unordered-list',
      'ordered-list',
      'blockquote',
      'code',
      'divider',
    ],
  );

  const headingHtml = renderInlineHtml(
    blocks[0].type === 'heading' ? blocks[0].text : '',
  );
  assert.match(
    headingHtml,
    /^Title <a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer"[^>]*>Safe<\/a>$/,
  );

  const paragraphHtml = renderInlineHtml(
    blocks[1].type === 'paragraph' ? blocks[1].text : '',
  );
  assert.match(paragraphHtml, /<strong[^>]*>bold<\/strong>/);
  assert.match(paragraphHtml, /<em[^>]*>italic<\/em>/);
  assert.match(paragraphHtml, /<code[^>]*>inlineCode\(\)<\/code>/);
  assert.ok(paragraphHtml.endsWith('and Blocked.'));
  assert.equal(paragraphHtml.includes('<a'), false);

  const quoteHtml = renderInlineHtml(
    blocks[4].type === 'blockquote' ? blocks[4].text : '',
  );
  assert.match(quoteHtml, /Quoted <strong[^>]*>note<\/strong> with BadData/);
  assert.equal(quoteHtml.includes('<a'), false);
});
