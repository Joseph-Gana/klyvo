import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import type { Session, LiveServerMessage } from '@google/genai';
import {
  applyApiSecurityHeaders,
  BASE_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  createSecurityHeadersMiddleware,
  getAppSecurityHeaders,
  STRICT_API_CSP,
  withApiSecurityHeaders,
} from '../server/lib/securityHeaders';
import { formatDeleteConversationMessage } from '../src/utils/dialogCopy';
import {
  focusInitialDialogElement,
  getFocusableElements,
  trapTabKeyInContainer,
  type DialogContainerLike,
  type FocusableElementLike,
} from '../src/utils/focusManagement';
import {
  getNextMenuItemIndex,
  isEditableElement,
} from '../src/utils/menuNavigation';
import {
  DEFAULT_VOICE_MODEL,
  KlyvoVoiceEngine,
  type VoiceTranscriptEntry,
} from '../src/services/voiceService';

const WORKSPACE_ROOT = process.cwd();

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, relPath), 'utf8');
}

function createFakeFocusable(
  id: string,
  options?: {
    disabled?: boolean;
    hidden?: boolean;
    ariaHidden?: string;
    tabIndexAttr?: string;
    autofocus?: boolean;
  },
): FocusableElementLike & { id: string; focusedCount: number } {
  const attrs = new Map<string, string>();
  if (options?.disabled) attrs.set('disabled', '');
  if (options?.hidden) attrs.set('hidden', '');
  if (options?.ariaHidden) attrs.set('aria-hidden', options.ariaHidden);
  if (options?.tabIndexAttr) attrs.set('tabindex', options.tabIndexAttr);
  if (options?.autofocus) attrs.set('data-autofocus', 'true');

  return {
    id,
    disabled: Boolean(options?.disabled),
    focusedCount: 0,
    focus() {
      this.focusedCount += 1;
    },
    hasAttribute(name: string) {
      return attrs.has(name);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
  };
}

// -----------------------------------------------------------------------------
// 1. Security Headers & CSP Verification
// -----------------------------------------------------------------------------

test('buildContentSecurityPolicy produces narrow production CSP without unsafe-inline or unsafe-eval', () => {
  const prodCsp = buildContentSecurityPolicy({
    isDevelopment: false,
    supabaseUrl: 'https://custom-project.supabase.co',
  });

  assert.ok(!prodCsp.includes("'unsafe-eval'"), 'Production CSP must not allow unsafe-eval');
  assert.ok(!prodCsp.includes("'unsafe-inline'"), 'Production CSP must not allow unsafe-inline');
  assert.ok(prodCsp.includes("default-src 'self'"));
  assert.ok(prodCsp.includes("script-src 'self' blob:"));
  assert.ok(prodCsp.includes("style-src 'self' https://fonts.googleapis.com"));
  assert.ok(prodCsp.includes("object-src 'none'"));
  assert.ok(prodCsp.includes("base-uri 'self'"));
  assert.ok(prodCsp.includes("frame-ancestors 'none'"));
  assert.ok(prodCsp.includes('wss://generativelanguage.googleapis.com'));
  assert.ok(prodCsp.includes('https://generativelanguage.googleapis.com'));
  assert.ok(prodCsp.includes('https://*.supabase.co'));
  assert.ok(prodCsp.includes('wss://*.supabase.co'));
  assert.ok(prodCsp.includes('https://custom-project.supabase.co'));
  assert.ok(prodCsp.includes('wss://custom-project.supabase.co'));
  assert.ok(prodCsp.includes("worker-src 'self' blob:"));
  assert.ok(prodCsp.includes("media-src 'self' blob:"));
});

test('getAppSecurityHeaders enforces X-Frame-Options DENY in production and allows AI Studio framing only in dev', () => {
  const prodHeaders = getAppSecurityHeaders({ isDevelopment: false });
  assert.equal(prodHeaders['X-Content-Type-Options'], 'nosniff');
  assert.equal(prodHeaders['X-Frame-Options'], 'DENY');
  assert.equal(prodHeaders['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(prodHeaders['Permissions-Policy'], 'camera=(), geolocation=(), microphone=(self)');
  assert.ok(prodHeaders['Content-Security-Policy'].includes("frame-ancestors 'none'"));

  const devHeaders = getAppSecurityHeaders({ isDevelopment: true });
  assert.equal(devHeaders['X-Content-Type-Options'], 'nosniff');
  assert.equal(devHeaders['X-Frame-Options'], undefined);
  assert.ok(devHeaders['Content-Security-Policy'].includes('https://aistudio.google.com'));
  assert.ok(devHeaders['Content-Security-Policy'].includes('https://*.googleusercontent.com'));
});

test('applyApiSecurityHeaders and withApiSecurityHeaders harden API responses without mutating payload', async () => {
  const wrapped = withApiSecurityHeaders(async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  });

  const response = await wrapped(new Request('https://klyvo.app/api/health'));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), BASE_SECURITY_HEADERS['X-Content-Type-Options']);
  assert.equal(response.headers.get('Referrer-Policy'), BASE_SECURITY_HEADERS['Referrer-Policy']);
  assert.equal(response.headers.get('Permissions-Policy'), BASE_SECURITY_HEADERS['Permissions-Policy']);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Content-Security-Policy'), STRICT_API_CSP);
  assert.deepEqual(await response.json(), { ok: true });

  const sseResponse = applyApiSecurityHeaders(
    new Response('data: {}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  );
  assert.equal(sseResponse.headers.get('Content-Type'), 'text/event-stream');
  assert.equal(sseResponse.headers.get('Content-Security-Policy'), STRICT_API_CSP);
});

test('createSecurityHeadersMiddleware applies distinct app and API security headers over HTTP', async () => {
  const app = express();
  app.use(createSecurityHeadersMiddleware({ isDevelopment: false }));
  app.get('/api/ping', (_req, res) => {
    res.json({ pong: true });
  });
  app.get('/', (_req, res) => {
    res.type('text/html').send('<!doctype html><html></html>');
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const apiRes = await fetch(`${baseUrl}/api/ping`);
    assert.equal(apiRes.status, 200);
    assert.equal(apiRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(apiRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(apiRes.headers.get('content-security-policy'), STRICT_API_CSP);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(htmlRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(htmlRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(htmlRes.headers.get('permissions-policy'), 'camera=(), geolocation=(), microphone=(self)');
    assert.ok((htmlRes.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('netlify.toml, index.html, and Netlify Functions align on production security headers and externalized theme init', () => {
  const netlifyToml = readProjectFile('netlify.toml');
  assert.ok(netlifyToml.includes('X-Content-Type-Options = "nosniff"'));
  assert.ok(netlifyToml.includes('X-Frame-Options = "DENY"'));
  assert.ok(netlifyToml.includes('Referrer-Policy = "strict-origin-when-cross-origin"'));
  assert.ok(netlifyToml.includes('Permissions-Policy = "camera=(), geolocation=(), microphone=(self)"'));
  assert.ok(netlifyToml.includes("frame-ancestors 'none'"));
  assert.ok(!netlifyToml.includes("'unsafe-eval'"));
  assert.ok(!netlifyToml.includes("'unsafe-inline'"));

  const indexHtml = readProjectFile('index.html');
  assert.ok(indexHtml.includes('<script src="/theme-init.js"></script>'));
  assert.ok(!indexHtml.includes('dangerouslySetInnerHTML'));
  assert.ok(!/<script>(?!\s*<\/script>)/.test(indexHtml), 'index.html should not contain inline executable scripts');

  assert.ok(fs.existsSync(path.join(WORKSPACE_ROOT, 'public/theme-init.js')));

  for (const fnPath of [
    'netlify/functions/chat.ts',
    'netlify/functions/health.ts',
    'netlify/functions/voice-token.ts',
  ]) {
    const content = readProjectFile(fnPath);
    assert.ok(content.includes('withApiSecurityHeaders'), `${fnPath} must wrap handler with withApiSecurityHeaders`);
  }
});

// -----------------------------------------------------------------------------
// 2. Focus Management & Keyboard Navigation Helpers
// -----------------------------------------------------------------------------

test('focusManagement queries visible focusables, picks initial focus, and traps Tab/Shift+Tab', () => {
  const btnFirst = createFakeFocusable('first');
  const btnDisabled = createFakeFocusable('disabled', { disabled: true });
  const btnHidden = createFakeFocusable('hidden', { hidden: true });
  const btnAriaHidden = createFakeFocusable('aria-hidden', { ariaHidden: 'true' });
  const btnNegTabIndex = createFakeFocusable('neg-tabindex', { tabIndexAttr: '-1' });
  const inputAuto = createFakeFocusable('auto-input', { autofocus: true });
  const btnLast = createFakeFocusable('last');

  type FakeFocusable = FocusableElementLike & { id: string; focusedCount: number };
  let containerFocused = 0;
  const container: DialogContainerLike<FakeFocusable> = {
    querySelectorAll: () => [
      btnFirst,
      btnDisabled,
      btnHidden,
      btnAriaHidden,
      btnNegTabIndex,
      inputAuto,
      btnLast,
    ],
    querySelector: (selector: string) => (selector === '[data-autofocus]' ? inputAuto : null),
    focus: () => {
      containerFocused += 1;
    },
  };

  const focusables = getFocusableElements(container);
  assert.deepEqual(
    focusables.map((el) => el.id),
    ['first', 'auto-input', 'last'],
  );

  // Respects [data-autofocus] when no explicit preferred target is given
  const initialTarget = focusInitialDialogElement(container);
  assert.equal(initialTarget?.id, 'auto-input');
  assert.equal(inputAuto.focusedCount, 1);

  // Tab from last wraps to first
  let prevented = false;
  const wrappedForward = trapTabKeyInContainer(
    container,
    { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } },
    btnLast,
  );
  assert.equal(wrappedForward, true);
  assert.equal(prevented, true);
  assert.equal(btnFirst.focusedCount, 1);

  // Shift+Tab from first wraps to last
  prevented = false;
  const wrappedBackward = trapTabKeyInContainer(
    container,
    { key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } },
    btnFirst,
  );
  assert.equal(wrappedBackward, true);
  assert.equal(prevented, true);
  assert.equal(btnLast.focusedCount, 1);

  // Intermediate element allows native Tab progression
  prevented = false;
  const middleTab = trapTabKeyInContainer(
    container,
    { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } },
    inputAuto,
  );
  assert.equal(middleTab, false);
  assert.equal(prevented, false);

  // Empty dialog focuses container on initial focus & Tab
  const emptyContainer: DialogContainerLike = {
    querySelectorAll: () => [],
    focus: () => {
      containerFocused += 1;
    },
  };
  focusInitialDialogElement(emptyContainer);
  assert.equal(containerFocused, 1);

  prevented = false;
  const emptyTrapped = trapTabKeyInContainer(
    emptyContainer,
    { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } },
    null,
  );
  assert.equal(emptyTrapped, true);
  assert.equal(prevented, true);
  assert.equal(containerFocused, 2);
});

test('menuNavigation wraps ArrowDown/ArrowUp/Home/End and ignores editable targets', () => {
  assert.equal(getNextMenuItemIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(getNextMenuItemIndex(0, 3, 'ArrowDown'), 1);
  assert.equal(getNextMenuItemIndex(2, 3, 'ArrowDown'), 0);

  assert.equal(getNextMenuItemIndex(0, 3, 'ArrowUp'), 2);
  assert.equal(getNextMenuItemIndex(2, 3, 'ArrowUp'), 1);
  assert.equal(getNextMenuItemIndex(-1, 3, 'ArrowUp'), 2);

  assert.equal(getNextMenuItemIndex(2, 3, 'Home'), 0);
  assert.equal(getNextMenuItemIndex(0, 3, 'End'), 2);
  assert.equal(getNextMenuItemIndex(0, 0, 'ArrowDown'), -1);

  assert.equal(isEditableElement({ tagName: 'INPUT' }), true);
  assert.equal(isEditableElement({ tagName: 'textarea' }), true);
  assert.equal(isEditableElement({ tagName: 'SELECT' }), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableElement({ tagName: 'BUTTON' }), false);
});

// -----------------------------------------------------------------------------
// 3. Dialog Copy, Accessibility Contracts & Unfinished UI Removal
// -----------------------------------------------------------------------------

test('formatDeleteConversationMessage uses accurate wording for both guest and authenticated users', () => {
  const titled = formatDeleteConversationMessage('Architecture Review');
  assert.ok(titled.includes('Architecture Review'));
  assert.ok(!titled.toLowerCase().includes('local workspace'));
  assert.ok(!titled.toLowerCase().includes('local storage'));

  const untitled = formatDeleteConversationMessage('   ');
  assert.equal(
    untitled,
    'Are you sure you want to delete this conversation? This action cannot be undone.',
  );
});

test('Modals, mobile drawer, sidebar, and dropdown menus satisfy Group 2 accessibility contracts', () => {
  const modalSource = readProjectFile('src/components/ui/Modal.tsx');
  assert.ok(modalSource.includes('useId()'));
  assert.ok(modalSource.includes('useDialogFocus'));
  assert.ok(modalSource.includes('role="dialog"'));
  assert.ok(modalSource.includes('aria-modal="true"'));
  assert.ok(modalSource.includes('closeOnEscape'));
  assert.ok(modalSource.includes('closeOnBackdrop'));

  const authModalSource = readProjectFile('src/components/modals/AuthPreviewModal.tsx');
  assert.ok(authModalSource.includes('closeOnEscape={recoveryCompleted && !submitting}'));
  assert.ok(authModalSource.includes('closeOnBackdrop={recoveryCompleted && !submitting}'));
  assert.ok(
    authModalSource.includes("ariaLabel={recoveryCompleted ? 'Password updated' : 'Set a new password'}"),
  );

  const appLayoutSource = readProjectFile('src/layouts/AppLayout.tsx');
  assert.ok(appLayoutSource.includes('role="dialog"'));
  assert.ok(appLayoutSource.includes('aria-modal="true"'));
  assert.ok(appLayoutSource.includes('aria-label="Navigation menu"'));
  assert.ok(appLayoutSource.includes('aria-expanded={isMobileDrawerOpen}'));
  assert.ok(appLayoutSource.includes('useDialogFocus'));

  const sidebarSource = readProjectFile('src/components/sidebar/Sidebar.tsx');
  const expandMatches = sidebarSource.match(/aria-label="Expand sidebar"/g) ?? [];
  assert.equal(expandMatches.length, 1, 'Collapsed sidebar must not have duplicate Expand sidebar labels');
  assert.ok(sidebarSource.includes('aria-label="Klyvo home"'));
  assert.ok(sidebarSource.includes('formatDeleteConversationMessage'));
  assert.ok(!sidebarSource.includes('permanently removed from your local workspace'));

  const folderSource = readProjectFile('src/components/sidebar/FolderSection.tsx');
  assert.ok(folderSource.includes('useDropdownMenu'));
  assert.ok(folderSource.includes('role="menu"'));
  assert.ok(folderSource.includes('role="menuitem"'));
  assert.ok(folderSource.includes('aria-haspopup="menu"'));
  assert.ok(!folderSource.includes('opacity-0 group-hover:opacity-100'));

  const chatItemSource = readProjectFile('src/components/sidebar/ChatListItem.tsx');
  assert.ok(chatItemSource.includes('useDropdownMenu'));
  assert.ok(chatItemSource.includes('role="menu"'));
  assert.ok(chatItemSource.includes('role="menuitem"'));
  assert.ok(chatItemSource.includes('aria-haspopup="menu"'));
  assert.ok(!chatItemSource.includes('opacity-0 group-hover:opacity-100'));
});

test('Unfinished Paperclip button, simulateChatErrorState, outdated Phase 1/image copy, and prod diagnostics are removed/gated', () => {
  const composerSource = readProjectFile('src/components/chat/MessageComposer.tsx');
  assert.ok(!composerSource.includes('Paperclip'));
  assert.ok(!composerSource.includes('Attach files'));
  assert.ok(!composerSource.includes('attachmentInfoOpen'));

  const chatWorkspaceSource = readProjectFile('src/components/chat/ChatWorkspace.tsx');
  assert.ok(!chatWorkspaceSource.includes('Preview error state'));
  assert.ok(!chatWorkspaceSource.includes('simulateChatErrorState'));

  const workspaceContextSource = readProjectFile('src/contexts/WorkspaceContext.tsx');
  assert.ok(!workspaceContextSource.includes('simulateChatErrorState'));
  assert.ok(workspaceContextSource.includes('if (!import.meta.env.DEV) return;'));
  assert.ok(!workspaceContextSource.includes('Workspace reset to Phase 1 defaults'));

  const settingsSource = readProjectFile('src/components/settings/SettingsWorkspace.tsx');
  assert.ok(settingsSource.includes('{import.meta.env.DEV && user && ('));
  assert.ok(!settingsSource.includes('Latest Chat Diagnostics (Temporary)'));
  assert.ok(!settingsSource.includes('Phase 1'));

  const brandSource = readProjectFile('src/config/brand.ts');
  assert.ok(!brandSource.includes('visual creation'));
  assert.ok(!brandSource.includes('Phase 1'));

  const indexHtml = readProjectFile('index.html');
  assert.ok(!indexHtml.includes('image creation'));
});

// -----------------------------------------------------------------------------
// 4. Gemini Live Transient Transcript Cleanup
// -----------------------------------------------------------------------------

test('KlyvoVoiceEngine clears transient transcripts cleanly on stop + clearTranscripts without persistence', async () => {
  const emittedTranscriptSnapshots: VoiceTranscriptEntry[][] = [];
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  const mockSession = {
    sendRealtimeInput: () => {},
    close: () => {},
  } as unknown as Session;

  const engine = new KlyvoVoiceEngine(
    {
      onTranscriptsChange: (entries) => {
        emittedTranscriptSnapshots.push(entries);
      },
    },
    {
      requestMicrophone: async () => stream,
      getAccessToken: async () => 'jwt-token',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            token: 'auth_tokens/live-cleanup-test',
            model: DEFAULT_VOICE_MODEL,
            apiVersion: 'v1alpha',
            expireTime: '',
            newSessionExpireTime: '',
            uses: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as typeof fetch,
      createLiveSession: async ({ connectParams }) => {
        connectParams.callbacks.onopen?.();
        return mockSession;
      },
      createCapture: async () => ({
        setMuted: () => {},
        close: async () => {},
      }),
      createPlayback: () => ({
        enqueuePcm24kBase64: () => {},
        interrupt: () => {},
        close: async () => {},
      }),
    },
  );

  await engine.start();

  engine.handleServerMessage({
    serverContent: {
      inputTranscription: { text: 'Private voice question' },
    },
  } as LiveServerMessage);

  engine.handleServerMessage({
    serverContent: {
      outputTranscription: { text: 'Private voice response' },
      turnComplete: true,
    },
  } as LiveServerMessage);

  assert.equal(engine.getSnapshot().transcripts.length, 2);

  await engine.stop();
  engine.clearTranscripts();

  assert.equal(engine.getSnapshot().state, 'idle');
  assert.deepEqual(engine.getSnapshot().transcripts, []);
  assert.deepEqual(
    emittedTranscriptSnapshots[emittedTranscriptSnapshots.length - 1],
    [],
  );

  // Starting a fresh session afterwards begins with empty transcripts
  await engine.start();
  assert.deepEqual(engine.getSnapshot().transcripts, []);
  await engine.dispose();

  const voiceModalSource = readProjectFile('src/components/modals/VoicePreviewModal.tsx');
  assert.ok(voiceModalSource.includes('clearTranscripts()'));
  assert.ok(voiceModalSource.includes('setTranscripts([])'));
});
