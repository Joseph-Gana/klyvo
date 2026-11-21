import type { ThemeMode } from './index';

export type DatabaseMessageRole = 'user' | 'assistant';

export type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPreferencesRow = {
  user_id: string;
  theme: ThemeMode;
  created_at: string;
  updated_at: string;
};

export type FolderRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type ConversationRow = {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: DatabaseMessageRole;
  content: string;
  created_at: string;
};

export type GeneratedImageRow = {
  id: string;
  user_id: string;
  storage_path: string;
  prompt: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: UserPreferencesRow;
        Insert: {
          user_id: string;
          theme?: ThemeMode;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          theme?: ThemeMode;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: FolderRow;
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          user_id: string;
          folder_id?: string | null;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          folder_id?: string | null;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_folder_id_fkey';
            columns: ['folder_id'];
            isOneToOne: false;
            referencedRelation: 'folders';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: MessageRow;
        Insert: {
          id?: string;
          conversation_id: string;
          user_id: string;
          role: DatabaseMessageRole;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          user_id?: string;
          role?: DatabaseMessageRole;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      generated_images: {
        Row: GeneratedImageRow;
        Insert: {
          id?: string;
          user_id: string;
          storage_path: string;
          prompt: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          storage_path?: string;
          prompt?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
