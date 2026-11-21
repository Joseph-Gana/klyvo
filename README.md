# Klyvo — AI Personal Assistant

**Tagline:** Think. Create. Explore.

Klyvo is a personal AI assistant web application designed and developed by **Joseph Gana**. It provides an intuitive environment for AI-powered conversations, workspace organization, and real-time voice interactions.

Built with React, TypeScript, and Vite, Klyvo integrates Google's Gemini AI with Supabase authentication and cloud persistence. The application features a responsive ChatGPT-inspired interface, streaming AI responses, account management, and real-time voice sessions powered by the Gemini Live API.

**Live Demo:** https://klyvo.klyscape.com/
**Developer:** Joseph Gana

---

## Project Overview

Klyvo was developed to explore the design and implementation of a modern AI assistant, combining a responsive frontend, server-side AI integration, secure authentication, persistent user workspaces, and real-time audio communication.

The project demonstrates my experience working with modern frontend technologies, backend development, third-party API integrations, database services, automated testing, and cloud deployment.

## Features

### AI Chat
- Streaming AI responses powered by Google Gemini.
- Markdown rendering and syntax-highlighted code blocks.
- Copy actions for messages and code snippets.
- Responsive chat interface with suggested prompts.
- Conversation history and workspace organization.

### Real-Time Voice
- Gemini Live API integration for real-time voice conversations.
- Browser microphone access and audio playback.
- Secure, short-lived voice tokens generated server-side.
- Authenticated voice-token requests with rate limiting.

### Authentication & User Accounts
- Email and password authentication.
- Google Sign-In.
- Supabase-powered authentication and session management.
- User profile and avatar support.

### Workspace Management
- Create, rename, and delete folders.
- Organize conversations into folders.
- Rename, delete, and search conversations.
- Persistent conversations and messages for authenticated users.
- Local workspace storage for guest sessions.

### Personalization
- Responsive desktop and mobile layouts.
- Dark and light themes.
- Persistent theme preferences.
- User settings and profile management.

### Backend & Security
- Server-side Gemini API integration.
- Supabase PostgreSQL persistence.
- Supabase Row-Level Security support.
- Server-side authentication verification.
- Per-user rate limiting for protected endpoints.
- Security headers and request-body size limits.
- Netlify Functions deployment support.

---

## Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Styling | Tailwind CSS |
| AI Chat | Google Gemini API |
| Real-Time Voice | Gemini Live API |
| Authentication | Supabase Auth |
| Database | Supabase PostgreSQL |
| Backend | Node.js, Express, TypeScript |
| Serverless Functions | Netlify Functions |
| Hosting & Deployment | Netlify |
| Version Control | Git, GitHub |

---

## Project Structure

```text
klyvo/
├── netlify/
│   └── functions/
│       ├── chat.ts
│       ├── health.ts
│       └── voice-token.ts
│
├── server/
│   ├── handlers/
│   ├── lib/
│   └── webAdapter.ts
│
├── src/
│   ├── assets/
│   ├── components/
│   ├── config/
│   ├── contexts/
│   ├── data/
│   ├── hooks/
│   ├── layouts/
│   ├── services/
│   ├── types/
│   └── utils/
│
├── tests/
├── public/
├── server.ts
├── netlify.toml
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js and npm
- A Supabase project
- A Google AI Studio API key

### 1. Clone the repository

```bash
git clone https://github.com/Joseph-Gana/klyvo.git
cd klyvo
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root using `.env.example` as a reference.

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key

SUPABASE_URL=your_supabase_project_url
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key

GEMINI_API_KEY=your_gemini_api_key

KLYVO_MAX_REQUESTS_PER_MINUTE=20
```

**Security considerations:**
- Variables prefixed with `VITE_` are exposed to the browser and must never contain private secrets.
- Keep `GEMINI_API_KEY` server-side only.
- Never expose Supabase secret or service-role keys in frontend code or public repositories.

### 4. Start the development server

```bash
npm run dev
```

### 5. Run project checks

Type-check the application:

```bash
npm run lint
```

Run automated tests:

```bash
npm test
```

Create a production build:

```bash
npm run build
```

---

## Deployment

The application is configured for deployment on Netlify using GitHub integration and Netlify Functions.

### Netlify build configuration

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Production branch | `main` |

The `netlify.toml` file contains the deployment configuration and API routing rules.

### Required environment variables

Configure the following variables in Netlify:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Frontend Supabase connection |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend Supabase authentication |
| `SUPABASE_URL` | Server-side Supabase connection |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side Supabase authentication |
| `GEMINI_API_KEY` | Server-side Google Gemini access |

Optional:

| Variable | Default | Purpose |
|---|---|---|
| `KLYVO_MAX_REQUESTS_PER_MINUTE` | `20` | Configures request rate limiting |

After changing environment variables, trigger a new Netlify deployment.

---

## Testing & Quality

The project includes automated tests covering:

- Authentication and recovery flows.
- Chat streaming and response parsing.
- Conversation lifecycle and synchronization.
- Message loading.
- Markdown link handling.
- Request-body limits and security hardening.
- Voice services and voice-token handling.

The current test suite contains **65 passing tests**.

---

## Current Scope

Klyvo currently focuses on AI text conversations, workspace management, authentication, and real-time voice interactions.

The following capabilities are not currently included in the deployed application:
- Web Search and Google Search Grounding.
- AI image generation.
- File attachment uploads.

---

## Developer

**Joseph Gana**

Software Developer | Web Developer | UI Designer

I build web applications and digital products, with an interest in creating practical software experiences through modern frontend technologies, backend integrations, and AI-powered tools.

**GitHub:** [github.com/Joseph-Gana](https://github.com/Joseph-Gana)

---

## License

This project is maintained as a personal portfolio and software development project. All rights reserved unless otherwise specified.
