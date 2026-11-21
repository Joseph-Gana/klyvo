# Klyvo — AI Assistant by Klyscape

**Tagline:** Think. Create. Explore.

Klyvo is a modular, production-ready AI assistant web application built with React, TypeScript, Vite, and Tailwind CSS, architected for Netlify serverless deployment and Supabase backend services (Authentication, PostgreSQL, and Storage).

---

## Current Phase: Phase 1 + Supabase Client Foundation

### Implemented
- **Configurable Brand System** (`src/config/brand.ts`) supporting application name, parent brand attribution (`BY KLYSCAPE`), tagline, and design tokens.
- **Supabase Client Configuration** (`src/config/supabase.ts`) providing a typed singleton client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, with `isSupabaseConfigured()` validation and secure default browser session persistence.
- **Klyvo Design System** featuring Deep Ink (`#0B1020`), Slate Ink (`#1B2337`), Electric Lime (`#B8F34A`), Violet (`#7C3AED`), Soft Gray (`#F3F4F6`), and White (`#FFFFFF`).
- **Working Dark / Light Theme** (dark mode default, persistent via `localStorage`, immediate DOM synchronization).
- **Responsive Application Shell**: Collapsible desktop sidebar, mobile slide-out drawer, workspace navigation, and user profile menu.
- **Chat Workspace UI**: Welcome screen with suggested prompt cards, adaptive message composer, Markdown & syntax-highlighted code blocks with copy actions, web search toggle UI, attachment & voice-mode readiness sheets, and realistic local mock conversations.
- **Image Generation Workspace UI**: Prompt composer, aspect-ratio & quality settings, honest Phase 2 server readiness state (does not fabricate AI generations), image previewer, and previously generated gallery controls.
- **Saved Images Workspace UI**: Filterable gallery, lightbox preview, image download, save/unsave toggle, and deletion with confirmation.
- **Folders & Chat History Management**: Create, rename, and delete folders; move chats into/out of folders; rename, delete, and search conversations with empty states.
- **Settings Workspace UI**: Theme switching, workspace preferences, Supabase & Netlify integration readiness status, local workspace reset, and About Klyvo section.
- **Netlify Functions Structure**: Serverless handler stubs in `netlify/functions/` (`health.ts`, `chat.ts`, `generate-image.ts`, `voice-token.ts`) and `netlify.toml`.

### Planned for Upcoming Phases (Not Yet Live)
- Supabase Authentication (Email/Password, Google Sign-In, Password Reset)
- Supabase PostgreSQL persistence with Row-Level Security (RLS) for chats, folders, user preferences, and image metadata
- Supabase Storage for saved generated images and attachments
- Google Gemini API streaming chat & Google Search Grounding via Netlify Functions
- Google Gemini server-side image generation via Netlify Functions
- Google Gemini Live API real-time voice sessions via ephemeral server tokens

---

## Project Structure

```text
├── netlify/
│   └── functions/          # Thin Netlify v2 adapters re-exporting server/handlers/*
│       ├── chat.ts
│       ├── generate-image.ts
│       ├── health.ts
│       └── voice-token.ts
├── server/                 # Framework-agnostic backend core + Express adapter
│   ├── handlers/           # Web Standard Request/Response handlers
│   ├── lib/                # Auth, Gemini Interactions API, and rate limiting
│   └── webAdapter.ts       # Unbuffered Express <-> Web Request/Response bridge
├── server.ts               # Native Express server (port 3000 + Vite middleware / dist)
├── public/
│   └── favicon.svg         # Geometric Klyvo K icon
├── src/
│   ├── assets/             # Local visual assets
│   ├── components/         # Modular UI components (brand, ui, sidebar, chat, image, saved, settings)
│   ├── config/             # Brand configuration & Supabase client singleton
│   ├── contexts/           # ThemeContext, AuthContext, and WorkspaceContext
│   ├── data/               # Guest workspace conversations, folders, and gallery items
│   ├── hooks/              # Reusable React hooks (clipboard, media queries, shortcuts)
│   ├── layouts/            # Responsive AppLayout shell
│   ├── services/           # Local persistence, Supabase workspace & streaming API client
│   ├── types/              # TypeScript domain definitions
│   └── utils/              # Formatting, class merging, UUID, and Markdown utilities
├── .env.example            # Example environment variables (no secrets)
├── netlify.toml            # Netlify build, redirects (/api/* -> functions), and functions config
└── vite.config.ts          # Vite configuration
```

---

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables / AI Studio Secrets**
   ```bash
   cp .env.example .env
   ```
   - **Frontend (`VITE_*`):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **Server-side only (never prefix with `VITE_`):** `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and optional `GEMINI_MODEL` (`gemini-3.8-flash`) / `KLYVO_MAX_REQUESTS_PER_MINUTE` (`20`)

3. **Run local full-stack development server (Express + Vite middleware on port `3000`)**
   ```bash
   npm run dev
   ```
   *(Serves both the React frontend and `/api/*` backend routes natively in Google AI Studio and locally.)*

4. **Type-check, build (`dist/` + `server.js`), and run production server**
   ```bash
   npm run lint
   npm run build
   npm start
   ```

---

## Deployment to Netlify

1. Push this repository to GitHub.
2. Connect the repository in Netlify:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions` (Netlify `netlify.toml` redirects `/api/*` to `/.netlify/functions/:splat`)
3. In Netlify Site Settings > Environment Variables, configure:
   - **Frontend (Builds / All scopes):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **Server-side only (Functions scope — never prefix with `VITE_`):** `GEMINI_API_KEY`, `GEMINI_MODEL` (optional; defaults to `gemini-3.8-flash`), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `KLYVO_MAX_REQUESTS_PER_MINUTE` (optional; defaults to `20`)
