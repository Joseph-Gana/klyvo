import { BRAND_CONFIG } from '../config/brand';

const STORAGE_PREFIX = 'klyvo_v1_';

export const storageService = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
    } catch {
      // Ignore quota errors cleanly
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } catch {
      // Ignore storage errors
    }
  },

  clearWorkspace(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore storage errors
    }
  },
};

export interface HealthCheckResponse {
  service: string;
  phase: number;
  ready: {
    gemini: boolean;
    supabase: boolean;
  };
  timestamp: string;
}

export const apiClient = {
  async checkHealth(): Promise<HealthCheckResponse | null> {
    try {
      const res = await fetch(`${BRAND_CONFIG.apiBaseUrl}/health`);
      if (!res.ok) return null;
      return (await res.json()) as HealthCheckResponse;
    } catch {
      return null;
    }
  },
};
