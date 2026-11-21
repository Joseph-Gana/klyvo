export type WorkspaceRoute = 'chat' | 'settings';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'complete' | 'streaming' | 'sending' | 'error' | 'phase-notice';

export type MessageSaveStatus = 'saved' | 'saving' | 'unsaved';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: MessageStatus;
  saveStatus?: MessageSaveStatus;
  persistenceError?: string;
  wasAborted?: boolean;
  errorMessage?: string;
}

export interface Conversation {
  id: string;
  title: string;
  folderId: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isPinned?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  displayName: string;
  email: string;
  handle: string;
  isAuthenticated: boolean;
  authModeLabel: string;
}

export interface AppSettings {
  showCodeLineNumbers: boolean;
  compactSidebar: boolean;
  enterToSend: boolean;
}

export type ThemeMode = 'dark' | 'light';

export interface ChatDiagnosticsSummary {
  model: string;
  thinkingLevel: string;
  apiMode: string;
  startedAt: string;
  status: 'streaming' | 'completed' | 'aborted' | 'error';
  firstServerResponseMs: number | null;
  firstGeneratedTextMs: number | null;
  firstVisibleUiTextMs: number | null;
  totalResponseMs: number | null;
  deltaCount: number;
  streamedProgressively: boolean | null;
  httpStatus: number | null;
  errorCategory: string | null;
}

