import { AppSettings, Conversation, Folder, UserProfile } from '../types';

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

export const SUGGESTED_PROMPTS = [
  {
    id: 'prompt-architecture',
    title: 'Design a serverless API route',
    description: 'Draft a typed Netlify Function handler with input validation and CORS headers.',
    prompt:
      'Design a clean TypeScript Netlify Function handler that validates JSON payloads, enforces rate-limit headers, and returns structured error responses.',
  },
  {
    id: 'prompt-research',
    title: 'Compare state management approaches',
    description: 'Evaluate React Context + Repository patterns vs external stores for modular apps.',
    prompt:
      'Compare using React Context with repository abstractions versus Zustand for an AI workspace migrating from local storage to Cloud Firestore.',
  },
  {
    id: 'prompt-writing',
    title: 'Draft a product release brief',
    description: 'Write a concise launch summary for Klyvo Phase 1 with clear user milestones.',
    prompt:
      'Write a crisp, executive product brief introducing Klyvo by Klyscape, highlighting chat organization, visual creation, and cross-device workspace design.',
  },
  {
    id: 'prompt-debug',
    title: 'Audit Tailwind dark mode tokens',
    description: 'Review color contrast and optical weights across Deep Ink and Soft Gray themes.',
    prompt:
      'What are the key WCAG AA contrast and optical compensation checks when pairing a #0B1020 dark ink surface with #B8F34A lime accents?',
  },
];

export const INITIAL_FOLDERS: Folder[] = [
  {
    id: 'folder-engineering',
    name: 'Architecture & Code',
    createdAt: daysAgo(5),
    updatedAt: hoursAgo(3),
  },
  {
    id: 'folder-product',
    name: 'Klyscape Strategy',
    createdAt: daysAgo(4),
    updatedAt: daysAgo(1),
  },
];

export const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-netlify-fn',
    title: 'Netlify Functions & Gemini Proxy Structure',
    folderId: 'folder-engineering',
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(2),
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content:
          'How should we structure our Netlify Functions directory so Gemini API keys stay server-side while keeping frontend components clean?',
        createdAt: hoursAgo(4),
        status: 'complete',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: `### Recommended Serverless Boundary

Keep all secret keys strictly inside Netlify environment variables and expose focused endpoints under \`netlify/functions/\`.

1. **Client API Adapter (\`src/services/apiClient.ts\`)**: Sends authenticated \`POST\` requests with a Firebase ID token in the \`Authorization\` header.
2. **Netlify Edge / Function Handler**: Verifies the caller token, enforces rate limits, and invokes \`@google/genai\` on the server.
3. **Stream Forwarding**: Returns \`text/event-stream\` chunks directly to the React chat stream consumer.

\`\`\`typescript
// Example Netlify Function skeleton (Phase 2 integration pattern)
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Missing server GEMINI_API_KEY configuration' },
      { status: 500 }
    );
  }

  const { prompt } = await request.json();
  return Response.json({ accepted: true, promptLength: String(prompt ?? '').length });
};
\`\`\`

> Note: This sample conversation demonstrates Klyvo's Markdown, list, and syntax-highlighted code block formatting during Phase 1.`,
        createdAt: hoursAgo(3.9),
        status: 'complete',
      },
    ],
  },
  {
    id: 'conv-design-tokens',
    title: 'Klyvo Visual System & Token Contrast',
    folderId: 'folder-product',
    createdAt: daysAgo(1),
    updatedAt: hoursAgo(18),
    messages: [
      {
        id: 'msg-3',
        role: 'user',
        content:
          'Summarize the rules for using Electric Lime (#B8F34A) and Violet (#7C3AED) across our dark and light themes.',
        createdAt: daysAgo(1),
        status: 'complete',
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content: `### Klyvo Palette Governance

- **Deep Ink (\`#0B1020\`)** serves as the primary dark-mode canvas, paired with **Slate Ink (\`#1B2337\`)** for elevated panels and composer surfaces.
- **Electric Lime (\`#B8F34A\`)** is reserved for high-intent primary actions (New Chat, primary submit CTAs, active focus highlights). Always pair lime backgrounds with **Deep Ink (\`#0B1020\`)** text to guarantee WCAG AAA contrast.
- **Violet (\`#7C3AED\`)** acts as a restrained secondary accent for selected workspace indicators and media accents.
- **Light Mode** uses **Soft Gray (\`#F3F4F6\`)** canvas framing crisp **White (\`#FFFFFF\`)** workspace cards with dark Slate/Ink typography.`,
        createdAt: daysAgo(1),
        status: 'complete',
      },
    ],
  },
  {
    id: 'conv-firestore-schema',
    title: 'Firestore Collections Plan for Phase 2',
    folderId: null,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
    messages: [
      {
        id: 'msg-5',
        role: 'user',
        content:
          'Draft a clean Firestore document layout for user-owned chats, folders, and saved image metadata.',
        createdAt: daysAgo(3),
        status: 'complete',
      },
      {
        id: 'msg-6',
        role: 'assistant',
        content: `### Suggested User-Scoped Collection Hierarchy

Scoping collections under \`users/{uid}\` keeps security rules straightforward and ensures each user only reads and writes their own records:

\`\`\`json
{
  "users/{uid}": {
    "displayName": "string",
    "email": "string",
    "updatedAt": "timestamp"
  },
  "users/{uid}/folders/{folderId}": {
    "name": "string",
    "createdAt": "timestamp"
  },
  "users/{uid}/chats/{chatId}": {
    "title": "string",
    "folderId": "string | null",
    "updatedAt": "timestamp"
  },
  "users/{uid}/images/{imageId}": {
    "prompt": "string",
    "aspectRatio": "16:9",
    "storagePath": "users/{uid}/images/{imageId}.jpg",
    "saved": true
  }
}
\`\`\`

Because Klyvo's Phase 1 data repositories already mirror these interfaces, swapping local persistence for Firestore requires minimal UI changes.`,
        createdAt: daysAgo(3),
        status: 'complete',
      },
    ],
  },
];

export const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: 'Workspace Preview',
  email: 'account@klyscape.com',
  handle: '@klyscape',
  isAuthenticated: false,
  authModeLabel: 'Local guest preview',
};

export const DEFAULT_SETTINGS: AppSettings = {
  showCodeLineNumbers: true,
  compactSidebar: false,
  enterToSend: true,
};
