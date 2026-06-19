/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    loadConfig: () => Promise<{
      geminiApiKey: string;
      notesPath: string;
      gitRemoteUrl: string;
      autoSync: boolean;
    }>;
    saveConfig: (config: {
      geminiApiKey?: string;
      notesPath?: string;
      gitRemoteUrl?: string;
      autoSync?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
    loadCoordinates: () => Promise<{
      '2d': Record<string, { x: number; y: number }>;
      '3d': Record<string, { x: number; y: number; z?: number }>;
    }>;
    saveCoordinates: (coords: {
      '2d'?: Record<string, { x: number; y: number }>;
      '3d'?: Record<string, { x: number; y: number; z?: number }>;
    }) => Promise<{ success: boolean; error?: string }>;
    listNotes: () => Promise<Array<{
      name: string;
      path: string;
      updatedAt: string;
      content: string;
      tags?: string[];
      wikiLinks?: string[];
    }>>;
    readNote: (filename: string) => Promise<string>;
    saveNote: (data: { filename: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
    renameNote: (data: { oldFilename: string; newFilename: string }) => Promise<{ success: boolean; path?: string; error?: string }>;
    syncGit: () => Promise<{ success: boolean; error?: string }>;
    openDirectoryDialog: () => Promise<string | null>;
    deleteNote: (filename: string) => Promise<{ success: boolean; error?: string }>;
    onGitStatusChanged: (callback: (status: 'idle' | 'syncing' | 'success' | 'error', error?: string) => void) => () => void;
    windowMoving: (delta: { deltaX: number; deltaY: number }) => void;
    fetchUrlText: (url: string) => Promise<string>;
    appendToNote: (data: { filename: string; appendContent: string }) => Promise<{ success: boolean; error?: string }>;
    loadGraphSettings: () => Promise<{
      '2d': typeof defaultSettings;
      '3d': typeof defaultSettings;
    }>;
    saveGraphSettings: (settings: {
      '2d'?: typeof defaultSettings;
      '3d'?: typeof defaultSettings;
    }) => Promise<{ success: boolean; error?: string }>;
    readMasterTags: () => Promise<string[]>;
    saveMasterTags: (tags: string[]) => Promise<{ success: boolean; error?: string }>;
    updateIndex: () => Promise<{ success: boolean }>;
    checkMigration: () => Promise<{ done: boolean }>;
    runMigration: () => Promise<{ success?: boolean; skipped?: boolean; moved?: string[]; error?: string }>;
    startupGitPull: () => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  };
}
