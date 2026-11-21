export interface BrandConfig {
  appName: string;
  parentBrand: string;
  attributionLabel: string;
  tagline: string;
  description: string;
  phaseLabel: string;
  apiBaseUrl: string;
  colors: {
    deepInk: string;
    slateInk: string;
    electricLime: string;
    violet: string;
    white: string;
    softGray: string;
  };
}

export const BRAND_CONFIG: BrandConfig = {
  appName: import.meta.env.VITE_APP_NAME || 'Klyvo',
  parentBrand: import.meta.env.VITE_PARENT_BRAND || 'Klyscape',
  attributionLabel: `BY ${(import.meta.env.VITE_PARENT_BRAND || 'Klyscape').toUpperCase()}`,
  tagline: 'Think. Create. Explore.',
  description:
    'A focused AI workspace for structured reasoning, real-time voice, and organized research.',
  phaseLabel: 'Web Workspace',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  colors: {
    deepInk: '#0B1020',
    slateInk: '#1B2337',
    electricLime: '#B8F34A',
    violet: '#7C3AED',
    white: '#FFFFFF',
    softGray: '#F3F4F6',
  },
};
